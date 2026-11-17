import { defineExtension, host, hooks } from "@ham2k/extension-sdk"

import manifest from "../manifest.json"
import { createOperationPanel } from "./panel.ts"
import { createAccount } from "./account.ts"

const services = {
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
    registerHook("panel", {
      key: manifest.key,
      hook: createOperationPanel(manifest.version, services),
    })
    registerHook("account", { key: manifest.key, hook: createAccount(services) })
  },
})
