import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import vm from "node:vm"
import type { AccountHook, HookContext, PanelHook, ExportRequest, ResultMessage } from "@ham2k/extension-sdk"

test("built bundle renders without network and performs only explicit account reads through the SDK", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"))
  const source = await readFile(new URL("../build/index.js", import.meta.url), "utf8")
  const definitions: {
    key: string
    version: string
    onActivation: (api: unknown) => void | Promise<void>
  }[] = []
  const registrations: { category: string; key: string; hook: PanelHook | AccountHook }[] = []
  const unexpected = () => assert.fail("Rendering/activation must not call the host or schedule work")
  let allowReads = false
  const requests: string[] = []
  const sessions: unknown[] = []
  const messages: ResultMessage[] = []
  const exportRequests: ExportRequest[] = []
  const token = "wl2_BUNDLE_TEST_TOKEN"
  const hostCall = async (method: string, params: Record<string, unknown>) => {
    if (!allowReads) unexpected()
    if (method === "fetch") {
      assert.equal(params.method, "GET")
      assert.equal((params.headers as Record<string, string>).Authorization, `Bearer ${token}`)
      const url = String(params.url)
      requests.push(url)
      const data = url.endsWith("/token") ? { id: 1, scopes: ["station:read"] } : []
      return { status: 200, body: JSON.stringify({ data }) }
    }
    if (method === "setAccountSession") {
      sessions.push(params.session)
      return null
    }
    if (method === "showMessage") {
      messages.push(params as unknown as ResultMessage)
      return null
    }
    assert.fail(`Unexpected host call: ${method}`)
  }
  const sandbox = vm.createContext({
    Intl: undefined,
    __halo: {
      defineExtension: (definition: (typeof definitions)[number]) => definitions.push(definition),
      // The SDK eagerly initializes DXCC and mode helpers even for a plain
      // panel. Minimal stand-ins cover that setup, not country/mode behavior
      // or the device's QuickJS runtime.
      sharedModules: new Proxy(
        {},
        {
          get: (_target, name) => {
            if (name === "@ham2k/lib-country-files") return { useBuiltinCountryFile() {}, BIGCTY: { entities: {} } }
            if (name === "@ham2k/lib-operation-data") return { ADIF_MODES_AND_SUBMODES: [] }
            return {}
          },
        },
      ),
      hostCall,
      invokeLocal: async (category: string, method: string, request: ExportRequest, _online: unknown, key: string) => {
        assert.equal(category, "export")
        assert.equal(method, "generateExport")
        assert.equal(key, "adif")
        exportRequests.push(request)
        return [{ ok: true, value: { content: "<EOH><CALL:4>W1AW<STATION_CALLSIGN:7>AD8IS/P<MY_GRIDSQUARE:6>EM89AB<MY_SOTA_REF:10>W8O/SE-004<EOR>" } }]
      },
      getAccountKvKey: (key: string) => key,
    },
  })
  vm.runInContext(source, sandbox, { timeout: 2000 })
  assert.equal(definitions.length, 1)
  const [definition] = definitions
  assert.equal(definition.key, manifest.key)
  assert.equal(definition.version, manifest.version)
  await definition.onActivation({
    hostCall,
    timers: { set: unexpected, clear: unexpected },
    registerHook: (category: string, registration: { key: string; hook: PanelHook | AccountHook }) => {
      registrations.push({ category, ...registration })
    },
  })
  assert.equal(registrations.length, 2)
  assert.equal(registrations[0].category, "panel")
  assert.equal(registrations[0].key, manifest.key)
  assert.deepEqual(
    manifest.hooks,
    registrations.map(({ category }) => category),
  )
  assert.deepEqual(manifest.domains, ["*"])
  assert.equal(manifest.api, 23)
  assert.equal(manifest.webSockets, undefined)
  assert.equal(
    Object.keys(manifest).some((key) => key.startsWith("requires")),
    false,
  )
  const hook = registrations[0].hook as PanelHook
  const context = new Proxy({} as HookContext, { get: (_target, key) => (key === "account" ? undefined : unexpected()) })
  const [descriptor] = await hook.getPanels({}, context)
  const content = await hook.render(
    {
      panelKey: descriptor.key,
      operation: { uuid: "device-test-operation", title: "Summit", stationCall: "AD8IS/P" },
      qsoCount: 25,
      config: {},
      reason: "initial",
    },
    context,
  )
  if (content.kind !== "markdown") assert.fail("Expected Markdown")
  assert.match(content.content, /Operation ID: device-test-operation/)
  assert.match(content.content, /QSOs: 25/)
  assert.equal(requests.length, 0)
  allowReads = true
  assert.equal(registrations[1].category, "account")
  const account = registrations[1].hook as AccountHook
  const result = await account.testCredentials({ url: "https://log.example.org", token }, { online: true })
  assert.match(result, /0 station-location/)
  assert.deepEqual(requests, ["https://log.example.org/api/v2/token", "https://log.example.org/api/v2/station"])
  assert.equal(sessions.length, 1)
  assert.ok(!JSON.stringify(sessions).includes(token))
  const before = requests.length
  await hook.onEvent!(
    {
      panelKey: descriptor.key,
      operation: { uuid: "op", stationCall: "AD8IS/P", grid: "EM89AB" },
      qsoCount: 1,
      config: {},
      reason: "initial",
      event: { controlId: "menu", action: "preview", phase: "activate", sequence: 1 },
    },
    { online: false, getQsos: async () => [{ band: "20m", their: { call: "W1AW" } }] },
  )
  assert.equal(requests.length, before)
  assert.equal(exportRequests.length, 1)
  assert.equal(exportRequests[0].includePrivateData, false)
  assert.match(messages[0].text, /1 QSOs; 1 station-location/)
})
