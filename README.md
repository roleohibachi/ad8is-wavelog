# AD8IS Wavelog

A Halo / Ham2K PoLo Next extension. **Phase 3 adds a local station-location
preview**, retaining operation details and the read-only API v2 connection test.
The panel uses Halo's standard Markdown rendering and theme.

There is no station-location creation or QSO upload yet. Those follow the
human-reviewed phases in [PLAN.md](PLAN.md). The existing WaveRover wrapper is
unaffected.

The operation dashboard panel is the intended final interface. Later milestones
add Upload and server reconciliation there using existing Halo extension APIs, without
changes to Halo itself. Optional live upload is a possible later phase, not part
of this release; the panel can then display connection, queue and error status.

## Install and try

The built file is `dist/ad8is-wavelog-0.1.0-alpha.4.h2kext`. Copy it to your
device using your normal file-transfer workflow. In Halo open **Settings →
Extensions & Features → Install from file…**, choose it, and enable AD8IS
Wavelog if needed. In an operation view's layout editor, add the **Wavelog**
panel, or keep the one you placed in Phase 1. Exact layout controls can vary by
device; this adds a panel rather than a new export or operation-tools command.

Under **Settings → Accounts → Wavelog**, enter your public HTTPS Wavelog base
URL (including any installation subpath) and `wl2_` API v2 token. Connect/Test
assumes HTTPS when the URL has no scheme, so `log.example.org/wavelog` works.
An explicit `http://` or another protocol is rejected. The connection test
reads `GET /api/v2/token` and `GET /api/v2/station` only. The token is used
directly as a Bearer credential; no token exchange or v1 `/api/version` call is
needed. Halo stores the credentials in its platform account/keychain facilities,
with iCloud credential synchronization disabled for this account.

In the Wavelog panel, open its tab/settings menu and choose **Test connection
(read-only)**. The result dialog lists the readable station count and the first
ten IDs, names, callsigns, grids and SOTA/POTA references. The panel may show a
last-successful-test summary; that is historical, not a live connectivity check.
Panel rendering never makes requests. Reopen/refresh the panel after changing
the account if it still shows the previous render.

`station:read` is sufficient for this milestone. The result also reports missing
permissions for later uploads with lookup enabled: `station:write`, `qso:write`,
`logbook:read`, `logbook:write`, and `lookup:read`. Missing those write/lookup
scopes does not prevent a successful read-only test. They are inspected as token
metadata; no write requests are made to test them. Legacy keys are not supported
in this milestone.

## Local station-location preview

Open the panel menu → **Preview station-locations (local)**. No Wavelog account
is required for preview. It reads the operation's local contacts and BREAK/START
events, resolves each segment against the base operation, and copies missing
location defaults onto exported contacts while preserving their own explicit
location and power. It delegates to Halo's **full ADIF generator**, not the
SOTA/POTA award-submission export options. Those activity extensions contribute
reference fields to full ADIF through their standard hooks.

The result shows contact counts, station combinations and proposed names. It
makes no Wavelog API requests and does not check existing stations or duplicates.
A return to the same combination reuses one group; a power change does not split
it. Missing and present references remain distinct. Comma/semicolon-separated
reference lists are trimmed, uppercased, deduplicated and sorted for identity.

**Preview settings** in the panel menu edits this panel placement's match fields,
name format and grid precision. Defaults match the working WaveRover wrapper:
`STATION_CALLSIGN,MY_GRIDSQUARE,MY_SOTA_REF,MY_POTA_REF`, `{MY_SOTA_REF}`, and six
characters. Four-character grids are also supported. Callsign and grid remain
mandatory match fields, and power is deliberately unsupported as identity.
Every naming placeholder must refer to a selected field; a blank template or
blank expanded result uses automatic naming. Settings for lookup/ITU fallback
will arrive with station creation, where they have an effect.

The preview explicitly excludes private notes and lookup-derived data and caps
grid precision at six characters. It does not silently inherit a user's private
backup export settings. Confirm displayed grids against the original log. When
an export fails, changes the record count, omits a known SOTA/POTA activation
reference, or lacks callsign/grid, preview stops with an error. Display is capped
at 50 groups, while the total covers the entire operation. Exports require a
single resolved callsign per contact; unresolved multi-call forms are rejected.
The source operation and contacts are never modified.

## Network permission and limits

The install screen asks for `*` network access because each user supplies their
own Wavelog hostname. Extension-generated URLs are restricted to the configured
base plus the two API paths above. It does not call a relay or companion server.
URL validation rejects embedded credentials, queries, fragments, HTTP, IP-literal
addresses and local-name spellings. Use an ASCII public DNS hostname (punycode
for international names). Halo also blocks wildcard access to private addresses,
including names resolving to LAN/Tailscale addresses; developer mode is not a
supported workaround for the acceptance test. A trusted HTTPS certificate is
required. Browser builds/CORS are not yet a supported target.

Halo's native fetch follows HTTPS redirects and strips Authorization, cookies
and proxy credentials when the hostname changes. The extension cannot disable
redirects or inspect the final response URL/headers with this SDK. Its wildcard
permission still applies to redirect hops; unlike direct requests, their targets
are chosen by the server. The host's credential-stripping check compares
hostnames, not ports. Use the canonical trusted HTTPS URL with no API redirects;
the extension cannot promise strict same-origin redirect refusal. It detects
HTML/login/challenge responses and reports an actionable error instead of
displaying the response body. Authentication through a browser's existing SSO
cookies is not used.

Follow [TESTING.md](TESTING.md) before advancing to Phase 2. Current device
target is November '26 BETA v26.11.0 build 193; actual device acceptance is
pending. Installing an updated file under the same key updates the extension.

## Build

Use Node 24 or later and npm. This workspace has a local installation at
`../.tools/node`; if the host's default Node is older, from this directory:

```sh
export PATH="$(pwd)/../.tools/node/bin:$PATH"
npm ci
npm run typecheck
npm test
npm run format:check
npm run pack
sha256sum dist/*.h2kext
```

The SDK and tools are pinned to 1.26.0 in package.json and package-lock.json.
The manifest uses API 23 for the panel menu/event entry point, plus account and
HTTPS-fetch hooks. The target app's API ceiling is 26. Shared libraries remain
host-provided, not bundled copies. Future phases
must raise the manifest API if they use a capability that requires it.

The official build's activation preflight currently warns that it cannot load
the host-provided country library from local node_modules. We do not install or
bundle a second copy of Halo's shared libraries to hide that warning. The bundle
test evaluates the actual built JavaScript, activates it through the SDK, checks
registered hooks/permissions and renders the panel with host calls forbidden.
It supplies minimal library stand-ins for the SDK's eager DXCC and mode
initialization; this is not a test of country/mode data or the device's QuickJS
runtime. The on-device checklist remains the acceptance gate.

`sharp`, an optional screenshot-publishing dependency of the pinned tools, is
overridden to a patched release (`^0.35.5`). This milestone neither publishes
screenshots nor uses it at runtime. The lockfile records the resolved version.

Source lives in `src/`; tests in `test/`; generated output in `build/` and
`dist/` is ignored by Git. `npm run pack` builds and validates the package.
`npm run dev` is available for local development but is not necessary for the
file-installed device test. No catalog publication has been performed.

Original project code is MIT licensed. SDK/scaffold attribution is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No WaveRover source is included.
