import type { AccountHook, ResultMessage } from "@ham2k/extension-sdk"
import { checkConnection, connectionSummary, WavelogError } from "./wavelog.ts"
import type { Connection, Transport } from "./wavelog.ts"

export type Services = {
  schedule?: (task: () => Promise<void>) => void
  form?: (definition: import("@ham2k/extension-sdk").FormDefinition, state?: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  preview?: import("./preview.ts").Exporter
  fetch: Transport
  saveSession: (session: Record<string, string>) => Promise<void>
  showMessage: (message: ResultMessage) => Promise<void>
}

export function createAccount(services: Services): AccountHook {
  return {
    label: "Wavelog",
    description:
      "Public HTTPS Wavelog API v2. Credentials stay in Halo's account storage. Connecting only tests access and reads stations. Creation and upload are separate reviewed actions.",
    synchronizable: false,
    fields: [
      {
        key: "url",
        label: "Wavelog HTTPS base URL",
        type: "text",
        postface: "Include any installation subpath, for example log.example.org/wavelog. HTTPS is assumed if omitted; explicit HTTP is not supported.",
      },
      {
        key: "token",
        label: "Wavelog API v2 token",
        type: "secret",
        postface: "A wl2_ token. station:read is sufficient for this read-only test; upload scopes are checked without making changes.",
      },
    ],
    async testCredentials(credentials) {
      const result = await checkConnection(services.fetch, credentials)
      await saveConnection(services, result)
      return connectionSummary(result)
    },
  }
}

export async function saveConnection(services: Services, result: Connection): Promise<void> {
  // No token or full station log is copied to settings or panel configuration.
  try {
    await services.saveSession({ server: result.url, summary: connectionSummary(result) })
  } catch {
    throw new WavelogError(
      "Wavelog responded, but Halo could not save the connection summary in account storage. Check the platform keychain/account storage and try again.",
    )
  }
}
