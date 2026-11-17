import assert from "node:assert/strict"
import { test } from "node:test"
import { parseAdif, prepareExports, previewOperation } from "../src/preview.ts"
import type { ExportRequest, HookContext, JSONValue } from "@ham2k/extension-sdk"

type Row = Record<string, JSONValue>
const base: Row = { uuid: "op", stationCall: "AD8IS/P", grid: "EM89AB", refs: [{ type: "sota", ref: "W8O/SE-004" }] }
const qso = (time: number, extra: Row = {}): Row => ({ startAtMillis: time, band: "20m", their: { call: "W1AW" }, power: 5, ...extra })
const boundary = (time: number, operation: Row): Row => ({ startAtMillis: time, band: "event", event: { event: "break", operation } })
const ctx = (rows: Row[] | null): HookContext => ({ online: false, getQsos: async () => rows })
function adif(fields: Record<string, string>) {
  return (
    Object.entries(fields)
      .map(([k, v]) => `<${k}:${Array.from(v).length}>${v}`)
      .join("") + "<EOR>"
  )
}
const exporter = async (request: ExportRequest) =>
  "<ADIF_VER:5>3.1.5<EOH>" +
  request.qsos
    .map((q) => {
      const our = q.our as Row
      const refs = request.operation.refs as Row[]
      return adif({
        CALL: "W1AW",
        STATION_CALLSIGN: String(request.operation.stationCall),
        MY_GRIDSQUARE: String(our.grid),
        MY_SOTA_REF: String(refs.find((r) => r.type === "sota")?.ref ?? ""),
        MY_POTA_REF: String(refs.find((r) => r.type === "pota")?.ref ?? ""),
        TX_PWR: String(q.power),
      })
    })
    .join("")

test("segment overrides replace the base, do not accumulate, and a boundary contact belongs to the new segment", () => {
  const rows = [qso(1), boundary(2, { grid: "EM90CD" }), qso(2), boundary(4, { refs: [{ type: "pota", ref: "US-5450" }] }), qso(5)]
  const result = prepareExports(base, rows)
  assert.equal(result.length, 3)
  assert.equal((result[1].qsos[0].our as Row).grid, "EM90CD")
  assert.equal((result[2].qsos[0].our as Row).grid, "EM89AB")
  assert.deepEqual(result[2].operation.refs, [{ type: "pota", ref: "US-5450" }])
  assert.equal(result[1].qsos[0].startAtMillis, 2)
  assert.equal(rows[0].our, undefined)
})

test("a marker with no operation override does not reset a preceding location", () => {
  const result = prepareExports(base, [boundary(1, { grid: "EM90CD" }), qso(2), { band: "event", startAtMillis: 3, event: { event: "break" } }, qso(4)])
  assert.equal(result.length, 1)
  assert.equal(result[0].qsos.length, 2)
  assert.equal((result[0].qsos[1].our as Row).grid, "EM90CD")
})

test("explicit contact location is preserved as a unit; power is preserved and input can be frozen", () => {
  const own = Object.freeze({ lat: 45, lon: -80 })
  const row = Object.freeze(qso(1, { our: own, power: 20 }))
  const [request] = prepareExports(base, [row])
  assert.deepEqual(request.qsos[0].our, { lat: 45, lon: -80, call: "AD8IS/P" })
  assert.equal(request.qsos[0].power, 20)
  assert.deepEqual(own, { lat: 45, lon: -80 })
})

test("ADIF parsing honors Unicode character lengths and embedded EOR-looking text", () => {
  const result = parseAdif("<PROGRAMID:4>Test<EOH>" + adif({ CALL: "W1AW", COMMENT: "😀 <EOR> café" }))
  assert.equal(result.length, 1)
  assert.equal(result[0].COMMENT, "😀 <EOR> café")
  assert.throws(() => parseAdif("<CALL:99>X<EOR>"), /field length/)
  assert.throws(() => parseAdif("<CALL:4>W1AW"), /unterminated/)
})

