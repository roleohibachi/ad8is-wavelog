import { defineExtension } from "@ham2k/extension-sdk"

import manifest from "../manifest.json"
import { createOperationPanel } from "./panel.ts"

defineExtension({
  ...manifest,
  onActivation({ registerHook }) {
    registerHook("panel", {
      key: manifest.key,
      hook: createOperationPanel(manifest.version),
    })
  },
})
