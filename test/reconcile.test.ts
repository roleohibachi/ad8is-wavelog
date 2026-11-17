import assert from "node:assert/strict"
import { test } from "node:test"
import { reconcile } from "../src/reconcile.ts"
import { MATCH_FIELDS, previewOperation } from "../src/preview.ts"
import type { Station } from "../src/wavelog.ts"
const group = { values: ["AD8IS/P", "EM89AB", "W8O/SE-004", "US-5450"], count: 25, name: "anything" }
const station: Station = {
  id: 7,
  name: "Unrelated name",
  callsign: "AD8IS/P",
  grid: "EM89AB",
  sota: "W8O/SE-004",
  pota: "US-5450",
  identity: { callsign: "AD8IS/P", gridsquare: "EM89AB", sota: "W8O/SE-004", pota: "US-5450" },
}
const status = (stations: Station[]) => reconcile([group], MATCH_FIELDS, 6, stations)[0]
test("all structured fields match independently of profile naming", () => {
  assert.equal(status([station]).status, "existing")
  assert.equal(status([station]).matches[0].id, 7)
  for (const field of ["callsign", "gridsquare", "sota", "pota"]) {
    assert.equal(status([{ ...station, identity: { ...station.identity, [field]: "DIFFERENT" } }]).status, "new")
  }
})
test("empty refs differ from present refs, and unavailable fields block a possible match", () => {
  assert.equal(status([{ ...station, identity: { ...station.identity, sota: null } }]).status, "new")
  const identity = { ...station.identity }
  delete identity.sota
  assert.equal(status([{ ...station, identity }]).status, "blocked")
  assert.equal(status([{ ...station, identity: { ...identity, callsign: "OTHER" } }]).status, "new")
  assert.equal(status([station, { ...station, id: 8, identity }]).status, "blocked")
})
test("multiple exact matches are ambiguous, not first-match wins", () => {
  const result = status([station, { ...station, id: 8 }])
  assert.equal(result.status, "ambiguous")
  assert.equal(result.matches.length, 2)
})
test("reference sets and case normalize; supersets and nearby grids do not match", () => {
  const combined = { ...group, values: ["ad8is/p", "EM89AB", "W8O/SE-004", "US-0001,US-5450"] }
  const current = { ...station, identity: { ...station.identity, callsign: "ad8is/p", pota: "US-5450; US-0001" } }
  assert.equal(reconcile([combined], MATCH_FIELDS, 6, [current])[0].status, "existing")
  assert.equal(status([current]).status, "new")
  assert.equal(status([{ ...station, identity: { ...station.identity, gridsquare: "EM89AC" } }]).status, "new")
  const coarse = { ...group, values: ["AD8IS/P", "EM89", "W8O/SE-004", "US-5450"] }
  assert.equal(reconcile([coarse], MATCH_FIELDS, 4, [station])[0].status, "existing")
})
test("unsupported field mappings block even when no stations exist", () => {
  assert.equal(reconcile([{ ...group, values: [...group.values, ""] }], [...MATCH_FIELDS, "UNKNOWN"], 6, [])[0].status, "blocked")
})
test("automatic names omit absent refs, date and call; custom formats remain explicit", async () => {
  for (const [sota, pota, expected] of [
    ["W8O/SE-004", "US-5450", "W8O/SE-004, US-5450, EM89AB"],
    ["", "US-5450", "US-5450, EM89AB"],
    ["W8O/SE-004", "", "W8O/SE-004, EM89AB"],
    ["", "", "EM89AB"],
  ]) {
    const result = await previewOperation(
      { uuid: "op", stationCall: "AD8IS/P" },
      { online: false, getQsos: async () => [{ band: "20m" }] },
      async () =>
        Object.entries({ CALL: "W1AW", STATION_CALLSIGN: "AD8IS/P", MY_GRIDSQUARE: "EM89AB", MY_SOTA_REF: sota, MY_POTA_REF: pota })
          .map(([k, v]) => `<${k}:${v.length}>${v}`)
          .join("") + "<EOR>",
    )
    assert.equal(result.groups[0].name, expected)
  }
})
