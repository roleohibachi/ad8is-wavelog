import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import vm from "node:vm"
import type { HookContext, PanelHook } from "@ham2k/extension-sdk"

test("built bundle activates and renders through the SDK without host calls", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"))
  const source = await readFile(new URL("../build/index.js", import.meta.url), "utf8")
  const definitions: {
    key: string
    version: string
    onActivation: (api: unknown) => void | Promise<void>
  }[] = []
  const registrations: { category: string; key: string; hook: PanelHook }[] = []
  const unexpected = () => assert.fail("Phase 1 must not call the host or schedule work")
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
      hostCall: unexpected,
    },
  })
  vm.runInContext(source, sandbox, { timeout: 2000 })
  assert.equal(definitions.length, 1)
  const [definition] = definitions
  assert.equal(definition.key, manifest.key)
  assert.equal(definition.version, manifest.version)
  await definition.onActivation({
    hostCall: unexpected,
    timers: { set: unexpected, clear: unexpected },
    registerHook: (category: string, registration: { key: string; hook: PanelHook }) => {
      registrations.push({ category, ...registration })
    },
  })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].category, "panel")
  assert.equal(registrations[0].key, manifest.key)
  assert.deepEqual(
    manifest.hooks,
    registrations.map(({ category }) => category),
  )
  assert.equal(manifest.domains, undefined)
  assert.equal(manifest.webSockets, undefined)
  assert.equal(
    Object.keys(manifest).some((key) => key.startsWith("requires")),
    false,
  )
  const hook = registrations[0].hook
  const context = new Proxy({} as HookContext, { get: unexpected })
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
})
