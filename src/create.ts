import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import type { Services } from "./account.ts"
import { apiRequest, checkConnection, credentialsOf, WavelogError, stationOf } from "./wavelog.ts"
import { previewOperation } from "./preview.ts"
import { reconcile, STATION_FIELDS, normalizeIdentity } from "./reconcile.ts"

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
function integer(value: unknown, min: number, max: number, field: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) throw new WavelogError(`${field} must be an integer from ${min} to ${max}.`)
  return number
}
// Untrusted text is displayed as plain escaped Markdown, never markup/links.
const safe = (value: unknown) =>
  String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\\`*_{}\[\]()<>!#+|~&]/g, "\\$&")
export async function createLocation(
  services: Services,
  operation: Record<string, JSONValue>,
  config: Record<string, JSONValue>,
  ctx: HookContext,
): Promise<string> {
  if (!services.preview || !services.form) throw new WavelogError("The creation form/exporter is unavailable.")
  const credentials = credentialsOf(ctx.account?.credentials)
  const preview = await previewOperation(operation, ctx, services.preview, config)
  const connection = await checkConnection(services.fetch, ctx.account?.credentials)
  for (const scope of ["station:write", "logbook:read", "logbook:write"])
    if (connection.missingUploadScopes.includes(scope)) throw new WavelogError(`Creating and linking a station requires ${scope}. No station was created.`)
  const compared = reconcile(preview.groups, preview.fields, preview.precision, connection.stations)
  const candidates = compared.filter((item) => item.status === "new")
  if (!candidates.length)
    return "No safely identifiable new station-locations to create. Existing locations are reused; resolve any ambiguous or blocked results in Compare first. No QSOs were imported."
  const choice = await services.form(
    {
      title: "Choose a new station-location",
      subtitle: "No changes yet. Creation imports no QSOs.",
      elements: [
        { type: "field", fieldType: "select", key: "group", label: "Location", options: candidates.map((item, i) => ({ label: item.group.name, value: i })) },
        { type: "field", fieldType: "checkbox", key: "lookup", label: "Look up missing DXCC/CQ from the station callsign (read-only)" },
      ],
    },
    { group: 0, lookup: true },
  )
  if (!choice) return "Creation cancelled. No changes made."
  const index = integer(choice.group, 0, candidates.length - 1, "Location choice")
  const group = candidates[index].group
  const payload: Record<string, unknown> = {}
  preview.fields.forEach((field, i) => {
    const key = STATION_FIELDS[field]
    if (!key) throw new WavelogError("Unsupported station identity field.")
    payload[key] = group.values[i]
  })
  const metadata = { ...group.metadata }
  const notes: string[] = []
  if (choice.lookup === true && (!metadata.MY_DXCC || !metadata.MY_CQ_ZONE)) {
    if (connection.missingUploadScopes.includes("lookup:read")) notes.push("Lookup is unavailable: token lacks lookup:read. Enter metadata manually.")
    else {
      try {
        const data = object(await apiRequest(services.fetch, credentials, `lookup?callsign=${encodeURIComponent(String(payload.callsign))}&detail=basic`))
        if (!metadata.MY_DXCC && Number.isInteger(Number(data.dxcc_id)) && Number(data.dxcc_id) > 0 && Number(data.dxcc_id) <= 999)
          metadata.MY_DXCC = String(data.dxcc_id)
        if (!metadata.MY_CQ_ZONE && Number.isInteger(Number(data.dxcc_cqz)) && Number(data.dxcc_cqz) > 0 && Number(data.dxcc_cqz) <= 40)
          metadata.MY_CQ_ZONE = String(data.dxcc_cqz)
        if (!metadata.MY_DXCC || !metadata.MY_CQ_ZONE) notes.push("Lookup did not resolve all required values; enter them manually.")
      } catch {
        notes.push("Callsign lookup failed. Enter the metadata manually; no station was created.")
      }
    }
  }
  const books = await apiRequest(services.fetch, credentials, "logbook")
  if (!Array.isArray(books)) throw new WavelogError("Could not read logbooks. No station was created.")
  const active = books.map(object).filter((book) => book.active === true)
  if (active.length !== 1)
    throw new WavelogError("Creation requires exactly one existing active logbook. Select one in Wavelog first; no logbook is created automatically.")
  const bookId = integer(active[0].id, 1, Number.MAX_SAFE_INTEGER, "Logbook ID")
  const review = await services.form(
    {
      title: "Review station-location creation",
      subtitle: "Submit with confirmation checked to create this station and link it to the active logbook. No QSOs will be imported.",
      elements: [
        {
          type: "markdown",
          text: [
            `Call: ${safe(payload.callsign)} | Grid: ${safe(payload.gridsquare)}`,
            `SOTA: ${safe(payload.sota)} | POTA: ${safe(payload.pota)}`,
            `Server: ${safe(credentials.url)}`,
            `Active logbook: ${safe(active[0].name)} (ID ${bookId})`,
            ...notes,
          ].join("\n\n"),
        },
        { type: "field", fieldType: "text", key: "name", label: "Station name" },
        { type: "field", fieldType: "number", key: "dxcc", label: "DXCC entity number" },
        { type: "field", fieldType: "number", key: "cq", label: "CQ zone (1–40)" },
        { type: "field", fieldType: "number", key: "itu", label: "ITU zone (1–90)" },
        { type: "field", fieldType: "checkbox", key: "confirm", label: "Create this station-location and link it to the logbook shown" },
      ],
    },
    { name: group.name, dxcc: metadata.MY_DXCC ?? "", cq: metadata.MY_CQ_ZONE ?? "", itu: metadata.MY_ITU_ZONE || config.ituFallback || "", confirm: false },
  )
  if (!review || review.confirm !== true) return "Creation cancelled. No changes made."
  payload.name = String(review.name ?? "").trim()
  if (!payload.name || String(payload.name).length > 255) throw new WavelogError("Station name must contain 1–255 characters.")
  payload.dxcc = integer(review.dxcc, 1, 999, "DXCC entity")
  payload.cq = integer(review.cq, 1, 40, "CQ zone")
  payload.itu = integer(review.itu, 1, 90, "ITU zone")
  for (const [field, key] of Object.entries(STATION_FIELDS)) {
    const index = preview.fields.indexOf(field)
    if (
      index >= 0 &&
      normalizeIdentity(field, String(payload[key] ?? ""), preview.precision) !== normalizeIdentity(field, group.values[index], preview.precision)
    )
      throw new WavelogError("Reviewed metadata changes a selected identity field. Correct the source operation or matching settings and preview again.")
  }
  // Re-read both the local snapshot and server list after the user closes forms.
  const currentOperation = ctx.getOperation ? await ctx.getOperation(String(operation.uuid)) : null
  if (!currentOperation) throw new WavelogError("Could not re-read the current operation after review. No station was created.")
  const refreshed = await previewOperation(currentOperation, ctx, services.preview, config)
  const target = refreshed.groups.find((item) => JSON.stringify(item.values) === JSON.stringify(group.values))
  if (!target || target.count !== group.count || target.name !== group.name || JSON.stringify(target.metadata) !== JSON.stringify(group.metadata))
    throw new WavelogError("The local preview changed during review. Run the action again before creating anything.")
  const current = await checkConnection(services.fetch, ctx.account?.credentials)
  const decision = reconcile([group], preview.fields, preview.precision, current.stations)[0]
  if (decision.status === "existing") return `Station ID ${decision.matches[0].id} now exists and will be reused. Nothing was created; no QSOs imported.`
  if (decision.status !== "new") throw new WavelogError("Station matching became ambiguous or blocked during review. No station was created.")
  const verifiedBook = object(await apiRequest(services.fetch, credentials, `logbook/${bookId}`))
  if (verifiedBook.active !== true) throw new WavelogError("The active logbook changed during review. No station was created.")
  payload.clublog_upload = "disabled"
  payload.eqsl_qth_nickname = ""
  payload.pskreporter_live = false
  let id: number | undefined
  try {
    const created = object(await apiRequest(services.fetch, credentials, "station", "POST", payload))
    id = integer(created.id, 1, Number.MAX_SAFE_INTEGER, "Created station ID")
    if (reconcile([group], preview.fields, preview.precision, [stationOf(created)])[0].status !== "existing")
      throw new WavelogError("Created station identity differs from the reviewed identity; review it in Wavelog before proceeding.")
    // PATCH replaces station_ids: fetch immediately before append, never reuse an old list.
    const book = object(await apiRequest(services.fetch, credentials, `logbook/${bookId}`))
    if (book.active !== true || !Array.isArray(book.station_ids) || !book.station_ids.every((value) => Number.isSafeInteger(value) && Number(value) > 0))
      throw new WavelogError("The active logbook or its station list changed unexpectedly.")
    if (!book.station_ids.includes(id)) {
      const ids = [...book.station_ids, id]
      const linked = object(await apiRequest(services.fetch, credentials, `logbook/${bookId}`, "PATCH", { station_ids: ids }))
      if (!Array.isArray(linked.station_ids) || !ids.every((value) => (linked.station_ids as unknown[]).includes(value)))
        throw new WavelogError("The server did not confirm all intended logbook links.")
    }
    return `Created station ID ${id} and linked it to logbook ID ${bookId}. No QSOs imported. Review the station in Wavelog Station Setup.`
  } catch (error) {
    if (!id && error instanceof WavelogError && error.status === 409) {
      const refreshed = await checkConnection(services.fetch, ctx.account?.credentials)
      const resolved = reconcile([group], preview.fields, preview.precision, refreshed.stations)[0]
      if (resolved.status === "existing")
        return `Station ID ${resolved.matches[0].id} was found after a creation conflict and will be reused. No request was retried; no QSOs imported.`
    }
    const detail = error instanceof WavelogError ? error.message : "The server result could not be verified."
    throw new WavelogError(
      `${id ? `Station ID ${id} was created, but logbook linking is incomplete or uncertain.` : "Station creation failed or its outcome is uncertain."} ${detail} No write was retried. Inspect Wavelog Station Setup and logbook links before another attempt. No QSOs were imported.`,
    )
  }
}