test("returning to an earlier combination reuses the group; changed power and identical-identity breaks do not split it", async () => {
  const rows = [qso(1), boundary(2, { grid: "EM90CD" }), qso(3), boundary(4, {}), qso(5, { power: 20 }), boundary(6, {}), qso(7)]
  const result = await previewOperation(base, ctx(rows), exporter)
  assert.equal(result.count, 4)
  assert.equal(result.groups.length, 2)
  assert.equal(result.groups[0].count, 3)
  assert.equal(result.groups[0].name, "W8O/SE-004")
  assert.equal(result.groups[1].count, 1)
})

test("same grid with different refs or callsigns stays separate, with blank refs meaningful", async () => {
  const rows = [
    qso(1),
    boundary(2, {
      refs: [
        { type: "sota", ref: "W8O/SE-004" },
        { type: "pota", ref: "US-5450" },
      ],
    }),
    qso(3),
    boundary(4, { refs: [], stationCall: "AD8IS" }),
    qso(5),
  ]
  const result = await previewOperation(base, ctx(rows), exporter)
  assert.equal(result.groups.length, 3)
  assert.deepEqual(result.groups[1].values, ["AD8IS/P", "EM89AB", "W8O/SE-004", "US-5450"])
  assert.deepEqual(result.groups[2].values, ["AD8IS", "EM89AB", "", ""])
})

test("unknown logs, missing identity, exporter failures and record expansion stop preview", async () => {
  await assert.rejects(previewOperation(base, ctx(null), exporter), /not an empty log/)
  await assert.rejects(
    previewOperation(base, ctx([qso(1)]), async () => adif({ CALL: "W1AW" })),
    /lack a station callsign or grid/,
  )
  await assert.rejects(
    previewOperation(base, ctx([qso(1)]), async () => {
      throw new Error("hidden internals")
    }),
    /ADIF exporter failed/,
  )
  await assert.rejects(
    previewOperation(base, ctx([qso(1)]), async () => "<EOH>"),
    /record count differs/,
  )
  const empty = await previewOperation(base, ctx([]), async () => assert.fail("Empty logs must not export"))
  assert.equal(empty.count, 0)
  assert.deepEqual(empty.groups, [])
})

test("preview settings honor reordered match fields, four-character grids and naming placeholders", async () => {
  const result = await previewOperation(base, ctx([qso(1)]), exporter, {
    matchFields: "MY_GRIDSQUARE,STATION_CALLSIGN",
    nameFormat: "{STATION_CALLSIGN} @ {MY_GRIDSQUARE}",
    gridPrecision: 4,
  })
  assert.deepEqual(result.groups[0].values, ["EM89", "AD8IS/P"])
  assert.equal(result.groups[0].name, "AD8IS/P @ EM89")
  await assert.rejects(previewOperation(base, ctx([]), exporter, { matchFields: "STATION_CALLSIGN,MY_GRIDSQUARE,TX_PWR" }), /Power is per QSO/)
  await assert.rejects(previewOperation(base, ctx([]), exporter, { gridPrecision: 5 }), /precision/)
  await assert.rejects(previewOperation(base, ctx([]), exporter, { nameFormat: "{UNKNOWN}" }), /placeholder/)
})

test("multi-reference ordering is not identity and a blank template uses automatic naming", async () => {
  const result = await previewOperation(
    base,
    ctx([qso(1), qso(2)]),
    async () =>
      adif({ CALL: "W1AW", STATION_CALLSIGN: "AD8IS/P", MY_GRIDSQUARE: "EM89AB", MY_POTA_REF: "US-0002,US-0001" }) +
      adif({ CALL: "W1AW", STATION_CALLSIGN: "AD8IS/P", MY_GRIDSQUARE: "EM89AB", MY_POTA_REF: "US-0001; US-0002" }),
    { nameFormat: "" },
  )
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].count, 2)
  assert.equal(result.groups[0].name, "AD8IS/P @ EM89AB US-0001,US-0002")
})

test("missing activation hooks cannot silently erase a known SOTA/POTA identity", async () => {
  const operation = { ...base, refs: [{ type: "potaActivation", ref: "US-5450" }] }
  await assert.rejects(
    previewOperation(operation, ctx([qso(1)]), async () => adif({ CALL: "W1AW", STATION_CALLSIGN: "AD8IS/P", MY_GRIDSQUARE: "EM89AB" })),
    /omitted an activation reference/,
  )
})
