import assert from "node:assert/strict"
import { test } from "node:test"
import type { HookContext } from "@ham2k/extension-sdk"
import { createLocation } from "../src/create.ts"
import { createOperationPanel } from "../src/panel.ts"
import type { Services } from "../src/account.ts"

const credentials = { url: "https://log.example.org", token: "wl2_SYNTHETIC" }
const scopes = ["station:read", "station:write", "logbook:read", "logbook:write", "lookup:read"]
const station = { id: 9, name: "Test", callsign: "AD8IS/P", gridsquare: "EM89AB", sota: "W8O/SE-004", pota: "US-5450", dxcc: 291, cq: 5, itu: 8 }
const op = { uuid: "op", stationCall: "AD8IS/P", grid: "EM89AB" }
const context: HookContext = { online: true, account: { credentials }, getOperation: async () => op, getQsos: async () => [{ band: "20m" }] }
const response = (data: unknown) => ({ status: 200, body: JSON.stringify({ data }) })
function fixture() {
  const calls: { url: string; method: string; body?: string }[] = []
  const forms: unknown[] = []
  let created = false
  const answers: (Record<string, unknown> | null)[] = [
    { group: 0, lookup: false },
    { name: "W8O/SE-004, US-5450, EM89AB", dxcc: 291, cq: 5, itu: 8, confirm: true },
  ]
  const services: Services = {
    preview: async () => "<EOH><CALL:4>W1AW<STATION_CALLSIGN:7>AD8IS/P<MY_GRIDSQUARE:6>EM89AB<MY_SOTA_REF:10>W8O/SE-004<MY_POTA_REF:7>US-5450<EOR>",
    form: async (form, state) => {
      forms.push({ form, state })
      return answers.shift() ?? null
    },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method ?? "GET", body: options.body })
      assert.equal(options.headers?.Authorization, `Bearer ${credentials.token}`)
      if (url.endsWith("/token")) return response({ id: 1, scopes })
      if (url.endsWith("/station") && options.method === "POST") {
        created = true
        return response(station)
      }
      if (url.endsWith("/station")) return response(created ? [station] : [])
      if (url.endsWith("/logbook")) return response([{ id: 2, name: "Main", active: true, station_ids: [1] }])
      if (url.endsWith("/logbook/2")) return response({ id: 2, active: true, station_ids: options.method === "PATCH" ? [1, 3, 9] : [1, 3] })
      if (url.includes("/lookup?")) return response({ dxcc_id: 291, dxcc: "UNITED STATES", dxcc_cqz: 5 })
      assert.fail(`Unexpected endpoint ${url}`)
    },
    saveSession: async () => assert.fail("Must not save credentials/session"),
    showMessage: async () => {},
  }
  return { services, calls, forms, answers }
}
const writes = (calls: ReturnType<typeof fixture>["calls"]) => calls.filter((c) => c.method !== "GET")

test("reviewed creation posts station once, preserves logbook links and never imports QSOs", async () => {
  const { services, calls, forms } = fixture()
  const result = await createLocation(services, op, {}, context)
  assert.match(result, /Created station ID 9/)
  assert.equal(forms.length, 2)
  const mutations = writes(calls)
  assert.equal(mutations.length, 2)
  const payload = JSON.parse(mutations[0].body!)
  assert.equal(payload.sota, "W8O/SE-004")
  assert.equal(payload.pota, "US-5450")
  assert.equal(payload.clublog_upload, "disabled")
  assert.equal(payload.power, undefined)
  assert.deepEqual(JSON.parse(mutations[1].body!).station_ids, [1, 3, 9])
  assert.equal(
    calls.some((c) => c.url.includes("/qso")),
    false,
  )
  assert.equal(calls.filter((c) => c.url.endsWith("/station") && c.method === "GET").length, 2)
})

