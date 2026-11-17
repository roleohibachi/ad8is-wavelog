import { defineExtension, host } from "@ham2k/extension-sdk"

import manifest from "../manifest.json"
import { createOperationPanel } from "./panel.ts"
import { createAccount } from "./account.ts"

const services = {
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
