# AD8IS Wavelog

A Halo / Ham2K PoLo Next extension. **Phase 2 adds read-only Wavelog API v2
connectivity** to the operation panel. It retains the operation name/ID,
station callsign, contact count and automatic refresh from Phase 1. It uses
Halo's standard Markdown rendering and theme.

There is no station-location creation or QSO upload yet. Those follow the
human-reviewed phases in [PLAN.md](PLAN.md). The existing WaveRover wrapper is
unaffected.

The operation dashboard panel is the intended final interface. Later milestones
add Preview, Upload and results there using existing Halo extension APIs, without
changes to Halo itself. Optional live upload is a possible later phase, not part
of this release; the panel can then display connection, queue and error status.

## Install and try

The built file is `dist/ad8is-wavelog-0.1.0-alpha.3.h2kext`. Copy it to your
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
