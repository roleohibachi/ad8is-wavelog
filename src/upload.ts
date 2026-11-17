import type { HookContext, JSONValue } from "@ham2k/extension-sdk"
import type { Services } from "./account.ts"
import { previewOperation } from "./preview.ts"
import { reconcile } from "./reconcile.ts"
import { apiRequest, checkConnection, credentialsOf, WavelogError } from "./wavelog.ts"

export type Counts = { imported: number; duplicates: number; rejected: number; uncertain: number; unattempted: number }
export type BatchResult = Counts & { stationId: number; first: number; last: number; message: string }
export type UploadResult = Counts & { batches: BatchResult[]; cancelled: boolean }
const safe = (value: unknown) =>
  String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\\`*_{}\[\]()<>!#+|~&]/g, "\\$&")
export function encodeRecord(record: Record<string, string>): string {
  return (
    Object.entries(record)
      .map(([key, value]) => `<${key}:${Array.from(value).length}>${value}`)
      .join("") + "<EOR>\n"
  )
}
export function utf8Bytes(value: string): number {
  let bytes = 0
  for (const char of value) {
    const cp = char.codePointAt(0)!
    bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4
  }
  return bytes
}
export function chunks(records: Record<string, string>[]): string[][] {
  const result: string[][] = []
  let current: string[] = []
  for (const record of records) {
    const text = encodeRecord(record)
    if (utf8Bytes(text) > 20000) throw new WavelogError("One exported contact exceeds the upload batch limit. No upload started.")
    if (current.length && (current.length >= 20 || utf8Bytes(current.join("") + text) > 20000)) {
      result.push(current)
      current = []
    }
    current.push(text)
  }
  if (current.length) result.push(current)
  return result
}
export function classify(data: unknown, count: number): Omit<Counts, "unattempted"> {
  const row = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  const { parsed, imported, skipped, messages } = row
  if (
    parsed !== count ||
    !Number.isInteger(imported) ||
    !Number.isInteger(skipped) ||
    Number(imported) < 0 ||
    Number(skipped) < 0 ||
    Number(imported) + Number(skipped) > count ||
    !Array.isArray(messages) ||
    !messages.every((m) => typeof m === "string") ||
    (messages.length > 0 && Number(imported) + Number(skipped) === count)
  )
    return { imported: 0, duplicates: 0, rejected: 0, uncertain: count }
  const remaining = count - Number(imported) - Number(skipped)
  return { imported: Number(imported), duplicates: Number(skipped), rejected: messages.length ? remaining : 0, uncertain: messages.length ? 0 : remaining }
}
export async function uploadOperation(
  services: Services,
  operation: Record<string, JSONValue>,
  config: Record<string, JSONValue>,
  ctx: HookContext,
  progress: (text: string) => void = () => {},
): Promise<UploadResult> {
  if (!services.preview || !services.form || !ctx.getOperation) throw new WavelogError("Upload requires the local exporter, review form and operation access.")
  const credentials = credentialsOf(ctx.account?.credentials)
  progress("Preparing local preview and reading station targets…")
  const preview = await previewOperation(operation, ctx, services.preview, config)
  const connection = await checkConnection(services.fetch, ctx.account?.credentials)
  if (connection.missingUploadScopes.includes("qso:write")) throw new WavelogError("Token is missing qso:write. No contacts were uploaded.")
  const matches = reconcile(preview.groups, preview.fields, preview.precision, connection.stations)
  if (matches.some((item) => item.status !== "existing"))
    throw new WavelogError(
      "Every group needs one reviewed existing station target. Use Compare and Create missing station-location first, then run Upload again. No QSOs uploaded.",
    )
  const plan = matches.map((item) => ({ group: item.group, station: item.matches[0], chunks: chunks(item.group.records ?? []) }))
  const total: UploadResult = { imported: 0, duplicates: 0, rejected: 0, uncertain: 0, unattempted: preview.count, batches: [], cancelled: false }
  if (!preview.count) return total
  const review = await services.form(
    {
      title: "Review QSO upload",
      subtitle: "Submitting with confirmation checked imports contacts into Wavelog. Server-side duplicate detection applies; no automatic retries.",
      elements: [
        {
          type: "markdown",
          text:
            `Server: ${safe(credentials.url)}\n\n${preview.count} contacts in ${plan.length} group(s). Private/lookup export data excluded.\n\n` +
            plan.map((item) => `${safe(item.group.name)}: ${item.group.count} QSOs → station ID ${item.station.id} (${safe(item.station.name)})`).join("\n\n"),
        },
        { type: "field", fieldType: "checkbox", key: "confirm", label: "Upload these contacts to the station IDs shown" },
      ],
    },
    { confirm: false },
  )
  if (!review || review.confirm !== true) {
    total.cancelled = true
    return total
  }
  const currentOp = await ctx.getOperation(String(operation.uuid))
  if (!currentOp) throw new WavelogError("The operation is no longer readable. No contacts uploaded.")
  const current = await previewOperation(currentOp, ctx, services.preview, config)
  const snapshot = (value: typeof preview) =>
    JSON.stringify({ fields: value.fields, precision: value.precision, groups: value.groups.map((g) => ({ values: g.values, records: g.records })) })
  if (snapshot(preview) !== snapshot(current))
    throw new WavelogError("The log or exported contact data changed during review. Preview again; nothing uploaded.")
  const fresh = await checkConnection(services.fetch, ctx.account?.credentials)
  if (fresh.missingUploadScopes.includes("qso:write")) throw new WavelogError("Upload permission changed during review. No contacts uploaded.")
  const targets = reconcile(current.groups, current.fields, current.precision, fresh.stations)
  if (targets.some((item, i) => item.status !== "existing" || item.matches[0].id !== plan[i].station.id))
    throw new WavelogError("Station targets changed during review. Compare and review again; nothing uploaded.")
  let ordinal = 0,
    stop = false
  for (const item of plan) {
    for (const batch of item.chunks) {
      if (stop) break
      const first = ordinal + 1
      ordinal += batch.length
      progress(`Uploading ${first}–${ordinal} of ${preview.count} contacts to station ID ${item.station.id}…`)
      let counts: Omit<Counts, "unattempted">,
        message = ""
      try {
        const data = await apiRequest(services.fetch, credentials, "qso", "POST", {
          station_profile_id: item.station.id,
          import_type: "adif",
          adif: "<ADIF_VER:5>3.1.5<EOH>\n" + batch.join(""),
        })
        counts = classify(data, batch.length)
        if (counts.uncertain) message = "Incomplete or inconsistent API summary; inspect Wavelog before retrying."
        else if (counts.rejected) message = "Wavelog reported validation errors. The aggregate response does not identify individual rejected contacts."
      } catch (error) {
        counts = { imported: 0, duplicates: 0, rejected: 0, uncertain: batch.length }
        message = "Request failed or its result could not be verified. Some contacts may have been saved. Inspect Wavelog before retrying."
        if (error instanceof WavelogError && error.status === 400 && error.duplicateCount !== undefined && error.duplicateCount <= batch.length) {
          counts = { imported: 0, duplicates: error.duplicateCount, rejected: batch.length - error.duplicateCount, uncertain: 0 }
          message = "Wavelog rejected this batch without importing contacts; duplicate/rejected counts are aggregate only."
        }
      }
      for (const key of ["imported", "duplicates", "rejected", "uncertain"] as const) total[key] += counts[key]
      total.unattempted -= batch.length
      total.batches.push({ ...counts, unattempted: 0, stationId: item.station.id, first, last: ordinal, message })
      stop = counts.rejected > 0 || counts.uncertain > 0
    }
  }
  return total
}
export function uploadSummary(result: UploadResult): string {
  return (
    `${result.cancelled ? "Upload cancelled. " : ""}Imported: ${result.imported}; duplicates: ${result.duplicates}; rejected: ${result.rejected}; uncertain: ${result.uncertain}; not attempted: ${result.unattempted}.\n\n` +
    result.batches
      .map(
        (batch) =>
          `Station ${batch.stationId}, upload-order contacts ${batch.first}–${batch.last}: imported ${batch.imported}, duplicates ${batch.duplicates}, rejected ${batch.rejected}, uncertain ${batch.uncertain}. ${batch.message}`,
      )
      .join("\n\n") +
    "\n\nCounts are per batch, not per-contact status assignments. No automatic retry or restart/resume. Edits and deletions are not synchronized."
  )
}
