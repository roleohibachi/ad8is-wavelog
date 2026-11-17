import { STATION_FIELDS } from "./reconcile.ts"
import type { FetchOptions } from "@ham2k/extension-sdk"

export class WavelogError extends Error {
  declare readonly duplicateCount?: number
  declare readonly status?: number
  constructor(message: string, status?: number, duplicateCount?: number) {
    super(message)
    Object.defineProperty(this, "name", { value: "WavelogError" })
    Object.defineProperty(this, "status", { value: status })
    Object.defineProperty(this, "duplicateCount", { value: duplicateCount })
  }
}

export type Transport = (url: string, options: FetchOptions) => Promise<{ status: number; body: string }>
export type Credentials = { url: string; token: string }
export type Station = { identity?: Record<string, string | null>; id: number; name: string; callsign: string; grid: string; sota: string; pota: string }
export type Connection = { url: string; stations: Station[]; missingUploadScopes: string[] }

const UPLOAD_SCOPES = ["station:read", "station:write", "qso:write", "logbook:read", "logbook:write", "lookup:read"]

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// QuickJS has no browser URL API. Accept an unambiguous HTTPS DNS host and
// optional port/base path; Halo independently checks the host and DNS result.
export function normalizeServer(input: string): string {
  const trimmed = input.trim()
  const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const match = /^https:\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value)
  if (!match || /[\s\\\u0000-\u001f\u007f]/.test(value)) {
    throw new WavelogError("Enter a public HTTPS Wavelog base URL, without a query or fragment.")
  }
  const authority = /^([a-z0-9.-]+)(?::([0-9]+))?$/i.exec(match[1])
  if (!authority) throw new WavelogError("Use a public HTTPS hostname without embedded credentials or an IP literal.")
  const host = authority[1].toLowerCase().replace(/\.$/, "")
  const labels = host.split(".")
  if (host.length > 253 || labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new WavelogError("Enter a valid public HTTPS hostname.")
  }
  if (/^[0-9.]+$/.test(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new WavelogError("Use a public HTTPS hostname. LAN, Tailscale and IP-literal servers are not supported in this milestone.")
  }
  const port = authority[2] === undefined ? undefined : Number(authority[2])
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new WavelogError("The HTTPS port must be between 1 and 65535.")
  return `https://${host}${port === undefined || port === 443 ? "" : `:${port}`}${(match[2] ?? "").replace(/\/+$/, "")}`
}

