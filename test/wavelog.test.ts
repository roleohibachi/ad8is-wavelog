import assert from "node:assert/strict"
import { test } from "node:test"
import { checkConnection, connectionSummary, credentialsOf, normalizeServer } from "../src/wavelog.ts"
import type { Transport } from "../src/wavelog.ts"

const token = "wl2_SYNTHETIC_TEST_TOKEN"
const credentials = { url: "https://log.example.org/wavelog/", token }
const allScopes = ["station:read", "station:write", "qso:write", "logbook:read", "logbook:write", "lookup:read"]
const station = { id: 7, name: "Hill", callsign: "AD8IS/P", gridsquare: "EM89AB", sota: "W8O/SE-004", pota: "US-5450" }
const ok = (data: unknown) => ({ status: 200, body: JSON.stringify({ data }) })

test("normalization preserves installation paths and explicit index.php without a browser URL global", () => {
  assert.equal(normalizeServer(" HTTPS://LOG.EXAMPLE.ORG:443/wavelog/// "), "https://log.example.org/wavelog")
  assert.equal(normalizeServer("https://log.example.org:8443/index.php/"), "https://log.example.org:8443/index.php")
  assert.equal(normalizeServer("https://log.example.org"), "https://log.example.org")
})

test("a missing scheme defaults to HTTPS, preserving port and installation path in actual API requests", async () => {
  assert.equal(normalizeServer(" log.example.org:8443/wavelog/ "), "https://log.example.org:8443/wavelog")
  assert.equal(normalizeServer("log.example.org"), "https://log.example.org")
  const requests: string[] = []
  const result = await checkConnection(
    async (url) => {
      requests.push(url)
      return url.endsWith("/token") ? ok({ id: 1, scopes: allScopes }) : ok([])
    },
    { ...credentials, url: "log.example.org/wavelog/" },
  )
  assert.equal(result.url, "https://log.example.org/wavelog")
  assert.deepEqual(requests, ["https://log.example.org/wavelog/api/v2/token", "https://log.example.org/wavelog/api/v2/station"])
})

test("invalid, ambiguous, credential-bearing and non-public URL spellings fail before sending credentials", async () => {
  for (const url of [
    "",
    "http://log.example.org",
    "ftp://log.example.org",
    "ssh://log.example.org",
    "https://user:password@log.example.org",
    "https://log.example.org/?key=secret",
    "https://log.example.org/#secret",
    "https://log.example.org\\@evil.example",
    "https://localhost",
    "https://ares.local",
    "https://100.64.1.1",
    "https://192.168.1.1",
    "https://[::1]",
    "https://bad..example",
    "https://log.example.org:0",
    "https://log.example.org:65536",
    "https://log.example.org/has space",
  ]) {
    await assert.rejects(checkConnection(async () => assert.fail("Invalid URL must never fetch"), { url, token }))
  }
  assert.throws(() => credentialsOf({ ...credentials, token: "legacy-key" }), /API v2 token/)
  assert.throws(() => credentialsOf({ ...credentials, token: "wl2_bad\r\nheader" }), /API v2 token/)
})

test("connection sends only two GETs with Bearer authentication, returning structured station data", async () => {
  const requests: string[] = []
  const fetch: Transport = async (url, options) => {
    requests.push(url)
    assert.equal(options.method, "GET")
    assert.equal(options.body, undefined)
    assert.equal(options.headers?.Authorization, `Bearer ${token}`)
    assert.equal(options.headers?.Accept, "application/json")
    assert.equal(options.timeout, 8000)
    assert.ok(!url.includes(token))
    return requests.length === 1 ? ok({ id: 1, scopes: allScopes }) : ok([station])
  }
  const result = await checkConnection(fetch, credentials)
  assert.deepEqual(requests, ["https://log.example.org/wavelog/api/v2/token", "https://log.example.org/wavelog/api/v2/station"])
  assert.deepEqual(
    result.stations.map(({ identity, ...station }) => station),
    [{ id: 7, name: "Hill", callsign: "AD8IS/P", grid: "EM89AB", sota: "W8O/SE-004", pota: "US-5450" }],
  )
  assert.deepEqual(result.missingUploadScopes, [])
  assert.match(connectionSummary(result), /1 station-location/)
  assert.ok(!JSON.stringify(result).includes(token))
})

test("a read-only token can connect while reporting missing future upload permissions", async () => {
  const result = await checkConnection(async (url) => (url.endsWith("/token") ? ok({ id: 1, scopes: ["station:read"] }) : ok([])), credentials)
  assert.deepEqual(
    result.stations.map(({ identity, ...station }) => station),
    [],
  )
  assert.deepEqual(result.missingUploadScopes, allScopes.slice(1))
  assert.match(connectionSummary(result), /Missing scopes/)
})

test("missing station:read stops before station listing", async () => {
  let calls = 0
  await assert.rejects(
    checkConnection(async () => {
      calls++
      return ok({ id: 1, scopes: [] })
    }, credentials),
    /missing station:read/,
  )
  assert.equal(calls, 1)
})

test("HTTP errors and login HTML are actionable and never echo response bodies", async () => {
  const cases = [
    { status: 401, body: token, message: /rejected.*401/ },
    { status: 403, body: token, message: /denied.*403/ },
    { status: 404, body: token, message: /not found.*404/ },
    { status: 429, body: token, message: /HTTP 429/ },
    { status: 502, body: token, message: /HTTP 502/ },
    { status: 200, body: `<html>SSO ${token}</html>`, message: /HTML\/login page/ },
    { status: 403, body: `<html>Cloudflare ${token}</html>`, message: /Cloudflare/ },
    { status: 200, body: token, message: /invalid API JSON/ },
    { status: 200, body: JSON.stringify({ error: { message: token } }), message: /unsupported API v2 response/ },
    { status: 200, body: JSON.stringify({ status: "ok", token }), message: /unsupported API v2 response/ },
  ]
  for (const { message, ...response } of cases) {
    await assert.rejects(
      checkConnection(async () => response, credentials),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, message)
        assert.ok(!error.message.includes(token))
        return true
      },
    )
  }
})

test("transport errors are redacted without exposing headers or token", async () => {
  await assert.rejects(
    checkConnection(async () => {
      throw new Error(`Authorization: Bearer ${token}`)
    }, credentials),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Connection failed or timed out/)
      assert.ok(!error.message.includes(token))
      return true
    },
  )
})

test("malformed token metadata is never considered authenticated", async () => {
  for (const data of [null, [], {}, { id: 0, scopes: [] }, { id: 1, scopes: "station:read" }, { id: 1, scopes: [123] }]) {
    await assert.rejects(
      checkConnection(async () => ok(data), credentials),
      /invalid|unsupported/i,
    )
  }
})

test("station-list failure and malformed rows cannot be mistaken for an empty server", async () => {
  for (const data of [{}, [null], [{ id: 0 }], [{ id: 1, gridsquare: 123 }]]) {
    await assert.rejects(
      checkConnection(async (url) => (url.endsWith("/token") ? ok({ id: 1, scopes: allScopes }) : ok(data)), credentials),
      /invalid|unsupported/i,
    )
  }
  await assert.rejects(
    checkConnection(async (url) => (url.endsWith("/token") ? ok({ id: 1, scopes: allScopes }) : { status: 500, body: "error" }), credentials),
    /HTTP 500/,
  )
})