test("upload button reviews a missing station before a separate QSO confirmation", async () => {
  const f = fixture()
  f.answers.push({ confirm: true })
  const originalFetch = f.services.fetch
  f.services.fetch = async (url, options) => {
    if (url.endsWith("/token")) return response({ id: 1, scopes: [...scopes, "qso:write"] })
    if (url.endsWith("/qso")) {
      f.calls.push({ url, method: options.method ?? "GET", body: options.body })
      assert.equal(JSON.parse(options.body!).station_profile_id, 9)
      return response({ parsed: 1, imported: 1, skipped: 0, messages: [] })
    }
    return originalFetch(url, options)
  }
  const messages: string[] = []
  f.services.showMessage = async (message) => {
    messages.push(message.text)
  }
  await createOperationPanel("test", f.services).onEvent!(
    {
      panelKey: "operation",
      operation: op,
      qsoCount: 1,
      config: {},
      reason: "initial",
      event: { controlId: "upload", action: "upload", phase: "activate", sequence: 1 },
    },
    context,
  )
  assert.equal(f.forms.length, 3)
  assert.deepEqual(
    writes(f.calls).map((call) => call.url.split("/").pop()),
    ["station", "2", "qso"],
  )
  assert.match(messages[0], /Imported: 1/)
})

test("cancelling station creation from the upload button performs no writes", async () => {
  const f = fixture()
  f.answers.splice(0, f.answers.length, null)
  const originalFetch = f.services.fetch
  f.services.fetch = async (url, options) => (url.endsWith("/token") ? response({ id: 1, scopes: [...scopes, "qso:write"] }) : originalFetch(url, options))
  const messages: string[] = []
  f.services.showMessage = async (message) => {
    messages.push(message.text)
  }
  await createOperationPanel("test", f.services).onEvent!(
    {
      panelKey: "operation",
      operation: op,
      qsoCount: 1,
      config: {},
      reason: "initial",
      event: { controlId: "upload", action: "upload", phase: "activate", sequence: 1 },
    },
    context,
  )
  assert.equal(writes(f.calls).length, 0)
  assert.match(messages[0], /cancelled/)
})

test("upload permission is checked before the button creates a station", async () => {
  const f = fixture()
  const messages: string[] = []
  f.services.showMessage = async (message) => {
    messages.push(message.text)
  }
  await createOperationPanel("test", f.services).onEvent!(
    {
      panelKey: "operation",
      operation: op,
      qsoCount: 1,
      config: {},
      reason: "initial",
      event: { controlId: "upload", action: "upload", phase: "activate", sequence: 1 },
    },
    context,
  )
  assert.equal(f.forms.length, 0)
  assert.equal(writes(f.calls).length, 0)
  assert.match(messages[0], /qso:write/)
})

test("cancellation or an unchecked confirmation never writes", async () => {
  for (const answers of [[null], [{ group: 0, lookup: false }, null], [{ group: 0, lookup: false }, { confirm: false }]]) {
    const fixture1 = fixture()
    fixture1.answers.splice(0, 2, ...answers)
    assert.match(await createLocation(fixture1.services, op, {}, context), /cancelled/)
    assert.equal(writes(fixture1.calls).length, 0)
  }
})

test("invalid required metadata blocks mutation after review", async () => {
  const f = fixture()
  f.answers[1] = { ...f.answers[1], itu: 0 }
  await assert.rejects(createLocation(f.services, op, {}, context), /ITU zone/)
  assert.equal(writes(f.calls).length, 0)
})

test("optional lookup fills missing DXCC/CQ but does not invent ITU", async () => {
  const f = fixture()
  f.answers[0] = { group: 0, lookup: true }
  await createLocation(f.services, op, {}, context)
  const review = f.forms[1] as { state: Record<string, unknown> }
  assert.equal(review.state.dxcc, "291")
  assert.equal(review.state.cq, "5")
  assert.equal(review.state.itu, "")
  assert.equal(f.calls.filter((c) => c.url.includes("lookup?")).length, 1)
})

test("an existing match is reused without forms or mutations", async () => {
  const f = fixture()
  const fetch = f.services.fetch
  f.services.fetch = async (url, options) => (url.endsWith("/station") ? response([station]) : fetch(url, options))
  assert.match(await createLocation(f.services, op, {}, context), /No safely identifiable new/)
  assert.equal(f.forms.length, 0)
  assert.equal(writes(f.calls).length, 0)
})

test("new exact match appearing during review prevents creation", async () => {
  const f = fixture()
  const fetch = f.services.fetch
  let reads = 0
  f.services.fetch = async (url, options) => {
    if (url.endsWith("/station") && ++reads === 2) return response([station])
    return fetch(url, options)
  }
  assert.match(await createLocation(f.services, op, {}, context), /will be reused/)
  assert.equal(writes(f.calls).length, 0)
})

