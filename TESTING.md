# Phase 1 acceptance

## Artifact and automated results

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

## Approved artifact staging

The human staged the first artifact with the command below and authorized the
assistant to copy future milestone bundles to the same directory. Use each
bundle's versioned filename; stage only after build/tests/package checks pass.
Writing this path may require tool permission outside the workspace. This is a
file copy, not catalog publication or automatic installation on the device.

```sh
cp dist/ad8is-wavelog-0.1.0-alpha.1.h2kext '/mnt/nextcloud-data/roleo/files/Documents/ham/Ham2k PoLo/'
```

## Device checklist

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

## Review and commit gate

After the device test passes, review `git diff` and new files, then make your
own commit, preferably signed/verified:

```sh
git add AGENTS.md .gitignore .prettierignore .prettierrc.json package.json package-lock.json tsconfig.json build.mjs manifest.json src test assets README.md TESTING.md LICENSE THIRD_PARTY_NOTICES.md PLAN.md
git diff --cached
git commit -S -m "feat: add installable operation-scoped Wavelog panel"
```

If commit signing is not configured, decide how to configure it or omit `-S`
yourself. No assistant-created commits. Phase 2 starts after this gate.
