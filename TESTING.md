# Device acceptance

## Phase 3 — Local station-location preview

- Artifact: `dist/ad8is-wavelog-0.1.0-alpha.4.h2kext`.
- Manifest API 23; SDK/tools 1.26.0; app target v26.11.0 build 193.
- Automated checks: 33 tests and typecheck passed, including segment boundaries,
  frozen source contacts, power preservation, reference combinations, Unicode
  ADIF lengths, preview settings, and actual bundled SDK delegation to the core
  exporter. The delegate's output is simulated in automated tests: actual device
  ADIF/activity integration remains the acceptance gate. Known official build
  activation-preflight warning remains documented in README.
- SHA-256: `8d2a76185f5fb4cf617935a4a9c7b19f3d9e0e751673a4da547563a207131f91`.
- Archive integrity, official package validation, manifest and license asset
  checks passed. Copied to the approved Nextcloud staging folder; the copied
  checksum matches the build artifact.
- Device result: pending human test. No Wavelog mutations are implemented.

### Device checklist

1. Install alpha.4 from the Nextcloud staging folder, preserving the existing
   panel and account. The permissions are unchanged from Phase 2.
2. Open a known SOTA+POTA operation. Panel menu → Preview station-locations
   (local). Check the count, station callsign, grid, both refs and proposed SOTA
   name against the original log and WaveRover dry-run on its Full ADIF export.
   This does not use the SOTA/POTA website submission file selectors.
3. On a test operation, add a BREAK changing grid/refs and contacts on each side.
   Expect separate combinations; a contact at the boundary belongs to the later
   segment. Return to the original combination and expect its group to gain the
   additional contacts. A BREAK without changed identity creates no new group.
4. Change power within one test location: the group remains one, and source QSO
   power values remain unchanged. No upload is performed in this test.
5. Open Preview settings. Try four-character grid precision and a different name
   template using selected fields, then restore six characters and
   `{MY_SOTA_REF}`. A blank template should use automatic naming. Check settings
   survive reopening the app. Do not remove a naming field without also changing
   its template; unsupported fields/settings should report a clear error.
6. Test a POTA-only operation and a location with neither ref: expect automatic
   fallback names. An empty operation should show zero QSOs/groups. Preview
   should work without a Wavelog account and without internet if the app's
   enabled activity exporters have their needed data available locally.
7. Confirm no station or QSO was added in Wavelog. Preview is local; Test
   connection is a separate action and remains available for the Phase 2 check.

Report the OS/edition/build, first preview results and any error text, redacting
private data. This milestone is intentionally a local preview: server matching,
station creation and upload follow only after human acceptance.

Suggested human milestone commit after review/device success:

```sh
git add -A
git diff --cached
git commit -S -m "feat: preview segment-aware station-location groups locally"
```

## Phase 2 — Read-only Wavelog connection

- Artifact: `dist/ad8is-wavelog-0.1.0-alpha.3.h2kext`.
- SHA-256: `b99da376f45c6b2c613914cead2f476f52f8bf7a731a91ba3fbb1536da50da47`.
- SDK/tools: 1.26.0; manifest API 23 (panel menu).
- Target app: November '26 BETA v26.11.0 build 193.
- Automated results (2026-11-16): typecheck, 23 tests, build, official package
  validation, archive integrity, manifest permissions, About text and license
  asset verification passed. The known official activation-preflight warning
  remains; the separate built-bundle test activates through the SDK, renders
  without requests, and tests the explicit account GETs with a fake transport.
- Device results: **pending human test**. No real Wavelog server was contacted
  by the automated tests, and no station/QSO mutations exist in this milestone.
- Staging: copied to the approved Nextcloud `Documents/ham/Ham2k PoLo/` folder;
  the copied bundle's SHA-256 matches the build artifact above.

### Device checklist

Regression fix in alpha.3: omit the scheme when entering the base URL (for
example `wavelog.seery.us`) and confirm HTTPS is assumed. Explicit HTTP must
still be rejected. The previous alpha.2 bundle remains in dist for comparison.

1. Install `0.1.0-alpha.3` from the approved Nextcloud staging folder. Keep the
   existing panel/layout. Accept the new `*` network permission after checking
   the About description. Test with developer mode disabled. If Halo asks whether
   to preserve credentials from a changed file source, allow it for this known
   local build; Phase 1 did not store Wavelog credentials.
2. Open Settings → Accounts → Wavelog. Enter your public HTTPS Wavelog base URL
   and API v2 `wl2_` token. Connect/Test should report API v2 access and the number
   of readable stations. The test uses the token directly, without token exchange.
3. Open the Wavelog panel's tab/settings menu → **Test connection (read-only)**.
   Check its result dialog against Wavelog Station Setup: station count, IDs,
   names, callsigns, grids and both SOTA/POTA refs (first ten entries shown).
   No new stations or QSOs should appear. If the menu/action is absent, report
   what the tab settings button does; this is a new host-API path for us.
