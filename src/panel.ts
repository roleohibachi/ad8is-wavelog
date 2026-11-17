import type { PanelHook } from "@ham2k/extension-sdk"

// Operation data is text, never Markdown supplied by the operator. Escape it
// so a title cannot introduce a link, remote image, or extra document structure.
function text(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim() === "") return fallback
  return value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\`*_{}\[\]()<>!#+|~&]/g, "\\$&")
}

export function createOperationPanel(version: string): PanelHook {
  return {
    async getPanels() {
      return [
        {
          key: "operation",
          title: "Wavelog",
          description: "Selected operation and QSO count. Phase 1: no uploads.",
          icon: "file-upload-outline",
          on: ["operation", "qsoLogged"],
        },
      ]
    },
    async render({ operation, qsoCount }) {
      const header = `Extension: ad8is-wavelog ${text(version, "unknown")}`
      if (typeof operation.uuid !== "string" || operation.uuid.trim() === "") {
        return {
          kind: "markdown",
          content: `${header}\n\nOpen an operation to see its details.`,
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
          "Phase 1: uploads are not enabled.",
        ]
          .filter((line) => line !== undefined)
          .join("\n\n"),
      }
    },
  }
}
