import type { ExportRequest, HookContext, JSONValue } from "@ham2k/extension-sdk"
import { WavelogError } from "./wavelog.ts"

type Row = Record<string, JSONValue>
export type Exporter = (request: ExportRequest) => Promise<string>
export const MATCH_FIELDS = ["STATION_CALLSIGN", "MY_GRIDSQUARE", "MY_SOTA_REF", "MY_POTA_REF"]
export type Group = { metadata?: Record<string, string>; values: string[]; count: number; name: string }
const map = (v: JSONValue | undefined): Row => (v && typeof v === "object" && !Array.isArray(v) ? v : {})

// Resolve each boundary against the BASE operation. Overrides do not accumulate.
// Export separate effective stretches so both core fields and activity hooks
// receive the correct operation. Never mutate Halo's shared/frozen log objects.
export function prepareExports(base: Row, rows: Row[]): ExportRequest[] {
  const boundaries = rows
    .filter(
      (r) =>
        r.band === "event" &&
        r.deleted !== true &&
        map(r.event).operation != null &&
        typeof map(r.event).operation === "object" &&
        !Array.isArray(map(r.event).operation) &&
        ["break", "start"].includes(String(map(r.event).event)),
    )
    .sort((a, b) => Number(a.startAtMillis ?? 0) - Number(b.startAtMillis ?? 0))
  const slices = new Map<string, ExportRequest>()
  for (const row of rows) {
    if (row.band === "event" || row.deleted === true) continue
    const at = Number(row.startAtMillis ?? 0)
    let effective = base
    let segment = -1
    boundaries.forEach((boundary, i) => {
      if (Number(boundary.startAtMillis ?? 0) <= at) {
        effective = { ...base, ...map(map(boundary.event).operation) }
        segment = i
      }
    })
    const our = { ...map(row.our) }
    const call = String(our.call ?? effective.stationCall ?? "").trim()
    if (!call || /[,;\s]/.test(call))
      throw new WavelogError("Preview needs one resolved station callsign per contact. Check the operation/segment station call.")
    for (const key of ["state", "county"]) if (our[key] == null && effective[key] != null) our[key] = effective[key]
    if (our.grid == null && our.lat == null && our.lon == null) {
      for (const key of ["grid", "lat", "lon", "gridSource"]) if (effective[key] != null) our[key] = effective[key]
    }
    our.call = call
    const key = JSON.stringify([segment, call.toUpperCase()])
    let request = slices.get(key)
    if (!request) {
      request = { operation: { ...effective, stationCall: call }, qsos: [], exportType: "adif", includePrivateData: false, includeLookupData: false }
      slices.set(key, request)
    }
    request.qsos.push({ ...row, our })
  }
  return [...slices.values()]
}

// Consume length-delimited fields rather than splitting at text that happens
// to look like an ADIF tag inside a comment. ADIF lengths count characters.
export function parseAdif(source: string): Record<string, string>[] {
  const chars = Array.from(source)
  const records: Record<string, string>[] = []
  let row: Record<string, string> = {}
  let pos = 0
  while (pos < chars.length) {
    if (chars[pos] !== "<") {
      pos++
      continue
    }
    const start = ++pos
    while (pos < chars.length && chars[pos] !== ">") pos++
    if (pos === chars.length) throw new WavelogError("The ADIF exporter returned an incomplete tag.")
    const tag = chars.slice(start, pos++).join("").toUpperCase()
    if (tag === "EOH") {
      row = {}
      continue
    }
    if (tag === "EOR") {
      if (row.CALL) records.push(row)
      row = {}
      continue
    }
    const match = /^([A-Z0-9_]+):(\d+)(?::[A-Z])?$/.exec(tag)
    if (!match) throw new WavelogError("The ADIF exporter returned an unsupported tag.")
    const length = Number(match[2])
    if (!Number.isSafeInteger(length) || pos + length > chars.length) throw new WavelogError("The ADIF exporter returned an invalid field length.")
    row[match[1]] = chars.slice(pos, pos + length).join("")
    pos += length
  }
  if (Object.keys(row).length) throw new WavelogError("The ADIF exporter returned an unterminated contact.")
  return records
}