4. Save/restart Halo and confirm the Wavelog account is still available. Run
   Test connection again. A last-successful-test summary is historical and is
   not proof the current token/network still works. Changing the URL must not
   display the other server's saved success as a current result.
5. Test an invalid token by changing one character in a copy of the configured
   value, not by revoking your working token. Expect a useful rejection. Restore
   the working value and test again. Confirm no full token appears in errors.
6. Optionally use a separate `station:read`-only token. Expect a successful
   read-only connection with a list of missing future-upload scopes. A token
   without station:read must fail before attempting station listing. Do not
   change or rotate the existing token merely to run this optional test.
7. Test offline: operation details still render without making requests, while
   explicit Test connection should fail clearly. A login/challenge HTML result
   should name the URL/SSO/Cloudflare issue rather than claim success or show
   the raw response. Use the canonical trusted API base URL without redirects.

Report OS/edition/build, the result of steps 1–5 and any useful redacted error.
The existing wildcard/local-network restriction remains; a private/Tailscale
Wavelog server is not supported by this milestone. Do not post tokens or full
station lists publicly when reporting results.

### Review and commit gate

After the device results pass, review the complete diff and untracked files,
then make your own milestone commit, preferably signed:

```sh
git add -A
git diff --cached
git commit -S -m "feat: configure Wavelog account and test API v2 access"
```

The assistant makes no commits. Proceed to Phase 3 after human device review.

## Phase 1 history

### Artifact and automated results

- Extension: `ad8is-wavelog`, version `0.1.0-alpha.1`.
- Manifest API: 1; SDK/tools: 1.26.0.
- Target app: November '26 BETA v26.11.0 build 193.
- Device OS/edition: to be recorded by tester.
- Artifact: `dist/ad8is-wavelog-0.1.0-alpha.1.h2kext`.
- SHA-256: `d7e979d1de63dd1b1649d0bcd0305b2cad1da4036f9c4265951290acabca489b`.
- Automated results (2026-11-16): typecheck, five tests, build, package validation,
  format check, archive integrity and included license notices passed. npm install
  reports zero known dependency vulnerabilities after the sharp override.
- Known tooling warning: the official build activation preflight skips because
  its local host-provided country library is absent. Our separate built-bundle
  activation/render test passes with documented library stand-ins; this does not
  replace a real-device test (see README).
- Device result: **partial pass reported by the human**: the bundle installed
  correctly and the dashboard/panel is visible when added to an operation.
  Operation switching, count refresh, restart and other checklist steps have not
  yet been reported. Device OS/edition remain unrecorded.

### Approved artifact staging

The human staged the first artifact with the command below and authorized the
assistant to copy future milestone bundles to the same directory. Use each
bundle's versioned filename; stage only after build/tests/package checks pass.
Writing this path may require tool permission outside the workspace. This is a
file copy, not catalog publication or automatic installation on the device.

```sh
cp dist/ad8is-wavelog-0.1.0-alpha.1.h2kext '/mnt/nextcloud-data/roleo/files/Documents/ham/Ham2k PoLo/'
```

### Device checklist

1. Transfer the artifact to the device. With developer mode disabled, open
   Settings → Extensions & Features → Install from file… and select it. Check
   the identity/version. It should request no network or radio permissions.
2. Open an existing operation, edit that view's layout and add the Wavelog
   panel. Confirm the extension version, operation name, operation ID, station
   callsign and QSO count. Compare the count with Halo's own log; event rows
   such as BREAK should not count as contacts.
3. Switch to another operation. The panel should show its different identity
   and count without retaining the first operation's details. If the second
   view uses a different layout, place the panel there too.
4. On a disposable/test operation, add and delete a test contact through Halo's
   normal controls. Confirm the count follows both changes after the host's
   refresh delay. Avoid adding fabricated contacts to a real activation.
5. Open an empty operation: expect zero QSOs and the no-contacts message. If
   the app lets you place this panel outside an operation, expect an instruction
   to open one; this step is optional if that layout is unavailable.
6. Close/reopen Halo. Confirm the panel remains in the saved layout and renders
   the correct current operation. Try offline; the panel should still work.
7. Check readability in a narrow phone pane and with a larger font. Long IDs
   should remain readable with the host's normal scrolling/wrapping behavior.

Report the device OS, app edition/version/build, steps passed, and any failure
or diagnostic text (redact personal log data). If a panel is missing, note
whether the extension appears enabled and whether Wavelog is offered in the
layout editor. A screen recording or screenshot is optional, not required.

### Phase 1 review and commit gate (completed)

After the device test passes, review `git diff` and new files, then make your
own commit, preferably signed/verified:

```sh
git add AGENTS.md .gitignore .prettierignore .prettierrc.json package.json package-lock.json tsconfig.json build.mjs manifest.json src test assets README.md TESTING.md LICENSE THIRD_PARTY_NOTICES.md PLAN.md
git diff --cached
git commit -S -m "feat: add installable operation-scoped Wavelog panel"
```

If commit signing is not configured, decide how to configure it or omit `-S`
yourself. No assistant-created commits. The human committed Phase 1 as `410b290` and authorized proceeding to Phase 2.
