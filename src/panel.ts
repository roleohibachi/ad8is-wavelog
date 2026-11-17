import { previewOperation } from "./preview.ts"
import type { PanelHook } from "@ham2k/extension-sdk"
import type { Services } from "./account.ts"
import { saveConnection } from "./account.ts"
import { checkConnection, connectionSummary, credentialsOf } from "./wavelog.ts"

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
  return {
    async getPanels() {
      return [
        {
          key: "operation",
          title: "Wavelog",
          description: "Operation details and read-only Wavelog connection test. No uploads yet.",
          icon: "file-upload-outline",
          on: ["operation", "qsoLogged"],
          initialConfig: { matchFields: "STATION_CALLSIGN,MY_GRIDSQUARE,MY_SOTA_REF,MY_POTA_REF", nameFormat: "{MY_SOTA_REF}", gridPrecision: 6 },
          form: [
            { type: "field", fieldType: "text", key: "matchFields", label: "Match fields" },
            { type: "field", fieldType: "text", key: "nameFormat", label: "Location name format (blank = automatic)" },
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
          "Phase 3: local station-location preview. Uploads are not enabled.",
        ]
          .filter((line) => line !== undefined)
          .join("\n\n"),
        menu,
      }
    },
    async onEvent({ event, operation, config }, ctx) {
      if (event.controlId === "menu" && event.action === "preview" && !testing) {
        testing = true
        try {
          if (!services.preview) throw new Error("Exporter unavailable")
          const result = await previewOperation(operation, ctx, services.preview, config)
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
}