export async function previewOperation(
  operation: Row,
  ctx: HookContext,
  exporter: Exporter,
  config: Row = {},
): Promise<{ groups: Group[]; count: number; fields: string[]; precision: number }> {
  const fields = String(config.matchFields ?? MATCH_FIELDS.join(","))
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
  if (
    new Set(fields).size !== fields.length ||
    !fields.includes("STATION_CALLSIGN") ||
    !fields.includes("MY_GRIDSQUARE") ||
    fields.some(
      (f) =>
        ![
          "STATION_CALLSIGN",
          "MY_GRIDSQUARE",
          "MY_SOTA_REF",
          "MY_POTA_REF",
          "MY_WWFF_REF",
          "MY_IOTA",
          "MY_SIG",
          "MY_SIG_INFO",
          "MY_DXCC",
          "MY_CQ_ZONE",
          "MY_ITU_ZONE",
          "MY_COUNTRY",
          "MY_STATE",
          "MY_CNTY",
          "MY_CITY",
        ].includes(f),
    )
  )
    throw new WavelogError(
      "Match fields must include STATION_CALLSIGN and MY_GRIDSQUARE, without duplicates, and use supported station identity fields. Power is per QSO.",
    )
  const precision = Number(config.gridPrecision ?? 6)
  if (precision !== 4 && precision !== 6) throw new WavelogError("Grid precision must be 4 or 6.")
  const template = String(config.nameFormat ?? "")
  if ([...template.matchAll(/\{([A-Za-z_]+)\}/g)].some((m) => !fields.includes(m[1].toUpperCase())))
    throw new WavelogError("Every name-format placeholder must be included in Match fields, or clear the name format for automatic naming.")
  if (typeof operation.uuid !== "string" || !ctx.getQsos) throw new WavelogError("Open an operation with log access before previewing.")
  const rows = await ctx.getQsos(operation.uuid)
  if (rows == null) throw new WavelogError("Halo could not read this operation's log; it is not an empty log.")
  const requests = prepareExports(operation, rows)
  const groups = new Map<string, Group>()
  let count = 0
  for (const request of requests) {
    let adif: string
    try {
      adif = await exporter(request)
    } catch {
      throw new WavelogError("Halo's ADIF exporter failed. Check that the ADIF and relevant activity extensions are enabled.")
    }
    const contacts = parseAdif(adif)
    if (contacts.length !== request.qsos.length)
      throw new WavelogError("ADIF record count differs from the selected contacts. Preview stopped to avoid losing or duplicating QSOs.")
    for (const contact of contacts) {
      const refs = Array.isArray(request.operation.refs) ? request.operation.refs : []
      for (const [type, field] of [
        ["sotaActivation", "MY_SOTA_REF"],
        ["potaActivation", "MY_POTA_REF"],
      ]) {
        const expected = refs
          .map((r) => map(r))
          .filter((r) => r.type === type && typeof r.ref === "string" && r.ref)
          .map((r) => String(r.ref).trim().toUpperCase())
        const emitted = (contact[field] ?? "")
          .toUpperCase()
          .split(/[,;]/)
          .map((v) => v.trim())
        if (expected.some((ref) => !emitted.includes(ref)))
          throw new WavelogError(
            `ADIF export omitted an activation reference (${field}). Check that the relevant activity extension is enabled; preview stopped.`,
          )
      }
      const values = fields.map((field) => (contact[field] ?? "").trim().toUpperCase())
      const gridIndex = fields.indexOf("MY_GRIDSQUARE")
      values[gridIndex] = values[gridIndex].slice(0, precision)
      for (const index of fields.map((f, i) => (f.endsWith("_REF") ? i : -1)).filter((i) => i >= 0))
        values[index] = [
          ...new Set(
            values[index]
              .split(/[,;]/)
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ]
          .sort()
          .join(",")
      if (!values[fields.indexOf("STATION_CALLSIGN")] || !values[gridIndex])
        throw new WavelogError("Exported contacts lack a station callsign or grid. Check the recorded location and export data before uploading.")
      const key = JSON.stringify(values)
      const automatic = ["MY_SOTA_REF", "MY_POTA_REF", "MY_GRIDSQUARE"]
        .map((field) => values[fields.indexOf(field)] ?? "")
        .filter(Boolean)
        .join(", ")
      const group = groups.get(key) ?? {
        values,
        count: 0,
        name: template.replace(/\{([A-Za-z_]+)\}/g, (_match, field: string) => values[fields.indexOf(field.toUpperCase())] ?? "").trim() || automatic,
      }
      const metadataFields = ["MY_DXCC", "MY_CQ_ZONE", "MY_ITU_ZONE"]
      if (!group.count) group.metadata = Object.fromEntries(metadataFields.map((field) => [field, contact[field] ?? ""]))
      else for (const field of Object.keys(group.metadata ?? {})) if (group.metadata![field] !== (contact[field] ?? "")) delete group.metadata![field]
      group.count++
      count++
      groups.set(key, group)
    }
  }
  return { groups: [...groups.values()], count, fields, precision }
}
