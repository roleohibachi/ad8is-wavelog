import { defineExtension, host, hooks } from "@ham2k/extension-sdk"

import manifest from "../manifest.json"
import { createOperationPanel } from "./panel.ts"
import { createAccount } from "./account.ts"
import { createTransfer } from "./transfer.ts"

const services = {
  schedule: (task: () => Promise<void>) => {
    host.setTimeout(() => {
      void task()
    }, 0)
  },
  form: (definition: import("@ham2k/extension-sdk").FormDefinition, state?: Record<string, unknown>) => host.showForm(definition, state),
  preview: async (request: import("@ham2k/extension-sdk").ExportRequest) => {
    const results = await hooks.invokeOne("export", "adif", "generateExport", request)
    const result = results.find((entry) => entry.ok)?.value as { content?: unknown } | undefined
    if (typeof result?.content !== "string" || !result.content) throw new Error("ADIF export failed")
    return result.content
  },
  fetch: (url: string, options: Parameters<typeof host.fetch>[1]) => host.fetch(url, options),
  saveSession: (session: Record<string, string>) => host.setAccountSession(session),
  showMessage: (message: Parameters<typeof host.showMessage>[0]) => host.showMessage(message),
}

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    const { reviewPending, ...transfer } = createTransfer({
      fetch: services.fetch,
      form: services.form,
      readPending: async () => {
        const settings = await host.getSettings()
        const extensions = settings.extensions as Record<string, Record<string, import("@ham2k/extension-sdk").JSONValue>> | undefined
        return extensions?.[`extension_${manifest.key}`]?.pendingPush
      },
      writePending: (pendingPush) => host.setSettings({ pendingPush }),
    })
    const panelServices = {
      ...services,
      reviewPendingPush: () =>
        reviewPending(async () => {
          const answer = await services.form(
            {
              title: "Resume Wavelog push",
              elements: [
                { type: "field", fieldType: "checkbox", key: "confirm", label: "I checked Wavelog for the unresolved contact and am ready to resume." },
              ],
            },
            { confirm: false },
          )
          return answer?.confirm === true
        }),
    }
    registerHook("panel", {
      key: manifest.key,
      hook: createOperationPanel(manifest.version, panelServices),
    })
    registerHook("account", { key: manifest.key, hook: createAccount(services) })
    registerHook("transfer", { key: manifest.key, hook: transfer })
  },
})
