import { createFromPreview } from "./create.ts"
import type { Services } from "./account.ts"
import type { JSONValue, PushRecordResult, TransferHook } from "@ham2k/extension-sdk"
import { MATCH_FIELDS, parseAdif } from "./preview.ts"
import { normalizeIdentity, reconcile } from "./reconcile.ts"
import { apiRequest, credentialsOf, stationOf, WavelogError } from "./wavelog.ts"
import type { Credentials, Transport } from "./wavelog.ts"

const service = "wavelog"
const outboundFields = [
  "CALL",
  "QSO_DATE",
  "TIME_ON",
  "QSO_DATE_OFF",
  "TIME_OFF",
  "BAND",
  "BAND_RX",
  "MODE",
  "SUBMODE",
  "FREQ",
  "FREQ_RX",
  "RST_SENT",
  "RST_RCVD",
  "TX_PWR",
  "PROP_MODE",
  "SAT_NAME",
  "SAT_MODE",
  "STATION_CALLSIGN",
  "MY_GRIDSQUARE",
  "MY_SOTA_REF",
  "MY_POTA_REF",
]

type TransferServices = {
  form?: Services["form"]
  fetch: Transport
  readPending: () => Promise<JSONValue | undefined>
  writePending: (value: JSONValue) => Promise<void>
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function destinationFor(fetch: Transport, credentials: Credentials) {
  const token = object(await apiRequest(fetch, credentials, "token"))
  const userId = token.user_id
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId < 1)
    throw new WavelogError("Wavelog did not identify the account. Check your API version.")
  const scopes = token.scopes
  if (!Array.isArray(scopes) || !scopes.includes("station:read") || !scopes.includes("qso:write"))
    throw new WavelogError("Native push requires station:read and qso:write.")
  // Halo lowercases destination keys. Encoding UTF-16 preserves case-sensitive
  // installation paths without using the API token or tying history to rotation.
  const server = credentials.url
    .split("")
    .map((char) => char.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("")
  return { id: `${server}-${userId}`, label: credentials.url }
}

export function createTransfer(services: TransferServices): TransferHook & {
  reviewPending: (confirm: () => Promise<boolean>) => Promise<string>
} {
  let running = false
  return {
    async reviewPending(confirm) {
      if (running) return "Wait for the Wavelog push to finish."
      running = true
      try {
        if (!(await services.readPending())) return "There is no unresolved Wavelog push."
        if (!(await confirm())) return "Wavelog push remains paused."
        await services.writePending(null)
        return "Wavelog push resumed. Review any QSO already present in Wavelog before pushing it again."
      } finally {
        running = false
      }
    },
    label: "Wavelog",
    services: [{ key: service }],
    async suggestPushes({ scope }) {
      if (scope.kind !== "operation") return []
      return [
        {
          key: "wavelog-new",
          service,
          label: "Push new QSOs to Wavelog",
          description: "Push to existing station-locations. Edit previously uploaded QSOs in Wavelog too.",
          select: { notSentTo: service },
          payload: { full: true, includePrivateData: false },
        },
      ]
    },
    async suggestDestinations({ service: requestedService, scope }, ctx) {
      if (requestedService !== service || scope.kind !== "operation") return []
      if (!ctx.account?.credentials) throw new WavelogError("Configure Wavelog in Settings → Accounts.")
      return [await destinationFor(services.fetch, credentialsOf(ctx.account.credentials))]
    },
    async push({ service: requestedService, destination, records }, ctx) {
      const fail = (error: string): PushRecordResult[] => records.map(({ uuid }) => ({ uuid, error }))
      if (running) return fail("A Wavelog push is already running.")
      running = true
      try {
        const start = Date.now()
        const credentials = credentialsOf(ctx.account?.credentials)
        const fetch: Transport = (url, options) => services.fetch(url, { ...options, timeout: 3500 })
        const current = await destinationFor(fetch, credentials)
        if (requestedService !== service || destination.id !== current.id) return fail("Wavelog destination changed. Reopen Export Logs.")
        const pending = await services.readPending()
        if (pending) return fail("A previous write is unresolved. Inspect Wavelog, then use Review paused push in the Wavelog panel menu.")
        const data = await apiRequest(fetch, credentials, "station")
        if (!Array.isArray(data)) return fail("Wavelog returned an invalid station list.")
        const stations = data.map(stationOf)
        // Check the whole chunk before writing any QSOs. Rejecting the hook
        // after review stops Halo from invoking later chunks in this push.
        const missing = records.flatMap(({ adif, id, deleted }) => {
          if (id || deleted || adif.length !== 1) return []
          try {
            const parsed = parseAdif(adif[0])
            const contact = parsed[0]
            if (parsed.length !== 1 || !contact.STATION_CALLSIGN?.trim() || !contact.MY_GRIDSQUARE?.trim()) return []
            const values = MATCH_FIELDS.map((field) => normalizeIdentity(field, contact[field] ?? "", 6))
            const name = [values[2], values[3], values[1]].filter(Boolean).join(", ")
            const metadata = Object.fromEntries(["MY_DXCC", "MY_CQ_ZONE", "MY_ITU_ZONE"].map((field) => [field, contact[field] ?? ""]))
            const group = { name, values, metadata, count: 1 }
            return reconcile([group], MATCH_FIELDS, 6, stations)[0].status === "new" ? [group] : []
          } catch {
            return []
          }
        })
        if (missing.length) {
          const groups = [...new Map(missing.map((group) => [JSON.stringify(group.values), group])).values()]
          const readPreview = async (refresh: boolean) => {
            if (refresh && Date.now() - start > 40000) throw new WavelogError("Station review timed out. Tap Push to try again.")
            return { groups, count: missing.length, fields: MATCH_FIELDS, precision: 6 }
          }
          let message: string
          try {
            message = await createFromPreview({ fetch, form: services.form }, {}, ctx, readPreview)
          } catch (error) {
            message = error instanceof WavelogError ? error.message : "Could not finish the station review."
          }
          return Promise.reject(new WavelogError(`${message} Tap Push again to continue.`))
        }
        const results: PushRecordResult[] = []
        let stopped: string | undefined
        for (const { uuid, adif, id, deleted } of records) {
          if (stopped || Date.now() - start > 40000) {
            results.push({ uuid, error: stopped ?? "Push time budget reached. Push again for remaining contacts." })
            continue
          }
          if (id || deleted) {
            results.push({ uuid, error: "Wavelog edits and deletes are not supported." })
            continue
          }
          let payload: Record<string, unknown>
          try {
            const parsed = adif.length === 1 ? parseAdif(adif[0]) : []
            const contact = parsed[0]
            if (
              parsed.length !== 1 ||
              !["CALL", "QSO_DATE", "TIME_ON", "BAND", "MODE", "STATION_CALLSIGN", "MY_GRIDSQUARE"].every((key) => contact[key]?.trim())
            )
              throw new WavelogError("Expected one complete ADIF contact with a station callsign and grid.")
            const values = MATCH_FIELDS.map((field) => normalizeIdentity(field, contact[field] ?? "", 6))
            const [match] = reconcile([{ values, name: "", count: 1 }], MATCH_FIELDS, 6, stations)
            if (match.status !== "existing")
              throw new WavelogError(
                match.status === "new"
                  ? "Create the missing station-location in the Wavelog panel, then push again."
                  : "Wavelog station-location is ambiguous or missing identity data. Review it before pushing.",
              )
            payload = { station_profile_id: match.matches[0].id, import_type: "json" }
            for (const key of outboundFields) {
              const value = MATCH_FIELDS.includes(key) ? values[MATCH_FIELDS.indexOf(key)] : contact[key]
              if (!value) continue
              if (key === "FREQ" || key === "FREQ_RX") {
                if (!/^\d+(?:\.\d+)?$/.test(value)) throw new WavelogError("ADIF frequency is invalid.")
                const hz = Math.round(Number(value) * 1e6)
                if (!Number.isSafeInteger(hz) || hz < 1) throw new WavelogError("ADIF frequency is invalid.")
                payload[key.toLowerCase()] = hz
              } else payload[key.toLowerCase()] = value
            }
          } catch (error) {
            results.push({ uuid, error: error instanceof WavelogError ? error.message : "Could not read the ADIF contact." })
            continue
          }
          try {
            await services.writePending({ destination: current.id, uuid })
            if (object(await services.readPending()).uuid !== uuid) throw new Error("Push state was not persisted.")
          } catch {
            stopped = "Could not save push state. No further contacts were sent."
            results.push({ uuid, error: stopped })
            continue
          }
          try {
            const created = object(await apiRequest(fetch, credentials, "qso", "POST", payload))
            if (typeof created.id !== "number" || !Number.isSafeInteger(created.id) || created.id < 1)
              throw new WavelogError("Wavelog did not confirm the contact ID.")
            results.push({ uuid, id: String(created.id) })
          } catch (error) {
            if (!(error instanceof WavelogError && error.status === 400 && error.duplicateCount !== undefined)) {
              stopped = "Wavelog write outcome is uncertain. Inspect Wavelog before another push."
              results.push({ uuid, error: stopped })
              continue
            }
            results.push({
              uuid,
              error: error.duplicateCount ? "Wavelog already has a matching contact. This push did not link it." : "Wavelog rejected the contact.",
            })
          }
          try {
            await services.writePending(null)
          } catch {
            stopped = "Could not clear the Wavelog push state. Inspect Wavelog before another push."
          }
        }
        return results
      } catch (error) {
        return fail(error instanceof WavelogError ? error.message : "Could not prepare the Wavelog push.")
      } finally {
        running = false
      }
    },
  }
}
