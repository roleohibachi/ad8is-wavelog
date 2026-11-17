import assert from "node:assert/strict"
import { test } from "node:test"
import type { HookContext } from "@ham2k/extension-sdk"
import type { Services } from "../src/account.ts"
import { classify, chunks, encodeRecord, uploadOperation } from "../src/upload.ts"
import { parseAdif } from "../src/preview.ts"
import { createOperationPanel } from "../src/panel.ts"
const op = { uuid: "op", stationCall: "AD8IS/P", grid: "EM89AB" }
const credentials = { url: "https://log.example.org", token: "wl2_SYNTHETIC" }
const stations = [
  { id: 7, name: "Different name", callsign: "AD8IS/P", gridsquare: "EM89AB", sota: "", pota: "" },
  { id: 8, name: "Second", callsign: "AD8IS/P", gridsquare: "EM90AB", sota: "", pota: "" },
]
function fixture(count = 25) {
  const calls: { method: string; url: string; body?: string }[] = []
  let confirmed = true
  const rows = Array.from({ length: count }, (_, i) => ({ band: "20m", startAtMillis: i + 1, power: i % 2 ? 20 : 5, their: { call: `W${i}AW` } }))
  const context: HookContext = { online: true, account: { credentials }, getQsos: async () => rows, getOperation: async () => op }
  const services: Services = {
    preview: async (request) =>
      "<EOH>" +
      request.qsos
        .map((q) =>
          encodeRecord({
            CALL: String((q.their as Record<string, string>).call),
            STATION_CALLSIGN: "AD8IS/P",
            MY_GRIDSQUARE: String((q.our as Record<string, string>).grid),
            QSO_DATE: "20261116",
            TIME_ON: "120000",
            BAND: "20m",
            MODE: "CW",
            TX_PWR: String(q.power),
          }),
        )
        .join(""),
    form: async () => ({ confirm: confirmed }),
    showMessage: async () => {},
    saveSession: async () => assert.fail("No uploaded flags or credentials should be saved"),
    fetch: async (url, options) => {
      calls.push({ url, method: options.method ?? "GET", body: options.body })
      assert.equal(options.headers?.Authorization, `Bearer ${credentials.token}`)
      let data: unknown
      if (url.endsWith("/token")) data = { id: 1, scopes: ["station:read", "qso:write"] }
      else if (url.endsWith("/station")) data = stations
      else if (url.endsWith("/qso")) {
        assert.equal(options.method, "POST")
        const payload = JSON.parse(options.body!)
        assert.equal(payload.import_type, "adif")
        const n = parseAdif(payload.adif).length
        data = { parsed: n, imported: n, skipped: 0, messages: [] }
      } else assert.fail("Unexpected endpoint")
      return { status: 200, body: JSON.stringify({ data }) }
    },
  }
  return {
    services,
    context,
    calls,
    rows,
    cancel: () => {
      confirmed = false
    },
  }
}
const posts = (calls: ReturnType<typeof fixture>["calls"]) => calls.filter((c) => c.method === "POST")
test("uploads sequential bounded ADIF batches to reviewed station, retaining power", async () => {
  const f = fixture()
  const result = await uploadOperation(f.services, op, {}, f.context)
  assert.deepEqual([result.imported, result.duplicates, result.uncertain, result.unattempted], [25, 0, 0, 0])
  assert.equal(posts(f.calls).length, 2)
  for (const call of posts(f.calls)) {
    const payload = JSON.parse(call.body!)
    assert.equal(payload.station_profile_id, 7)
    const records = parseAdif(payload.adif)
    assert.ok(records.length <= 20)
    assert.ok(records.every((r) => ["5", "20"].includes(r.TX_PWR)))
  }
})
test("cancel never writes; missing or changed targets block before any POST", async () => {
  const f = fixture()
  f.cancel()
  assert.equal((await uploadOperation(f.services, op, {}, f.context)).cancelled, true)
  assert.equal(posts(f.calls).length, 0)
  const g = fixture(),
    original = g.services.fetch
  g.services.fetch = async (url, options) => (url.endsWith("/station") ? { status: 200, body: JSON.stringify({ data: [] }) } : original(url, options))
  await assert.rejects(uploadOperation(g.services, op, {}, g.context), /every group needs/i)
  assert.equal(posts(g.calls).length, 0)
  const h = fixture(),
    fetch = h.services.fetch
  let lists = 0
  h.services.fetch = async (url, options) =>
    url.endsWith("/station") && ++lists === 2 ? { status: 200, body: JSON.stringify({ data: [{ ...stations[0], id: 99 }] }) } : fetch(url, options)
  await assert.rejects(uploadOperation(h.services, op, {}, h.context), /targets changed/)
  assert.equal(posts(h.calls).length, 0)
})
test("all duplicates and valid mixed outcomes are counted from aggregates", () => {
  assert.deepEqual(classify({ parsed: 3, imported: 0, skipped: 3, messages: [] }, 3), { imported: 0, duplicates: 3, rejected: 0, uncertain: 0 })
  assert.deepEqual(classify({ parsed: 3, imported: 1, skipped: 1, messages: ["validation failed"] }, 3), {
    imported: 1,
    duplicates: 1,
    rejected: 1,
    uncertain: 0,
  })
  for (const data of [
    { parsed: 3, imported: 4, skipped: 0, messages: [] },
    { parsed: 2, imported: 2, skipped: 0, messages: [] },
    { parsed: 3, imported: 3, skipped: 0, messages: ["error"] },
    {},
  ])
    assert.equal(classify(data, 3).uncertain, 3)
})
test("a timed-out batch is uncertain and remaining contacts are not sent or retried", async () => {
  const f = fixture(45),
    fetch = f.services.fetch
  let postCount = 0
  f.services.fetch = async (url, options) => {
    if (options.method === "POST" && ++postCount === 2) throw new Error(credentials.token)
    return fetch(url, options)
  }
  const result = await uploadOperation(f.services, op, {}, f.context)
  assert.deepEqual([result.imported, result.uncertain, result.unattempted], [20, 20, 5])
  assert.equal(postCount, 2)
  assert.ok(!JSON.stringify(result).includes(credentials.token))
})
test("a partial validation result stops further batches with accurate totals", async () => {
  const f = fixture(25),
    fetch = f.services.fetch
  f.services.fetch = async (url, options) =>
    options.method === "POST"
      ? { status: 201, body: JSON.stringify({ data: { parsed: 20, imported: 10, skipped: 5, messages: [credentials.token] } }) }
      : fetch(url, options)
  const result = await uploadOperation(f.services, op, {}, f.context)
  assert.deepEqual([result.imported, result.duplicates, result.rejected, result.unattempted], [10, 5, 5, 5])
  assert.ok(!JSON.stringify(result).includes(credentials.token))
})
test("contact edits during review block upload even when count and identity remain the same", async () => {
  const f = fixture(1)
  f.services.form = async () => {
    f.rows[0].power = 100
    return { confirm: true }
  }
  await assert.rejects(uploadOperation(f.services, op, {}, f.context), /contact data changed/)
  assert.equal(posts(f.calls).length, 0)
})
test("separate groups go to their own station IDs", async () => {
  const f = fixture(2)
  const ctx = {
    ...f.context,
    getQsos: async () => [f.rows[0], { band: "event", startAtMillis: 2, event: { event: "break", operation: { grid: "EM90AB" } } }, f.rows[1]],
  }
  const result = await uploadOperation(f.services, op, {}, ctx)
  assert.equal(result.imported, 2)
  assert.deepEqual(
    posts(f.calls).map((call) => JSON.parse(call.body!).station_profile_id),
    [7, 8],
  )
})
test("oversized contacts are rejected before upload and ADIF serialization is Unicode-safe", () => {
  assert.throws(() => chunks([{ CALL: "W1AW", COMMENT: "x".repeat(21000) }]), /batch limit/)
  assert.equal(parseAdif(encodeRecord({ CALL: "W1AW", COMMENT: "😀 café <EOR>" }))[0].COMMENT, "😀 café <EOR>")
})

