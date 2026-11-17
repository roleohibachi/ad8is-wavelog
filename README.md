# AD8IS Wavelog

A Halo / Ham2K PoLo Next extension. **Phase 6 adds reviewed QSO upload**, retaining operation details and the read-only API v2 connection test.
The panel uses Halo's standard Markdown rendering and theme.

Manual QSO upload is now implemented, following the human-reviewed phases in
[PLAN.md](PLAN.md). The existing WaveRover wrapper is
unaffected.

The operation dashboard panel is the intended interface for preview, comparison,
creation and upload, using existing Halo extension APIs without changes to Halo. Optional live upload is a possible later phase, not part
of this release; the panel can then display connection, queue and error status.

## Install and try

The built file is `dist/ad8is-wavelog-0.1.0-alpha.7.h2kext`. Copy it to your
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
name format and grid precision. Current defaults are:
`STATION_CALLSIGN,MY_GRIDSQUARE,MY_SOTA_REF,MY_POTA_REF`, automatic naming, and six
characters. Four-character grids are also supported. Callsign and grid remain
mandatory match fields, and power is deliberately unsupported as identity.
Every naming placeholder must refer to a selected field; a blank template or
blank expanded result uses automatic naming: available SOTA refs, POTA refs, then
grid joined with comma-space. Dates and callsigns are omitted from the automatic
name but callsign remains part of matching identity. Examples: `W8O/SE-004,
US-5450, EM89AB`, `US-5450, EM89AB`, or `EM89AB`. Existing panel settings retain
their saved templates; clear Location name format once to adopt this new default. Settings for lookup/ITU fallback
will arrive with station creation, where they have an effect.

The preview explicitly excludes private notes and lookup-derived data and caps
grid precision at six characters. It does not silently inherit a user's private
backup export settings. Confirm displayed grids against the original log. When
an export fails, changes the record count, omits a known SOTA/POTA activation
reference, or lacks callsign/grid, preview stops with an error. Display is capped
at 50 groups, while the total covers the entire operation. Exports require a
single resolved callsign per contact; unresolved multi-call forms are rejected.
The source operation and contacts are never modified.

## Compare with Wavelog

Panel menu → **Compare with Wavelog (read-only)** generates a fresh local preview
and fetches token metadata and stations using the current account. Each group
shows an existing station ID/name, a proposal for a new location, ambiguity, or
a blocked result where identity fields cannot be compared. No stations, logbooks
or QSOs are created or modified, and this is not a QSO duplicate check.

Matching uses the complete selected structured-field combination, never station
names. Blank refs differ from present refs. References are normalized as sets;
case is ignored and grids use the selected precision. Multiple exact matches
are reported rather than choosing the first. Omitted API fields remain distinct
from explicitly empty fields and block a potentially matching candidate.
Only stations readable through the API are considered; server settings may
restrict the visible list to an active logbook. A new-location proposal means
no match in that visible list, not proof that no hidden location exists.

Results are not cached or saved as an upload plan. Re-running always regenerates
the operation preview and refetches stations, including after changing accounts,
settings or logs. Results show at most 50 groups. Choosing a target for an
ambiguous group will be part of the later reviewed creation/upload workflow.

## Create missing station-locations (no QSO import)

Panel menu → **Create missing station-location… (no QSOs)** creates one reviewed
location at a time. It first regenerates preview/reconciliation. Select a new
combination and whether to use callsign lookup for missing DXCC/CQ values, then
review the proposed name, fixed identity, server and active logbook. Fill the
required DXCC number, CQ zone and ITU zone. Uniform MY_DXCC/MY_CQ_ZONE/MY_ITU_ZONE
values from the exported contacts prefill the form; lookup fills missing values
only. Lookup suggestions require review against the actual operating location,
especially for entities spanning zones. ITU is never invented by callsign lookup.
Preview settings has an optional fallback ITU zone for new stations.

