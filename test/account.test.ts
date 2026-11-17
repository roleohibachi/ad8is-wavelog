import assert from "node:assert/strict"
import { test } from "node:test"
import type { HookContext, PanelRenderArgs, PanelSceneEvent, ResultMessage } from "@ham2k/extension-sdk"
import { createAccount } from "../src/account.ts"
import type { Services } from "../src/account.ts"
import { createOperationPanel } from "../src/panel.ts"

const token = "wl2_SYNTHETIC_TEST_TOKEN"
const credentials = { url: "https://log.example.org", token }
const args: PanelRenderArgs = { panelKey: "operation", operation: { uuid: "op-a" }, qsoCount: 1, config: {}, reason: "initial" }
const event: PanelSceneEvent = { controlId: "menu", action: "test-connection", phase: "activate", sequence: 1 }
const context = { online: true, account: { credentials } } as HookContext

function fixture() {
  const sessions: Record<string, string>[] = []
  const messages: ResultMessage[] = []
  const requests: string[] = []
  const services: Services = {
    async fetch(url, options) {
      requests.push(url)
      assert.equal(options.method, "GET")
      const data = url.endsWith("/token")
        ? { id: 1, scopes: ["station:read"] }
        : [{ id: 7, name: "Hill", callsign: "AD8IS/P", gridsquare: "EM89AB", sota: "W8O/SE-004", pota: "US-5450" }]
      return { status: 200, body: JSON.stringify({ data }) }
    },
    async saveSession(session) {
      sessions.push(session)
    },
    async showMessage(message) {
      messages.push(message)
    },
  }
  return { services, sessions, messages, requests }
}

test("account test reads token and stations, saving only a nonsecret summary", async () => {
  const { services, sessions, requests } = fixture()
  const hook = createAccount(services)
  const result = await hook.testCredentials(credentials, {} as HookContext)
  assert.match(result, /Connected.*1 station-location/)
  assert.equal(requests.length, 2)
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].server, credentials.url)
  assert.deepEqual(Object.keys(sessions[0]).sort(), ["server", "summary"])
  assert.ok(!JSON.stringify(sessions).includes(token))
})

test("panel rendering reads saved summary but does not initiate network or storage calls", async () => {
  const { services, sessions, messages, requests } = fixture()
  const panel = createOperationPanel("test", services)
  const content = await panel.render(args, {
    online: true,
    account: { credentials, session: { server: credentials.url, summary: "Connected previously" } },
  } as HookContext)
  if (content.kind !== "markdown") assert.fail("Expected Markdown")
  assert.match(content.content, /Last successful test/)
  assert.ok(!content.content.includes(token))
  assert.deepEqual(content.menu, [
    { label: "Preview settings", settings: true },
    { label: "Preview station-locations (local)", event: "preview" },
    { label: "Compare with Wavelog (read-only)", event: "compare" },
    { label: "Test connection (read-only)", event: "test-connection" },
  ])
  assert.deepEqual([requests.length, sessions.length, messages.length], [0, 0, 0])
})

test("panel ignores prior success from a different configured server", async () => {
  const { services } = fixture()
  const content = await createOperationPanel("test", services).render(args, {
    online: true,
    account: { credentials, session: { server: "https://other.example.org", summary: "OLD SUMMARY" } },
  } as HookContext)
  if (content.kind !== "markdown") assert.fail("Expected Markdown")
  assert.doesNotMatch(content.content, /OLD SUMMARY/)
  assert.match(content.content, /verify current access/)
})

test("explicit menu action performs read-only test and shows real station IDs and metadata", async () => {
  const { services, sessions, messages, requests } = fixture()
  const panel = createOperationPanel("test", services)
  await panel.onEvent!({ ...args, event }, context)
  assert.equal(requests.length, 2)
  assert.equal(sessions.length, 1)
  assert.equal(messages.length, 1)
  assert.match(messages[0].text, /ID 7: Hill/)
  assert.match(messages[0].text, /SOTA W8O\/SE-004/)
  assert.match(messages[0].text, /POTA US-5450/)
  assert.ok(!JSON.stringify(messages).includes(token))
})

test("connection failure displays a safe diagnostic and never saves success", async () => {
  const { services, sessions, messages } = fixture()
  services.fetch = async () => ({ status: 401, body: `Secret: ${token}` })
  await createOperationPanel("test", services).onEvent!({ ...args, event }, context)
  assert.equal(sessions.length, 0)
  assert.match(messages[0].text, /rejected.*401/)
  assert.ok(!JSON.stringify(messages).includes(token))
})

test("platform storage errors cannot expose credentials in the panel error dialog", async () => {
  const { services, messages } = fixture()
  services.saveSession = async () => {
    throw new Error(token)
  }
  await createOperationPanel("test", services).onEvent!({ ...args, event }, context)
  assert.match(messages[0].text, /account storage/)
  assert.ok(!JSON.stringify(messages).includes(token))
})

test("repeat taps while a connection test is running do not start another request pair", async () => {
  const { services, requests, messages } = fixture()
  const original = services.fetch
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  services.fetch = async (...args) => {
    await pending
    return original(...args)
  }
  const panel = createOperationPanel("test", services)
  const first = panel.onEvent!({ ...args, event }, context)
  await panel.onEvent!({ ...args, event }, context)
  release()
  await first
  assert.equal(requests.length, 2)
  assert.equal(messages.length, 1)
})

test("unknown menu events do not touch the connection", async () => {
  const { services, requests } = fixture()
  await createOperationPanel("test", services).onEvent!({ ...args, event: { ...event, action: "unrelated" } }, context)
  assert.equal(requests.length, 0)
})

test("comparison regenerates the local snapshot and refetches stations for the current server each time", async () => {
  const { services, requests, messages, sessions } = fixture()
  services.preview = async () => "<EOH><CALL:4>W1AW<STATION_CALLSIGN:7>AD8IS/P<MY_GRIDSQUARE:6>EM89AB<MY_SOTA_REF:10>W8O/SE-004<MY_POTA_REF:7>US-5450<EOR>"
  let reads = 0
  const panel = createOperationPanel("test", services)
  const current = { ...args, operation: { uuid: "op-a", stationCall: "AD8IS/P", grid: "EM89AB" }, event: { ...event, action: "compare" } }
  const getQsos = async () => {
    reads++
    return [{ band: "20m" }]
  }
  await panel.onEvent!(current, { online: true, account: { credentials }, getQsos })
  assert.match(messages[0].text, /Reuse existing station/)
  assert.match(messages[0].text, /ID 7/)
  await panel.onEvent!(
    { ...current, operation: { ...current.operation, uuid: "op-b" } },
    { online: true, account: { credentials: { ...credentials, url: "https://other.example.org" } }, getQsos },
  )
  assert.equal(reads, 2)
  assert.equal(requests.length, 4)
  assert.ok(requests[2].startsWith("https://other.example.org/"))
  assert.equal(sessions.length, 0)
})