test("structured HTTP 400 reports known zero-import validation counts without echoing diagnostics", async () => {
  const f = fixture(3),
    fetch = f.services.fetch
  f.services.fetch = async (url, options) =>
    options.method === "POST"
      ? {
          status: 400,
          body: JSON.stringify({ error: { code: "validation_error", details: { duplicate: ["one"], validation: [credentials.token], critical: [] } } }),
        }
      : fetch(url, options)
  const result = await uploadOperation(f.services, op, {}, f.context)
  assert.deepEqual([result.imported, result.duplicates, result.rejected, result.uncertain], [0, 1, 2, 0])
  assert.ok(!JSON.stringify(result).includes(credentials.token))
})

test("missing qso:write blocks every POST, and empty operations do not prompt for upload", async () => {
  const f = fixture(),
    fetch = f.services.fetch
  f.services.fetch = async (url, options) =>
    url.endsWith("/token") ? { status: 200, body: JSON.stringify({ data: { id: 1, scopes: ["station:read"] } }) } : fetch(url, options)
  await assert.rejects(uploadOperation(f.services, op, {}, f.context), /qso:write/)
  assert.equal(posts(f.calls).length, 0)
  const empty = fixture(0)
  empty.services.form = async () => assert.fail("No contacts to review")
  assert.equal((await uploadOperation(empty.services, op, {}, empty.context)).unattempted, 0)
  assert.equal(posts(empty.calls).length, 0)
})

