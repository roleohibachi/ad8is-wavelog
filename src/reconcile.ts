import type { Group } from "./preview.ts"
import type { Station } from "./wavelog.ts"
export const STATION_FIELDS: Record<string, string> = {
  STATION_CALLSIGN: "callsign",
  MY_GRIDSQUARE: "gridsquare",
  MY_SOTA_REF: "sota",
  MY_POTA_REF: "pota",
  MY_WWFF_REF: "wwff",
  MY_IOTA: "iota",
  MY_SIG: "sig",
  MY_SIG_INFO: "sig_info",
  MY_DXCC: "dxcc",
  MY_CQ_ZONE: "cq",
  MY_ITU_ZONE: "itu",
  MY_COUNTRY: "country",
  MY_STATE: "state",
  MY_CNTY: "cnty",
  MY_CITY: "city",
}
export function normalizeIdentity(field: string, value: string | null, precision: number): string {
  const normalized = (value ?? "").trim().toUpperCase()
  if (field === "MY_GRIDSQUARE") return normalized.slice(0, precision)
  if (field.endsWith("_REF"))
    return [
      ...new Set(
        normalized
          .split(/[,;]/)
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ]
      .sort()
      .join(",")
  return normalized
}
export function reconcile(groups: Group[], fields: string[], precision: number, stations: Station[]) {
  return groups.map((group) => {
    const matches: Station[] = []
    const uncertain: Station[] = []
    for (const station of stations) {
      let mismatch = false,
        unknown = false
      fields.forEach((field, i) => {
        const key = STATION_FIELDS[field]
        if (!key || !station.identity || !Object.prototype.hasOwnProperty.call(station.identity, key)) {
          unknown = true
          return
        }
        if (normalizeIdentity(field, station.identity[key], precision) !== normalizeIdentity(field, group.values[i], precision)) mismatch = true
      })
      if (!mismatch) (unknown ? uncertain : matches).push(station)
    }
    const unsupported = fields.some((field) => !STATION_FIELDS[field])
    const status = unsupported || uncertain.length ? "blocked" : matches.length > 1 ? "ambiguous" : matches.length === 1 ? "existing" : "new"
    return { group, status, matches, uncertain }
  })
}
