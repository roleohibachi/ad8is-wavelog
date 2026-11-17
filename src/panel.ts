import { uploadOperation, uploadSummary } from "./upload.ts"
import { createLocation } from "./create.ts"
import { reconcile } from "./reconcile.ts"
import { previewOperation } from "./preview.ts"
import type { PanelHook } from "@ham2k/extension-sdk"
import type { Services } from "./account.ts"
import { saveConnection } from "./account.ts"
import { checkConnection, connectionSummary, credentialsOf, WavelogError } from "./wavelog.ts"

// Operation data is text, never Markdown supplied by the operator. Escape it
// so a title cannot introduce a link, remote image, or extra document structure.
function text(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim() === "") return fallback
  return value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\`*_{}\[\]()<>!#+|~&]/g, "\\$&")
}

export function createOperationPanel(version: string, services: Services): PanelHook {
  let testing = false
  let queued = false
  let jobStatus = ""
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
    async render({ operation, qsoCount }, ctx) {
      const header = `Extension: ad8is-wavelog ${text(version, "unknown")}`
      const account = ctx.account
      let status = "Configure Wavelog under Settings → Accounts, then use this panel's menu → Test connection."
      if (account?.credentials) {
        try {
          const credentials = credentialsOf(account.credentials)
          status =
            account.session?.server === credentials.url && account.session?.summary
              ? `Last successful test: ${account.session.summary} Test again to verify current access.`
              : "Account configured. Use the panel menu → Test connection to verify current access."
        } catch {
          status = "Wavelog account needs configuration: enter a public HTTPS URL and API v2 token in Settings → Accounts."
        }
      }
      const menu = [
        { label: "Preview settings", settings: true as const },
        { label: "Preview station-locations (local)", event: "preview" },
        { label: "Compare with Wavelog (read-only)", event: "compare" },
        { label: "Create missing station-location… (no QSOs)", event: "create" },
        { label: "Upload QSOs…", event: "upload" },
        { label: "Test connection (read-only)", event: "test-connection" },
      ]
      if (typeof operation.uuid !== "string" || operation.uuid.trim() === "") {
        return {
          kind: "markdown",
          content: `${header}\n\nOpen an operation to see its details.\n\n${text(status, "Not connected")}`,
          menu,
        }
      }

      return {
        kind: "markdown",
        content: [
          header,
          `Operation: ${text(operation.title, "Unnamed operation")}`,
          `Operation ID: ${text(operation.uuid, "unavailable")}`,
          `Station callsign: ${text(operation.stationCall, "Not set")}`,
          `QSOs: ${qsoCount}`,
          qsoCount === 0 ? "No contacts logged yet." : undefined,
          text(status, "Not connected"),
          jobStatus ? text(jobStatus, "") : "Phase 6: reviewed QSO upload. No automatic uploads.",
        ]
          .filter((line) => line !== undefined)
          .join("\n\n"),
        menu,
      }
    },
    async onEvent({ event, operation, config }, ctx) {
      if (event.controlId === "menu" && event.action === "upload" && !testing) {
        testing = true
        const label = String(operation.title ?? operation.uuid ?? "operation")
        try {
          const result = await uploadOperation(services, operation, config, ctx, (progress) => {
            jobStatus = `Upload for ${label}: ${progress}`
          })
          jobStatus = `Upload for ${label}: imported ${result.imported}, duplicates ${result.duplicates}, rejected ${result.rejected}, uncertain ${result.uncertain}, not attempted ${result.unattempted}.`
          await services.showMessage({ presentation: "dialog", title: "Wavelog upload results", text: uploadSummary(result) })
        } catch (error) {
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
    if (args.event.controlId !== "menu" || !["preview", "compare", "test-connection", "create", "upload"].includes(args.event.action)) return { values: {} }
    if (queued || testing) return { values: {} }
    if (!services.schedule) return execute(args, ctx)
    queued = true
    const label = String(args.operation.title ?? args.operation.uuid ?? "operation")
    jobStatus = `${args.event.action} for ${label}: running…`
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
    return { values: {} }
  }
  return panel
}