export function credentialsOf(input: Record<string, string> | undefined): Credentials {
  const url = normalizeServer(input?.url ?? "")
  const token = (input?.token ?? "").trim()
  if (!/^wl2_[A-Za-z0-9_-]+$/.test(token)) throw new WavelogError("Enter a Wavelog API v2 token beginning wl2_. Legacy keys are planned for a later milestone.")
  return { url, token }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export async function apiRequest(
  fetch: Transport,
  credentials: Credentials,
  resource: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  payload?: Record<string, unknown>,
): Promise<unknown> {
  if (!/^(token|station(?:\/[1-9]\d*)?|logbook(?:\/[1-9]\d*)?|qso|lookup\?callsign=[^&]+&detail=basic)$/.test(resource))
    throw new WavelogError("Unsupported API resource.")
  let response: { status: number; body: string }
  try {
    response = await fetch(`${credentials.url}/api/v2/${resource}`, {
      method,
      headers: { Authorization: `Bearer ${credentials.token}`, Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      timeout: resource === "qso" ? 15000 : 8000,
    })
  } catch {
    // Transport exceptions can contain request headers or a proxy response.
    if (method !== "GET")
      throw new WavelogError(
        "Write outcome is uncertain after a connection failure or timeout. The request was not retried. Inspect Wavelog Station Setup and logbook links before trying again.",
      )
    throw new WavelogError("Connection failed or timed out. Check public HTTPS access, certificate trust, connectivity, and Halo's network permissions.")
  }
  if (/^\s*</.test(response.body))
    throw new WavelogError(
      "The server returned an HTML/login page instead of Wavelog API JSON. Check the base URL and any SSO or Cloudflare login/challenge protecting the API.",
    )
  if (response.status === 401)
    throw new WavelogError("Wavelog rejected the API v2 token (HTTP 401). Check that it is valid and has not expired or been revoked.")
  if (response.status === 403)
    throw new WavelogError("API access was denied (HTTP 403). Check token scopes, station ownership and any reverse-proxy access rules.")
  if (response.status === 404) throw new WavelogError("Wavelog API v2 was not found (HTTP 404). Check the base path and that this server supports API v2.")
  if (resource === "qso" && response.status === 400) {
    let failure: unknown
    try {
      failure = JSON.parse(response.body)
    } catch {
      /* Not a structured API rejection. */
    }
    if (record(failure) && record(failure.error) && failure.error.code === "validation_error" && record(failure.error.details)) {
      const details = failure.error.details
      if (
        Array.isArray(details.duplicate) &&
        Array.isArray(details.critical) &&
        Array.isArray(details.validation) &&
        details.critical.length + details.validation.length > 0
      ) {
        throw new WavelogError("Wavelog rejected the batch without importing contacts. Raw validation messages are withheld.", 400, details.duplicate.length)
      }
    }
  }
  if (response.status < 200 || response.status >= 300)
    throw new WavelogError(
      `Wavelog API request failed (HTTP ${response.status}).${method === "GET" ? " This read request made no changes." : " The write was not retried; inspect Wavelog before trying again."}`,
      response.status,
    )
  let envelope: unknown
  try {
    envelope = JSON.parse(response.body)
  } catch {
    throw new WavelogError("The server returned invalid API JSON. Check the Wavelog URL, API version and proxy configuration.")
  }
  if (!record(envelope) || envelope.error != null || envelope.data == null) {
    throw new WavelogError("The server returned an unsuccessful or unsupported API v2 response. Check server compatibility and token permissions.")
  }
  return envelope.data
}

export async function checkConnection(fetch: Transport, input: Record<string, string> | undefined): Promise<Connection> {
  const credentials = credentialsOf(input)
  const token = await apiRequest(fetch, credentials, "token")
  if (
    !record(token) ||
    !Number.isInteger(token.id) ||
    Number(token.id) <= 0 ||
    !Array.isArray(token.scopes) ||
    !token.scopes.every((scope) => typeof scope === "string")
  ) {
    throw new WavelogError("Wavelog returned invalid API v2 token metadata.")
  }
  const scopes: string[] = token.scopes
  if (!scopes.includes("station:read"))
    throw new WavelogError("Token is missing station:read, required to read station-locations. No station or QSO was changed.")
  const data = await apiRequest(fetch, credentials, "station")
  if (!Array.isArray(data)) throw new WavelogError("Wavelog returned an invalid station list; this is not an empty list.")
  const stations = data.map(stationOf)
  return { url: credentials.url, stations, missingUploadScopes: UPLOAD_SCOPES.filter((scope) => !scopes.includes(scope)) }
}

export function connectionSummary(result: Connection): string {
  const missing = result.missingUploadScopes
  return `Connected to Wavelog API v2. ${result.stations.length} station-location(s) readable.${missing.length ? ` Missing scopes for the complete create-and-upload workflow with lookup enabled: ${missing.join(", ")}.` : " Token has the scopes needed for future uploads with lookup enabled."} This connection test is read-only; upload is a separate reviewed action.`
}

export function stationOf(row: unknown): Station {
  if (!record(row) || !Number.isInteger(row.id) || Number(row.id) <= 0)
    throw new WavelogError("Wavelog returned an invalid station entry; station access could not be verified.")
  for (const field of ["name", "callsign", "gridsquare", "sota", "pota"]) {
    if (row[field] != null && typeof row[field] !== "string") throw new WavelogError("Wavelog returned unsupported station field types.")
  }
  const identity: Record<string, string | null> = {}
  for (const key of Object.values(STATION_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue
    const value = row[key]
    if (value != null && typeof value !== "string" && typeof value !== "number") throw new WavelogError("Wavelog returned unsupported station identity fields.")
    identity[key] = value == null ? null : String(value)
  }
  return {
    identity,
    id: Number(row.id),
    name: text(row.name),
    callsign: text(row.callsign),
    grid: text(row.gridsquare),
    sota: text(row.sota),
    pota: text(row.pota),
  }
}
