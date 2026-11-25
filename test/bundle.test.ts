import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import vm from "node:vm"
import type { AccountHook, HookContext, PanelHook, ExportRequest, ResultMessage, TransferHook } from "@ham2k/extension-sdk"

test("built bundle renders without network and performs only explicit account reads through the SDK", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"))
  const source = await readFile(new URL("../build/index.js", import.meta.url), "utf8")
  const definitions: {
    key: string
    version: string
    onActivation: (api: unknown) => void | Promise<void>
  }[] = []
  const registrations: { category: string; key: string; hook: PanelHook | AccountHook | TransferHook }[] = []
  const unexpected = () => assert.fail("Rendering/activation must not call the host or schedule work")
  let allowReads = false
  let nativePush = false
  let pendingPush: unknown = null
  let posts = 0
  const requests: string[] = []
  const timers: (() => unknown)[] = []
  const sessions: unknown[] = []
  const messages: ResultMessage[] = []
  const exportRequests: ExportRequest[] = []
  const token = "wl2_BUNDLE_TEST_TOKEN"
  const hostCall = async (method: string, params: Record<string, unknown>) => {
    if (!allowReads) unexpected()
    if (method === "getSettings") return { extensions: { "extension_ad8is-wavelog": { pendingPush } } }
    if (method === "setSettings") {
      pendingPush = (params.values as Record<string, unknown>).pendingPush
      return null
    }
    if (method === "fetch") {
      if (params.method === "POST") {
        assert.ok(nativePush)
        const body = JSON.parse(String(params.body))
        assert.equal(body.station_profile_id, 7)
        assert.equal(body.freq, 14062000)
        assert.equal(body.name, undefined)
        assert.equal(body.comment, undefined)
        assert.ok(pendingPush)
        posts++
        if (posts === 2) throw new Error("Connection lost after POST")
        return { status: 201, body: JSON.stringify({ data: { id: 91 } }) }
      }
      assert.equal(params.method, "GET")
      assert.equal((params.headers as Record<string, string>).Authorization, `Bearer ${token}`)
      const url = String(params.url)
      requests.push(url)
      const data = url.endsWith("/token")
        ? { id: 1, user_id: 2, scopes: nativePush ? ["station:read", "qso:write"] : ["station:read"] }
        : nativePush
          ? [{ id: 7, name: "Summit", callsign: "AD8IS", gridsquare: "EM89AB", sota: "", pota: "" }]
          : []
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
    timers: {
      set: (callback: () => unknown) => {
        timers.push(callback)
        return timers.length
      },
      clear: unexpected,
    },
    registerHook: (category: string, registration: { key: string; hook: PanelHook | AccountHook | TransferHook }) => {
      registrations.push({ category, ...registration })
    },
  })
  assert.equal(registrations.length, 3)
  assert.equal(registrations[0].category, "panel")
  assert.equal(registrations[0].key, manifest.key)
  assert.deepEqual(
    manifest.hooks,
    registrations.map(({ category }) => category),
  )
  assert.deepEqual(manifest.domains, ["*"])
  assert.equal(manifest.api, 28)
  assert.equal(manifest.webSockets, undefined)
  assert.equal(
    Object.keys(manifest).some((key) => key.startsWith("requires")),
    false,
  )
  const hook = registrations[0].hook as PanelHook
  const context = new Proxy({} as HookContext, { get: (_target, key) => (key === "account" ? undefined : key === "online" ? false : unexpected()) })
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
  if (content.kind !== "scene") assert.fail("Expected scene")
  assert.match(JSON.stringify(content), /Upload new QSOs/)
  assert.match(JSON.stringify(content), /QSO EDITS ARE NOT SYNCED/)
  assert.equal(requests.length, 0)
  const transfer = registrations.find(({ category }) => category === "transfer")!.hook as TransferHook
  const scope = { kind: "operation" as const, operation: { uuid: "op" } }
  const transferContext = { online: true, account: { credentials: { url: "https://log.example.org", token } } }
  const args = { service: "wavelog", scope, stationCalls: ["AD8IS", "AD8IS/P"] }
  const [suggestion] = await transfer.suggestPushes!({ scope }, transferContext)
  assert.equal(suggestion.service, "wavelog")
  assert.equal(suggestion.select.notSentTo, "wavelog")
  await assert.rejects(transfer.suggestDestinations(args, { online: true }), /Configure Wavelog/)
  allowReads = true
  nativePush = true
  const [destination] = await transfer.suggestDestinations(args, transferContext)
  assert.equal(destination.stationCall, undefined)
  assert.ok(!JSON.stringify(destination).includes(token))
  const records = [
    {
      uuid: "new",
      adif: [
        "<CALL:4>W1AW<QSO_DATE:8>20261125<TIME_ON:6>120000<BAND:3>20m<MODE:2>CW<FREQ:6>14.062<STATION_CALLSIGN:5>AD8IS<MY_GRIDSQUARE:6>EM89AB<NAME:4>Test<COMMENT:4>Test<EOR>",
      ],
    },
    { uuid: "edit", id: "12", adif: ["<CALL:4>W2AW<EOR>"] },
    { uuid: "deleted", id: "13", deleted: true, adif: [] },
  ]
  const outcomes = await transfer.push!({ service: "wavelog", stationCall: "AD8IS", destination, records }, transferContext)
  assert.deepEqual(
    Array.from(outcomes, ({ uuid }) => uuid),
    records.map(({ uuid }) => uuid),
  )
  assert.equal(outcomes[0].id, "91")
  assert.equal(pendingPush, null)
  assert.ok(outcomes.slice(1).every(({ error }) => error?.includes("not supported")))
  const failure = await transfer.push!(
    { service: "wavelog", stationCall: "AD8IS", destination, records: [{ ...records[0], uuid: "uncertain" }] },
    transferContext,
  )
  assert.match(failure[0].error!, /uncertain/)
  const retry = await transfer.push!({ service: "wavelog", stationCall: "AD8IS", destination, records: [records[0]] }, transferContext)
  assert.match(retry[0].error!, /unresolved/)
  assert.equal(posts, 2)
  nativePush = false
  requests.length = 0
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
  assert.equal(exportRequests.length, 0)
  assert.equal(timers.length, 1)
  timers.shift()!()
  for (let i = 0; i < 100 && !messages.length; i++) await Promise.resolve()
  assert.equal(exportRequests.length, 1)
  assert.equal(exportRequests[0].includePrivateData, false)
  assert.match(messages[0].text, /1 QSOs; 1 station-location/)
})
