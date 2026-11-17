import { uploadOperation, uploadSummary } from "./upload.ts"
import { createLocation } from "./create.ts"
import { reconcile } from "./reconcile.ts"
import { previewOperation } from "./preview.ts"
import type { PanelHook } from "@ham2k/extension-sdk"
import type { Services } from "./account.ts"
import { saveConnection } from "./account.ts"
import { checkConnection, connectionSummary, WavelogError } from "./wavelog.ts"

// Operation data is text, never Markdown supplied by the operator. Escape it
// so a title cannot introduce a link, remote image, or extra document structure.
function text(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim() === "") return fallback
  return value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\`*_{}\[\]()<>!#+|~&]/g, "\\$&")
}

export function createOperationPanel(_version: string, services: Services): PanelHook {
  let testing = false
  let queued = false
  let jobStatus = ""
  let check: { key: string; status: string; busy: boolean } | undefined
  const panel: PanelHook = {
    async getPanels() {
      return [
        {
          key: "operation",
          title: "Wavelog",
          description: "Local preview, station comparison, reviewed creation and manual QSO upload.",
          icon: "file-upload-outline",
          on: ["operation", "qsoLogged", "tick:2"],
          initialConfig: { matchFields: "STATION_CALLSIGN,MY_GRIDSQUARE,MY_SOTA_REF,MY_POTA_REF", nameFormat: "", gridPrecision: 6 },
          form: [
            { type: "field", fieldType: "text", key: "matchFields", label: "Match fields" },
            { type: "field", fieldType: "number", key: "ituFallback", label: "Fallback ITU zone for new stations (optional, 1–90)" },
            { type: "field", fieldType: "text", key: "nameFormat", label: "Location name format (blank = SOTA, POTA, grid)" },
            {
              type: "field",
              fieldType: "select",
              key: "gridPrecision",
              label: "Grid precision",
              options: [
                { label: "4", value: 4 },
                { label: "6", value: 6 },
              ],
            },
          ],
        },
      ]
    },
    async render({ operation, qsoCount, config, reason }, ctx) {
      const menu = [
        { label: "Settings", settings: true as const },
        { label: "Refresh station-locations", event: "refresh" },
        { label: "Preview station-locations (local)", event: "preview" },
        { label: "Compare with Wavelog (read-only)", event: "compare" },
        { label: "Create missing station-location… (no QSOs)", event: "create" },
        { label: "Test connection (read-only)", event: "test-connection" },
      ]
      const validOperation = typeof operation.uuid === "string" && operation.uuid.trim() !== ""
      // Keys stay in memory only; never show credentials in the scene or errors.
      const key = JSON.stringify([operation, qsoCount, config, ctx.account?.credentials, ctx.online])
      if (["visible", "qsoLogged", "operation", "config"].includes(reason) && check) check = undefined
      if (validOperation && qsoCount > 0 && ctx.online && ctx.account?.credentials && services.schedule && services.preview && check?.key !== key) {
        check = { key, status: "Checking station-locations…", busy: true }
        const pendingCheck = check
        try {
          services.schedule(async () => {
            try {
              const preview = await previewOperation(operation, ctx, services.preview!, config)
              const connection = await checkConnection(services.fetch, ctx.account?.credentials)
              const items = reconcile(preview.groups, preview.fields, preview.precision, connection.stations)
              const lines = items
                .slice(0, 2)
                .flatMap((item) =>
                  item.status === "existing"
                    ? ["EXISTING station-location:", `${item.matches[0].name} (ID ${item.matches[0].id})`]
                    : item.status === "new"
                      ? ["NEW station-location to create:", item.group.name]
                      : ["Station-location needs review:", `${item.group.name} (${item.status})`],
                )
              if (items.length > 2) lines.push(`+${items.length - 2} more: use Compare in the menu`)
              if (check === pendingCheck) check = { key, status: lines.join("\n"), busy: false }
            } catch (error) {
              if (check === pendingCheck)
                check = { key, status: error instanceof WavelogError ? error.message : "Could not check station-locations.", busy: false }
            }
          })
        } catch {
          check = { key, status: "Could not start station check. Use Refresh to try again.", busy: false }
        }
      }
      const status = !validOperation
        ? "Open an operation."
        : !qsoCount
          ? "No contacts to upload yet."
          : !ctx.online
            ? "Offline. Connect to check station-locations."
            : !ctx.account?.credentials
              ? "Configure your Wavelog account in Settings → Accounts."
              : check?.key === key
                ? check.status
                : "Station-locations have not been checked."
      const busy = queued || testing || (check?.key === key && check.busy)
      return {
        kind: "scene",
        scene: {
          version: 1,
          width: 360,
          height: 280,
          values: {},
          layers: [],
          controls: [
            ...status
              .split("\n")
              .slice(0, 20)
              .map((line, i) => ({ id: `status${i}`, kind: "nativeText" as const, label: line, style: "title" as const })),
            {
              id: "upload",
              kind: "nativeButton",
              label: "Upload new QSOs",
              event: "upload",
              disabled: !validOperation || !qsoCount || !ctx.online || !ctx.account?.credentials || !!busy,
            },
            { id: "warning", kind: "nativeText", label: "⚠️ QSO EDITS ARE NOT SYNCED", style: "title" },
            { id: "warning2", kind: "nativeText", label: "Edit uploaded QSOs in Wavelog too.", style: "body" },
            { id: "warning3", kind: "nativeText", label: "Changes can create duplicates.", style: "body" },
            ...(jobStatus ? [{ id: "job", kind: "nativeText" as const, label: jobStatus, style: "body" as const }] : []),
          ],
          layout: {
            column: [
              ...status
                .split("\n")
                .slice(0, 20)
                .map((_, i) => ({ control: `status${i}` })),
              { control: "upload", height: 56 },
              { control: "warning" },
              { control: "warning2" },
              { control: "warning3" },
              ...(jobStatus ? [{ control: "job" }] : []),
            ],
            padding: 12,
            spacing: 12,
            crossAxisAlignment: "stretch",
          },
        },
        menu,
      }
    },
    async onEvent({ event, operation, config }, ctx) {
      if (["menu", "upload"].includes(event.controlId) && event.action === "upload" && !testing) {
        testing = true
        const label = String(operation.title ?? operation.uuid ?? "operation")
        let completed = false
        try {
          // Recheck immediately before initiating any creation; stale display state
          // is never used as authorization to write.
          if (!services.preview) throw new WavelogError("Local exporter is unavailable.")
          let previousMissing = Number.POSITIVE_INFINITY
          for (;;) {
            const currentOp = await ctx.getOperation?.(String(operation.uuid))
            if (!currentOp) throw new WavelogError("Could not read this operation. No contacts uploaded.")
            const preview = await previewOperation(currentOp, ctx, services.preview, config)
            const connection = await checkConnection(services.fetch, ctx.account?.credentials)
            if (connection.missingUploadScopes.includes("qso:write")) throw new WavelogError("Token is missing qso:write. No station or contact was created.")
            const matches = reconcile(preview.groups, preview.fields, preview.precision, connection.stations)
            if (matches.some((item) => item.status === "ambiguous" || item.status === "blocked"))
              throw new WavelogError("Station-location matching needs review. No contacts uploaded.")
            const missing = matches.filter((item) => item.status === "new").length
            if (!missing) break
            if (missing >= previousMissing)
              throw new WavelogError(
                "The created station is not visible in the current station list. Inspect Wavelog before trying again. No contacts uploaded.",
              )
            previousMissing = missing
            const message = await createLocation(services, currentOp, config, ctx)
            check = undefined
            if (!message.startsWith("Created station ID") && !message.includes("will be reused")) {
              jobStatus = "Station creation cancelled. No contacts uploaded."
              await services.showMessage({ presentation: "dialog", title: "Station-location", text: message })
              return { values: {} }
            }
          }
          const result = await uploadOperation(services, operation, config, ctx, (progress) => {
            jobStatus = `Upload for ${label}: ${progress}`
          })
          jobStatus = `Upload for ${label}: ${result.cancelled ? "cancelled; " : ""}imported ${result.imported}, duplicates ${result.duplicates}, rejected ${result.rejected}, uncertain ${result.uncertain}, not attempted ${result.unattempted}.`
          completed = true
          await services.showMessage({ presentation: "dialog", title: "Wavelog upload results", text: uploadSummary(result) })
        } catch (error) {
          if (completed) {
            jobStatus += " Result dialog unavailable; counts remain above."
            return { values: {} }
          }
          jobStatus = `Upload for ${label}: stopped or result display interrupted. Inspect Wavelog before retrying.`
          await services.showMessage({
            presentation: "dialog",
            title: "Upload stopped",
            text: error instanceof WavelogError ? error.message : "Could not prepare the upload. Inspect Wavelog before another attempt.",
          })
        } finally {
          testing = false
        }
        return { values: {} }
      }
      if (event.controlId === "menu" && event.action === "create" && !testing) {
        testing = true
        try {
          const message = await createLocation(services, operation, config, ctx)
          check = undefined
          await services.showMessage({ presentation: "dialog", title: "Station-location creation", text: message })
        } catch (error) {
          await services.showMessage({
            presentation: "dialog",
            title: "Station creation stopped",
            text:
              error instanceof WavelogError
                ? error.message
                : "Could not complete station creation. Inspect Wavelog Station Setup and logbook links before trying again. No QSOs imported.",
          })
        } finally {
          testing = false
        }
        return { values: {} }
      }
      if (event.controlId === "menu" && ["preview", "compare"].includes(event.action) && !testing) {
        testing = true
        try {
          if (!services.preview) throw new Error("Exporter unavailable")
          const result = await previewOperation(operation, ctx, services.preview, config)
          if (event.action === "compare") {
            const connection = await checkConnection(services.fetch, ctx.account?.credentials)
            const comparison = reconcile(result.groups, result.fields, result.precision, connection.stations)
            await services.showMessage({
              presentation: "dialog",
              title: "Wavelog station comparison (read-only)",
              text:
                `${result.count} QSOs; ${result.groups.length} combinations. No stations or QSOs changed. Not a QSO duplicate check.\n\n` +
                comparison
                  .slice(0, 50)
                  .map(
                    (item) =>
                      `${text(item.group.name, "Unnamed")} | ${item.group.count} QSOs\n${item.status === "existing" ? "Reuse existing station" : item.status === "new" ? "No match in readable stations: propose new" : item.status === "ambiguous" ? "Ambiguous: several stations match" : "Blocked: identity fields missing/unsupported"}${[...item.matches, ...item.uncertain].map((station) => `\nID ${station.id}: ${text(station.name, "Unnamed")}`).join("")}`,
                  )
                  .join("\n\n") +
                (comparison.length > 50 ? "\n\nShowing first 50 groups." : ""),
            })
            return { values: {} }
          }
          await services.showMessage({
            presentation: "dialog",
            title: "Local station-location preview",
            text:
              `${result.count} QSOs; ${result.groups.length} station-location combination(s). No Wavelog requests. Grid precision: ${result.precision}. Private/lookup data excluded.\n\n` +
              result.groups
                .slice(0, 50)
                .map(
                  (g) =>
                    `${text(g.name, "Unnamed")} | ${g.count} QSOs\n${result.fields.map((field, i) => `${field}: ${text(g.values[i], "none")}`).join(" | ")}`,
                )
                .join("\n\n") +
              (result.groups.length > 50 ? "\n\nShowing first 50 groups." : ""),
          })
        } catch (error) {
          await services.showMessage({
            presentation: "dialog",
            title: "Preview failed",
            text: error instanceof Error && error.name === "WavelogError" ? error.message : "Could not preview the local log.",
          })
        } finally {
          testing = false
        }
        return { values: {} }
      }
      if (event.controlId !== "menu" || event.action !== "test-connection" || testing) return { values: {} }
      testing = true
      try {
        const result = await checkConnection(services.fetch, ctx.account?.credentials)
        await saveConnection(services, result)
        const samples = result.stations
          .slice(0, 10)
          .map(
            (station) =>
              `ID ${station.id}: ${text(station.name, "Unnamed")} | ${text(station.callsign, "No call")} | ${text(station.grid, "No grid")} | SOTA ${text(station.sota, "none")} | POTA ${text(station.pota, "none")}`,
          )
        await services.showMessage({
          presentation: "dialog",
          title: "Wavelog connection",
          text: [text(connectionSummary(result), "Connected"), ...samples, result.stations.length > 10 ? "Showing the first 10 station-locations." : ""]
            .filter(Boolean)
            .join("\n\n"),
        })
      } catch (error) {
        // Client errors are deliberately generic and never quote server bodies.
        // Errors from platform storage/dialog APIs are not displayed verbatim.
        const message =
          error instanceof Error && error.name === "WavelogError"
            ? error.message
            : "Could not complete the connection test. Check account configuration, connectivity and Halo's account storage."
        await services.showMessage({ presentation: "dialog", title: "Wavelog connection failed", text: message })
      } finally {
        testing = false
      }
      return { values: {} }
    },
  }
  // Native panel RPCs time out after five seconds, while forms and a batch
  // import may legitimately take longer. A user action queues ONE tracked task;
  // rendering and log-change triggers never queue work. No timers resume it.
  const execute = panel.onEvent!.bind(panel)
  panel.onEvent = async (args, ctx) => {
    if (args.event.controlId === "menu" && args.event.action === "refresh") {
      check = undefined
      return { values: {} }
    }
    if (!["menu", "upload"].includes(args.event.controlId) || !["preview", "compare", "test-connection", "create", "upload"].includes(args.event.action))
      return { values: {} }
    if (queued || testing) return { values: {} }
    if (!services.schedule) return execute(args, ctx)
    queued = true
    const label = String(args.operation.title ?? args.operation.uuid ?? "operation")
    jobStatus = `${args.event.action} for ${label}: running…`
    try {
      services.schedule(async () => {
        try {
          await execute(args, ctx)
          if (args.event.action !== "upload") jobStatus = `${args.event.action} for ${label}: finished.`
        } catch {
          jobStatus = `${args.event.action} for ${label}: interrupted. Inspect Wavelog before retrying any write.`
        } finally {
          queued = false
        }
      })
    } catch {
      queued = false
      jobStatus = `${args.event.action} for ${label}: could not start the task. No action was started; try again.`
    }
    return { values: {} }
  }
  return panel
}