Nothing is created unless you submit the final form with its explicit creation
checkbox checked. Cancellation or an unchecked checkbox makes no writes. Identity
fields are fixed by preview; editing required metadata that is itself a selected
match field requires correcting the source/settings and previewing again.
The source operation and current station list are reread after review, before
creation. Ambiguous/unsupported identities are not created automatically.

Required scopes are station:read, station:write, logbook:read and logbook:write.
lookup:read is optional: without it or after lookup failure, fill metadata
manually. qso:write is not needed until the upload milestone. There must be one
existing active logbook; the extension does not create or select a logbook.

After POST /api/v2/station, it checks the returned identity, rereads the active
logbook's station_ids and PATCHes the list with the new ID appended. Previously
linked IDs are preserved. New stations have Club Log upload, eQSL nickname and
PSKReporter live reporting disabled; external-service credentials are not copied.
No fixed station power is sent. No QSO endpoint is called.

Writes are not retried automatically. After a timeout, malformed write response
or linking failure, inspect Station Setup and logbook membership before another
attempt. A partial-success message includes the station ID when known. The next
attempt reconciles visible stations again, and a 409 conflict is resolved only
when one exact visible match is found. An unlinked newly created station may be
hidden by the server's active-logbook-only preference, so do not blindly repeat
creation after an uncertain result. Creation/linking are separate operations;
logbook list updates have no atomic append or cross-client uniqueness guarantee.
Concurrent edits between the last read and PATCH can still race.

## Upload reviewed QSOs

Panel menu → **Upload QSOs…** builds a fresh local snapshot and compares station
identities again. Every group must have exactly one existing station target.
For a missing target, use the already-tested Create action, then rerun Upload;
this milestone deliberately keeps station creation and QSO upload as separate
reviewed steps. Ambiguous/blocked matches cannot upload.

Review the HTTPS server, group counts and station IDs, then check the explicit
confirmation box to import. Cancellation or an unchecked box makes no writes.
After review it rereads the operation/export and station targets: changed
contact data (including power) or changed target IDs stops before the first
POST. qso:write plus station:read are sufficient for uploading to existing
locations; the full six-scope token covers creation/lookup as well. qso:read is
not required. Source contacts are not marked uploaded or modified in Halo.

Imports use POST /api/v2/qso with ADIF batches of at most 20 contacts and 20,000
UTF-8 ADIF bytes, sequentially per station. Oversized individual contacts fail
before confirmation. Exported contact fields and per-QSO power are retained;
selected station identity fields are normalized consistently with preview,
including the selected grid precision. Private notes/lookup data remain excluded.
No activity-specific award submission file or reference-expanding export is used.

The panel shows job progress and a final imported/duplicate/rejected/uncertain/
unattempted summary. Wavelog supplies aggregate batch counts, not per-contact
status assignments. Batch contact numbers refer to grouped **upload order**, not
original chronological log rows. Structured zero-import validation failures are
classified without displaying raw server messages. Inconsistent counts,
unstructured errors or lost responses are uncertain; the job stops on a
rejection or uncertainty and leaves later contacts unattempted. Successful prior
batches stay imported. No application retry is automatic.

Panel actions start a single tracked task and return promptly, avoiding Halo's
five-second panel-event timeout while the review dialog or import is running.
This also applies to Preview, Compare, Test connection and Create. Repeat taps
are ignored while an action runs. A visible panel refreshes every two seconds
for progress; rendering never performs API requests or starts jobs.

Keep Halo in the foreground until a result arrives. Closing a panel is not a
cancel action once import has begun. Mobile background execution is not
reliable; runtime/app restart loses in-memory job status and never resumes
uploads automatically. Inspect Wavelog before retrying an interrupted/uncertain
upload. Re-uploading an unchanged log relies on Wavelog's duplicate detection;
edits to identifying contact fields may be new contacts, and edits/deletions are
not synchronized. No exactly-once delivery guarantee or live sync is claimed.

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
the extension cannot promise strict same-origin redirect refusal. A redirected
POST can also forward its data body even when Authorization is stripped; use a
trusted canonical API URL that does not redirect. It detects
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