test("missing create scope or active logbook blocks mutation", async () => {
  for (const resource of ["token", "logbook"]) {
    const f = fixture(),
      fetch = f.services.fetch
    f.services.fetch = async (url, options) =>
      url.endsWith("/" + resource) ? response(resource === "token" ? { id: 1, scopes: ["station:read"] } : []) : fetch(url, options)
    await assert.rejects(createLocation(f.services, op, {}, context), /requires|requires exactly/)
    assert.equal(writes(f.calls).length, 0)
  }
})

test("creation timeout is never retried, and errors do not expose token", async () => {
  const f = fixture(),
    fetch = f.services.fetch
  let posts = 0
  f.services.fetch = async (url, options) => {
    if (options.method === "POST") {
      posts++
      throw new Error(credentials.token)
    }
    return fetch(url, options)
  }
  await assert.rejects(createLocation(f.services, op, {}, context), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /uncertain/)
    assert.ok(!error.message.includes(credentials.token))
    return true
  })
  assert.equal(posts, 1)
})

test("link failure reports the created station ID without repeating creation", async () => {
  const f = fixture(),
    fetch = f.services.fetch
  f.services.fetch = async (url, options) => (options.method === "PATCH" ? { status: 500, body: "secret" } : fetch(url, options))
  await assert.rejects(createLocation(f.services, op, {}, context), /Station ID 9 was created.*linking is incomplete/)
  assert.equal(writes(f.calls).filter((c) => c.method === "POST").length, 1)
})

test("creation conflict resolves a single visible exact match without a second POST", async () => {
  const f = fixture(),
    fetch = f.services.fetch
  let conflict = false
  f.services.fetch = async (url, options) => {
    if (options.method === "POST") {
      conflict = true
      return { status: 409, body: "conflict" }
    }
    if (conflict && url.endsWith("/station")) return response([station])
    return fetch(url, options)
  }
  assert.match(await createLocation(f.services, op, {}, context), /creation conflict/)
})

test("changed or unavailable local snapshot blocks creation after forms", async () => {
  const f = fixture()
  let reads = 0
  const changing: HookContext = { ...context, getQsos: async () => (++reads === 1 ? [{ band: "20m" }] : []) }
  await assert.rejects(createLocation(f.services, op, {}, changing), /preview changed/)
  assert.equal(writes(f.calls).length, 0)
})

test("lookup failure still offers a manual metadata form", async () => {
  const f = fixture(),
    fetch = f.services.fetch
  f.answers[0] = { group: 0, lookup: true }
  f.services.fetch = async (url, options) => (url.includes("lookup?") ? { status: 500, body: "failure" } : fetch(url, options))
  assert.match(await createLocation(f.services, op, {}, context), /Created station ID 9/)
  const form = f.forms[1] as { form: { elements: unknown[] } }
  assert.match(JSON.stringify(form), /lookup failed/)
})

test("an active-logbook change during review stops before POST", async () => {
  const f = fixture(),
    fetch = f.services.fetch
  f.services.fetch = async (url, options) => (url.endsWith("/logbook/2") ? response({ id: 2, active: false, station_ids: [1] }) : fetch(url, options))
  await assert.rejects(createLocation(f.services, op, {}, context), /active logbook changed/)
  assert.equal(writes(f.calls).length, 0)
})

test("source metadata prepopulates the form and is not overwritten by lookup", async () => {
  const f = fixture(),
    preview = f.services.preview!
  f.services.preview = async (request) => (await preview(request)).replace("<EOR>", "<MY_DXCC:3>291<MY_CQ_ZONE:1>4<MY_ITU_ZONE:1>8<EOR>")
  f.answers[0] = { group: 0, lookup: true }
  await createLocation(f.services, op, {}, context)
  const review = f.forms[1] as { state: Record<string, unknown> }
  assert.deepEqual([review.state.dxcc, review.state.cq, review.state.itu], ["291", "4", "8"])
  assert.equal(
    f.calls.some((c) => c.url.includes("lookup?")),
    false,
  )
})