test("qso permission removed during review stops before import", async () => {
  const f = fixture(),
    fetch = f.services.fetch
  let reads = 0
  f.services.fetch = async (url, options) =>
    url.endsWith("/token") && ++reads === 2 ? { status: 200, body: JSON.stringify({ data: { id: 1, scopes: ["station:read"] } }) } : fetch(url, options)
  await assert.rejects(uploadOperation(f.services, op, {}, f.context), /permission changed/)
  assert.equal(posts(f.calls).length, 0)
})

test("a large operation uploads every exported contact once and reports each batch", async () => {
  const f = fixture(1000)
  const progress: string[] = []
  const result = await uploadOperation(f.services, op, {}, f.context, (message) => {
    progress.push(message)
  })
  const sent = posts(f.calls).flatMap((call) => parseAdif(JSON.parse(call.body!).adif))
  assert.equal(result.imported, 1000)
  assert.equal(result.unattempted, 0)
  assert.equal(result.batches.length, 50)
  assert.equal(sent.length, 1000)
  assert.equal(new Set(sent.map((record) => record.CALL)).size, 1000)
  assert.equal(progress.length, 51)
  assert.match(progress[progress.length - 1], /981–1000 of 1000/)
})

test("unavailable result dialogs preserve confirmed upload counts and release the panel", async () => {
  const f = fixture(1)
  f.services.showMessage = async () => {
    throw new Error(credentials.token)
  }
  const panel = createOperationPanel("test", f.services)
  const args = { panelKey: "operation", operation: op, qsoCount: 1, config: {}, reason: "initial" as const }
  const event = { controlId: "menu", action: "upload", phase: "activate" as const, sequence: 1 }
  await panel.onEvent!({ ...args, event }, f.context)
  const content = await panel.render(args, f.context)
  if (content.kind !== "scene") assert.fail("Expected scene")
  assert.match(JSON.stringify(content), /imported 1, duplicates 0/)
  assert.match(JSON.stringify(content), /Result dialog unavailable/)
  assert.ok(!JSON.stringify(content).includes(credentials.token))
  assert.equal(posts(f.calls).length, 1)
  // A subsequent explicit cancellation opens a new review, with no new write.
  f.cancel()
  await panel.onEvent!({ ...args, event }, f.context)
  assert.equal(posts(f.calls).length, 1)
  const cancelled = await panel.render(args, f.context)
  if (cancelled.kind !== "scene") assert.fail("Expected scene")
  assert.match(JSON.stringify(cancelled), /cancelled; imported 0/)
})

test("an offline attempt makes no import and a later action uses the newly selected server", async () => {
  const f = fixture(1),
    fetch = f.services.fetch
  f.services.fetch = async () => {
    throw new Error(credentials.token)
  }
  await assert.rejects(uploadOperation(f.services, op, {}, f.context), /Connection failed/)
  assert.equal(posts(f.calls).length, 0)
  f.services.fetch = fetch
  await uploadOperation(f.services, op, {}, { ...f.context, account: { credentials: { ...credentials, url: "https://other.example.org/wavelog" } } })
  assert.ok(f.calls.every((call) => call.url.startsWith("https://other.example.org/wavelog/api/v2/")))
  assert.equal(posts(f.calls).length, 1)
})
