# Halo Wavelog extension: phased implementation

Status: plan reviewed and initially committed by the human. Phase 1 was
implemented as `0.1.0-alpha.1`, installed by the human and committed as
`410b290`. The human authorized continuing to Phase 2, read-only account and
connection testing, committed by the human as `f08e700`. Phase 3 local preview
was accepted and committed by the human as `3e0e95e`. A combined SOTA/POTA
operation was tested on-device; split-operation device coverage is unavailable
and remains automated-only. Phase 4 was accepted and committed by the human as `1b8e008`. Phase 5 was accepted and committed by the human as `9222738`. Phase 6 (`0.1.0-alpha.7`) was reported working and committed by the human as
`80d8c9a`. Phase 7 release preparation is implemented as `0.1.0-alpha.8`, pending
upgrade verification. The human explicitly chose API v2 only for this release;
legacy support is deferred. See TESTING.md and RELEASE.md. No device installation, publication or commits have been
performed by the assistant. Work lives under `./dev`.

Phase 1 device feedback: the human installed `0.1.0-alpha.1` successfully and
confirmed the panel is visible in an operation. Remaining checklist items are
unreported. The human has selected the operation dashboard panel as the final
UI: this project is an extension only and must not require upstream Halo changes
or a new export/action hook. See TESTING.md for authorized Nextcloud artifact
staging.

## Outcome and scope

An installable TypeScript extension for Ham2K Halo / PoLo Next that uploads an
operation to Wavelog, reusing or creating the appropriate station-locations
before importing its QSOs. No companion server, Script Server dependency, native
Go library, or changes to Halo core. Existing WaveRover and its working Docker
wrapper remain independent.

Initial target: native Halo on the user's device, connecting to a public HTTPS
Wavelog installation. Use the existing `wavelog.seery.us` URL as user-entered
configuration, never a hardcoded default. This release supports API v2 tokens only. Legacy-key support is deferred by
human decision after the v2 device test.
Browser builds, continuous sync, bidirectional edits/deletions, private-network
servers, and HTTP servers are outside the first release.

The extension key will be `ad8is-wavelog`, matching the user's callsign. UI is
plain and functional, using an operation dashboard panel with standard Halo
controls/forms for Preview, Upload and results. The panel is the final entry
point, not a workaround pending upstream changes. Network writes
must never happen from panel rendering, export-option discovery, or log-save
hooks. Changing a log should not unexpectedly upload it.

The panel can later show an opt-in live-upload mode, connection/queue status,
last successful upload and per-contact failures. Keep transport, station matching
and upload coordination separate from rendering so manual and future live modes
can share them. Actual live uploads need their own tested queue/reconciliation
design: logging must not wait for the network, app/runtime restarts must not lose
track of uncertain outcomes, and mobile background execution is not guaranteed.
Do not start live uploads simply because a panel renders or becomes visible.
Live mode remains outside the first release and requires a later human-approved
phase; do not build its queue or timers speculatively during the manual phases.

## Workspace and references

- `dev/ad8is-wavelog/`: proposed standalone extension project and this plan.
- `dev/references/halo/`: reference-only app/SDK checkout, commit
  `83f5a1a77639098363d59bd3d159d26666fc418b`.
- `dev/references/ham2k-extensions/`: official examples, commit
  `a02673343cb34c76a6c65d2b04420709db3c6f6b`.
- `dev/references/app-polo/`: old Wavelog experiment, commit
  `d296caf7fb36688bfb4ec456e4e29ad0d05dafa6`.
- `dev/waverover/`: behavioral reference at
  `e0a2d841eac20163429e308d06630d40acf712af`.

Primary documentation: <https://catalog.ham2k.net/docs>. Its source is in
`dev/references/halo/docs/extensions/`, particularly `getting-started.md`,
`concepts.md`, `manifest.md`, `accounts.md`, `settings.md`, `panels.md`,
`forms.md`, `host.md`, `import-export.md`, and `publishing.md`. Read the
installed SDK's documentation and types when implementing: the checkout may
be newer than the user's device. The official Club Log Livestream extension
demonstrates account credentials and delegating ADIF generation to Halo.

