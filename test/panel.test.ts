import assert from "node:assert/strict"
import { test } from "node:test"
import type { HookContext, PanelContent, PanelRenderArgs } from "@ham2k/extension-sdk"
import type { Services } from "../src/account.ts"
import { createOperationPanel } from "../src/panel.ts"

const token = "wl2_SYNTHETIC"
const credentials = { url: "https://example.org", token }
const args: PanelRenderArgs = {
  panelKey: "operation",
  operation: { uuid: "op", stationCall: "AD8IS/P", grid: "EM89AB" },
  qsoCount: 1,
  config: {},
  reason: "initial",
}
const ctx: HookContext = { online: true, account: { credentials }, getQsos: async () => [{ band: "20m" }] }
const station = { id: 7, name: "Summit", callsign: "AD8IS/P", gridsquare: "EM89AB", sota: "", pota: "" }
const text = (content: PanelContent) => JSON.stringify(content)
function fixture() {
  const tasks: (() => Promise<void>)[] = []
  const requests: string[] = []
  let rows: unknown[] = [station]
  const services: Services = {
    schedule: (task) => {
      tasks.push(task)
    },
    preview: async () => "<EOH><CALL:4>W1AW<STATION_CALLSIGN:7>AD8IS/P<MY_GRIDSQUARE:6>EM89AB<EOR>",
    fetch: async (url, options) => {
      assert.equal(options.method, "GET")
      requests.push(url)
      return { status: 200, body: JSON.stringify({ data: url.endsWith("/token") ? { id: 1, scopes: ["station:read"] } : rows }) }
    },
    saveSession: async () => assert.fail("Unexpected storage"),
    showMessage: async () => assert.fail("Unexpected dialog"),
  }
  return {
    services,
    tasks,
    requests,
    setStations: (value: unknown[]) => {
      rows = value
    },
  }
}

test("panel checks stations asynchronously and keeps renders read-only", async () => {
  const f = fixture(),
    panel = createOperationPanel("test", f.services)
  const initial = await panel.render(args, ctx)
  assert.equal(initial.kind, "scene")
  assert.match(text(initial), /Checking station-locations/)
  assert.match(text(initial), /Upload new QSOs/)
  assert.match(text(initial), /⚠️ QSO EDITS ARE NOT SYNCED/)
  assert.equal(f.requests.length, 0)
  assert.equal(f.tasks.length, 1)
  await panel.render({ ...args, reason: "tick" }, ctx)
  assert.equal(f.tasks.length, 1)
  await f.tasks.shift()!()
  const result = await panel.render({ ...args, reason: "tick" }, ctx)
  assert.match(text(result), /EXISTING station-location/)
  assert.match(text(result), /Summit/)
  assert.equal(f.requests.length, 2)
  assert.ok(!text(result).includes(token))
})

test("new, ambiguous, offline and empty states never claim a safe existing station", async () => {
  const f = fixture(),
    panel = createOperationPanel("test", f.services)
  f.setStations([])
  await panel.render(args, ctx)
  await f.tasks.shift()!()
  assert.match(text(await panel.render({ ...args, reason: "tick" }, ctx)), /NEW station-location/)
  f.setStations([station, { ...station, id: 8 }])
  await panel.render({ ...args, reason: "visible" }, ctx)
  await f.tasks.shift()!()
  assert.match(text(await panel.render({ ...args, reason: "tick" }, ctx)), /ambiguous/)
  const offline = await panel.render(args, { ...ctx, online: false })
  assert.match(text(offline), /Offline/)
  if (offline.kind !== "scene") assert.fail("Expected scene")
  assert.equal(offline.scene.controls?.find((control) => control.id === "upload")?.disabled, true)
  assert.match(text(await panel.render({ ...args, qsoCount: 0 }, ctx)), /No contacts/)
})

test("a late station check cannot overwrite the current operation", async () => {
  const f = fixture(),
    panel = createOperationPanel("test", f.services)
  await panel.render(args, ctx)
  const other = { ...args, operation: { ...args.operation, uuid: "other" } }
  await panel.render(other, ctx)
  assert.equal(f.tasks.length, 2)
  await f.tasks[0]()
  assert.match(text(await panel.render({ ...other, reason: "tick" }, ctx)), /Checking/)
  f.setStations([])
  await f.tasks[1]()
  assert.match(text(await panel.render({ ...other, reason: "tick" }, ctx)), /NEW station-location/)
})