The old `app-polo/src/tools/qsonToWavelog.js` requires one manually configured
station ID for the entire upload. Do not carry that design forward.

Supplementary station-location references and their deliberate differences from
our matching rules are recorded in [docs/REFERENCE-NOTES.md](docs/REFERENCE-NOTES.md):
DB4SCW's station-location article and `mooxle/pota2wavelog`. Carry the listed
regression cases into the grouping, reconciliation and station-creation phases.

## Development and device-test loop

Device target reported by the user: **November '26 BETA, v26.11.0, build 193**.
Device OS and exact edition remain to be recorded. The reference checkout's
`app/lib/config/version.dart` also declares v26.11.0 / BETA / build 193, and
`app/lib/services/extensions/installed_extensions.dart` declares extension API
**26**. Treat API 26 as the provisional compatibility ceiling for this target,
not proof that every main-branch feature is in the installed build. Select the
lowest API needed by our actual hooks; verify the packed artifact on the device
before relying on newer capabilities. SDK package versions and manifest API
levels are separate version numbers.

Before finalizing SDK/API versions, record the device OS and Halo edition,
and verify supported capabilities. Use Node 24 or later for development, compatible
with the official extension repository's current tooling. Pin a compatible SDK
and extension-tools version in the lockfile; do not blindly target the newest
manifest API. Use the official scaffold and build preset rather than inventing
a bundle format. It emits an ES2020 IIFE for the sandbox.

Create a new Git repository/branch for this extension, separate from WaveRover.
Scaffold in a temporary subdirectory **inside this project**, then merge the
generated files while preserving this plan, since the initializer refuses to
overwrite an existing directory. Read the generated AGENTS.md before coding.
Keep implementation under `src/`, tests/fixtures under `test/`, documentation
in README.md and TESTING.md, and generated bundles under `build/` and `dist/`.
Ignore dependencies, generated bundles, local settings and credentials.

For every milestone:

1. Run typecheck, focused automated tests, build, and pack validation.
2. Produce a versioned `.h2kext` under `dist/` and record its SHA-256, SDK/API
   versions, and what the user should observe in TESTING.md. Keep a record of
   the previously passing artifact for rollback.
3. Transfer the artifact to the device using the user's existing file-transfer
   workflow. Install through Settings → Extensions & Features → Install from
   file. No catalog publication or new public hosting is needed for this.
4. The human runs the milestone's device test, reviews the diff and docs, and
   records pass/fail plus app/build and any useful redacted diagnostic output.
5. Resolve failures before advancing. The human makes the proposed commit,
   signed/verified where possible. The assistant must not create commits.

Use the same key across milestones so upgrades preserve settings. Increment the
prerelease version for each delivered artifact; replacing an installation from
a different source can prompt about preserving saved credentials. Prefer file
installation for acceptance tests with developer mode disabled, so development
mode cannot hide wildcard/private-network restrictions. An optional LAN dev
server can speed coding later, but does not replace the packed-artifact test.

## Phase 0 — Agree on the behavioral contract

Deliverables: this plan, a small behavioral specification, synthetic ADIF/QSON
fixtures, and a recorded device/SDK compatibility target.

Default settings mirror the working wrapper:

```text
match-fields = STATION_CALLSIGN,MY_GRIDSQUARE,MY_SOTA_REF,MY_POTA_REF
name-format = automatic (available SOTA ref, POTA refs, grid; comma-separated)
grid-precision = 6
lookup = true
ITU fallback = unset
```

Resolve these semantics before writing network mutations:

- A station-location represents the selected combination. Missing SOTA/POTA
  values are meaningful, not wildcards. Same grid plus different activation
  references must produce separate groups. Do not infer activation validity
  merely from the existence of a grid or reference.
- Follow WaveRover's documented alias, case, grid precision and naming behavior,
  including automatic naming when the SOTA template resolves to blank. Keep
  profile names separate from matching identity; a name alone is not a match.
- Use Halo's operation/segment model rather than inventing arbitrary per-QSO
  station changes. An ordinary unsegmented operation has one effective station
  identity. BREAK/START can override the grid, refs or station call for later
  segments within that same operation; a break without changed identity fields
  does not require a new station-location. Resolve these through Halo's segment
  model and canonical ADIF export, not just the base operation's fields.
- Full ADIF Export spans segments (with station-call slicing performed by the
  host export workflow). Activity-specific exports may instead slice by reference
  and may omit other programs' references. A reference-specific file is therefore
  not automatically the full SOTA/POTA identity needed by Wavelog. Our Upload
  action operates on an operation, not a collection of user-selected export files;
  inspect/preserve the host's segment and callsign slicing when delegating.
- Group equal selected identity combinations across segments; neither each BREAK
  nor each generated export file necessarily implies a different Wavelog station.
  Preserve compound/multiple references; characterize actual exporter output
  before deciding normalization. Do not manufacture extra contact records by
  using an activity-specific export that expands reference combinations.
- Power is per QSO (`TX_PWR`) and is not a station-location matching field for
  this extension. A power change alone must not split the location; do not infer
  or set a fixed station power from a group whose contacts have varying power.
  Preserve the original QSO power values during upload.
- Record the matching behavior for longer existing grids and empty values.
  Use synthetic test vectors to compare the Go and TypeScript decisions.
- Known parity decision: WaveRover warns and skips fields missing from Wavelog's
  station response, and returns the first matching profile. Proposed extension
  behavior is to block upload when identity fields cannot be checked and ask
  for a selection if several profiles match. Human review must explicitly
  accept these departures; do not silently weaken matching or guess a target.
- Preview is read-only: local grouping plus optional server comparison. Label
  local dry-run separately from server comparison. Neither promises exact QSO
  duplicate counts; those depend on Wavelog's import response.

There is no LICENSE file in the current WaveRover checkout. Implement from the
behavioral contract and independently written fixtures; confirm permission
before copying source or protected test material for redistribution.

Human gate: review this contract, API-v2-first scope and parity decisions.
Proposed human commit: `docs: define Wavelog extension milestones and semantics`.

## Phase 1 — An installable operation panel

Implement the official scaffold with a plain operation-scoped Wavelog panel.
It shows its extension version and selected operation name/ID, plus contact
count from the supported context API. No credentials or network calls yet.
Check the exact panel action/context signatures against the installed SDK.

Automated verification: typecheck, activation/build checks, packed manifest and
hook validation; a focused test for selecting the current operation. Do not
duplicate SDK tests or add tests for static label text.

Device gate: install, add/open the panel, switch between two operations and
verify counts/identity change correctly, then restart Halo and reopen it.
No app-core build or developer-mode-only behavior should be required.

Proposed human commit: `feat: add installable operation-scoped Wavelog panel`.

## Phase 2 — Account configuration and read-only connectivity

Add URL and token account fields using Halo's account/keychain facilities, plus
one settings panel in the exports section if needed. Preserve URL subpaths and
normalize trailing slashes. Require HTTPS and reject credentials embedded in
URLs. Do not log tokens, Authorization headers, or whole account objects.

Declare `domains: ["*"]`; explain why arbitrary public Wavelog hosts require it.
Requests generated by the extension originate only from the configured Wavelog
URL and paths constructed by the client. Halo's fetch API exposes no redirect
control: native fetch follows HTTPS redirects, strips credentials when the
hostname changes (not merely the port), and does not return the final URL.
Therefore strict same-origin/no-redirect behavior cannot be implemented by this
extension. Require a trusted canonical API URL, document that server redirects
can reach other permitted public HTTPS destinations, and surface an actionable
error when expected Wavelog JSON is replaced by SSO/login HTML.
This phase must expose any incompatibility with the user's Cloudflare/SSO path.
No relay or server-side proxy is introduced.

Implement a transport-injected API v2 client using `host.fetch`, including direct
Bearer authentication, token metadata validation, scope checks and station
listing. API v2 has no token exchange in this workflow. The connection test
requires station:read and reports other missing future-upload scopes without
performing mutations.
The Connect/Test button reports success, missing permissions, invalid token,
HTML instead of JSON, network errors and unsupported API responses. Never
create a station, logbook, or QSO during a connection test. Inspect write-scope
metadata without calling write endpoints.

Automated tests use a fake transport returning response fixtures, not a running
Wavelog instance. Test HTTPS validation, URL subpaths, direct Bearer auth, errors,
header handling, redaction, and unexpected HTML. Keep token fixtures synthetic.

Device gate: connect to the public HTTPS Wavelog server with a real v2 token;
verify correct read-only station listing, an invalid token error and restored
credentials after restarting Halo. Test with developer mode disabled.

Proposed human commit: `feat: configure Wavelog account and test API v2 access`.

## Phase 3 — Local ADIF and station-location preview

Obtain the full operation's ADIF through the built-in exporter, with explicit
choices that retain station grid/reference data needed for upload. Verify
privacy/export preferences rather than silently overriding them. If required
data is suppressed, explain which setting is needed or block the upload.

Add pure modules for ADIF reading, grouping, normalization, field mappings and
name expansion. Provide settings for match fields, name format, grid precision,
lookup and ITU fallback. Do not port the Go CLI's file I/O or prompting.
Display the resulting combinations and QSO counts, with no server writes.

Tests cover absent/present SOTA/POTA, same-grid different references, portable
callsigns/aliases, grid precision, blank name fallback, BREAK/START segment
overrides, unchanged-identity breaks, returning to a previous identity, and power
changes that remain one location with distinct per-QSO `TX_PWR` values,
non-ASCII ADIF values and ADIF length handling. Verify no contacts are lost or
duplicated by export/parse/group. Include a small parity table against WaveRover
and separate expected intentional differences.

Device gate: preview one real SOTA+POTA activation; compare grouping and names
with WaveRover dry-run. Test an operation with a BREAK changing grid/refs and
check each QSO lands in the group for its effective segment. Contrast Full ADIF
with reference-specific export files, and verify a power-only change does not
split the group. Export original logs for reference.

Proposed human commit: `feat: preview operation station-location groups`.

## Phase 4 — Read-only reconciliation with Wavelog

Fetch station-locations and show, for every group, either the existing ID/name,
a proposed new station, or an unresolved/ambiguous match. Distinguish empty
fields from unsupported response fields. Revalidate cached account/server and
operation identity so changing either cannot reuse a stale match plan.

Tests cover exact combinations, empty refs versus nonempty refs, case/grid
normalization, unsupported fields, several matching profiles, changed account,
and changed operation/settings. Assert the preview never calls write endpoints.

Device gate: use a known previously imported activation and confirm the actual
existing station ID is selected. Use a new combination and confirm it is
proposed as new. For a known SOTA-only/POTA-only/same-grid pair, verify the
extension does not collapse them into one location.

Proposed human commit: `feat: reconcile preview groups with Wavelog stations`.

## Phase 5 — Create station-locations, without importing QSOs

Add an explicit, clearly labeled Create missing stations action to the reviewed
preview. Show the proposed fields first. Resolve missing ITU information in a
form and offer optional callsign lookup. Re-read stations before creation and
again when a creation response is uncertain, to reduce duplicate creations.
Use returned station/logbook IDs according to Wavelog API v2; port the Go
client's required association steps rather than guessing them.

Tests cover successful creation, reuse, required fields, lookup on/off, missing
scope, authentication expiry and uncertain/time-out responses. Do not blindly
retry creation after a transport failure. A second attempt must reconcile first.
Concurrent clients may still race if the server does not enforce uniqueness;
document that limit rather than promising atomic deduplication.

Device gate: the human chooses one real new activation, reviews its fields and
creates its location. Verify it in Wavelog Station Setup, including grid and
both reference fields. Run the same action again and verify reuse. QSO count
must remain unchanged. Any cleanup of test stations is a human decision.

Proposed human commit: `feat: create missing activation stations from preview`.

## Phase 6 — Upload a reviewed operation

Add Upload with a final summary of target stations and group counts. Refresh
the plan if log data, settings, credentials or server state changed since
preview. Revalidate/create missing stations before uploading their groups.
First uploader deliberately requires every target to exist: the user creates
missing locations through the separately reviewed Phase 5 action, then reruns
Upload. This avoids hiding station mutations inside an import confirmation.
Use the existing Wavelog API v2 batch/import semantics, conservatively sized
chunks and sequential requests; map results back to source contacts.

Report imported, duplicate, rejected and unknown-outcome contacts separately.
Do not treat every HTTP 2xx as complete success. Disable repeat taps while a run
is active. If a timeout makes acceptance uncertain, say so; no blind automatic
retry and no promise of exactly-once delivery. Do not mark Halo contacts as
uploaded unless the host provides appropriate durable state and the server
actually confirmed them. Restarting Halo must never automatically resume writes.

Tests cover several target stations, mixed imported/duplicate/rejected results,
partial batches, interruption, missing scopes, double submission prevention and
association of every uploaded record with the correct station ID. Exercise
whether a changed callsign/time/band/mode could evade server duplicate detection;
do not claim edits or deletes are synchronized.

Device gate: the human uploads a small chosen group to a reviewed station and
checks actual contacts/metadata in Wavelog. Re-upload that same unmodified group
and check Wavelog's duplicate result. Then test a complete activation, including
SOTA+POTA and more than one station combination where available. Record exact
results instead of assuming all Wavelog configurations dedupe identically.

Proposed human commit: `feat: upload reviewed QSO groups to matching stations`.

## Phase 7 — Compatibility and release preparation

Decision after Phase 6: the human chose to keep this release API v2 only.
Do not implement legacy support during this release-preparation phase. A future
legacy-key client adapter would use
the same pure matching/grouping modules and result model. Keep future v2 and legacy
endpoint/authentication paths distinct. Test any future legacy adapter against
fixtures. Live legacy testing needs a human-provided key and chosen test log;
do not downgrade or rotate the existing working token automatically.

Complete offline/error recovery, large-operation progress, account changes,
packaged-install upgrades and permission messaging. Check secret redaction and
ensure failure during upload does not interfere with logging in Halo. Validate
what state survives extension runtime/app restarts before documenting it.
Run tests, typecheck, format checks, build and pack. Re-run v2 device acceptance
after adding legacy support. Test another supported device/OS when available;
do not claim coverage for untested platforms or web/CORS behavior.

README: installation, public-HTTPS limitation, token scopes, plain upload steps,
defaults, station matching, unsupported fields, duplicate limitations, partial
failures, privacy/export preferences and known limits. TESTING.md: reproducible
device acceptance scripts and a results matrix with versions, artifact hashes
and human outcomes. ABOUT.md: explain wildcard permission and account usage.
Include a license for independently authored extension code and notices for any
permitted reused material.

Human gate: review the complete diff/history and device results; decide whether
to submit to `ham2k/extensions` or publish from a standalone repository. Prepare
a draft PR description and release notes. The human creates traceable commits
and submits the PR. Catalog publication is separate and requires an explicit
instruction; no account creation, token requests, public uploads or messages to
maintainers happen as a side effect of implementation.

Proposed human commits: `feat: support legacy Wavelog keys` (if included), then
`docs: document installation and verified device upload workflow`. Fixes should
be separate descriptive commits where they improve reviewability; do not squash
away the incremental device-test history before the human reviews it.

## First implementation session

After reviewing this plan, begin Phase 1 only: use the reported v26.11.0 build 193
target, record the device OS/edition, scaffold the standalone extension,
build/pack it, and deliver the first
artifact plus exact install/panel instructions. Stop at the device gate before
adding credentials or network calls. Each later phase likewise ends with a
working, inspectable artifact and a short human test, not a large untested port.
