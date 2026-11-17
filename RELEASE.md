# Release preparation

## 0.1.0-alpha.8 release notes (draft)

AD8IS Wavelog adds a manual Wavelog upload workflow to an operation dashboard
panel in Halo / Ham2K PoLo Next. It uses the app's existing extension system and
full ADIF exporter; no app changes, companion server or CLI are required.

- Preview the operation's callsign/grid/SOTA/POTA combinations, including BREAK
  segments. Power stays per QSO and does not split station-locations.
- Compare structured station identities, reuse one exact match, and block
  ambiguous or unsupported combinations. Station names are not identity.
- Create one reviewed missing station and link it to the active logbook. Then
  review and confirm QSO upload to existing station IDs.
- Upload sequential batches, report aggregate imports/duplicates/rejections/
  uncertainty and stop on failed or uncertain batches without retrying.
- Store the public HTTPS URL and API v2 token through Halo's account facilities.
  The complete workflow uses the six scopes in README.md.

Changes since the tested alpha.7: task-launch failures release the panel for a
new action; a failed results dialog preserves completed upload counts in the
panel; cancellation is explicit in its status. Documentation now describes the
complete workflow and the API-v2-only release scope. Added large-operation,
offline recovery, changed-server and task/dialog failure tests.

Install the versioned `.h2kext` through Settings → Extensions & Features →
Install from file…; keep the existing account and panel. Target device testing
is November '26 BETA v26.11.0 build 193. See TESTING.md for artifact checksums,
reported device results and the alpha.8 upgrade gate. This is a prerelease,
not a catalog publication or a claim of support for all Halo platforms.

Limits: public HTTPS and API v2 only; no legacy keys, HTTP/private-network
servers, browser/CORS support, live sync, edit/delete mirroring, persistent job
history or automatic resume. Keep Halo foregrounded while uploading. Server
duplicate detection is configuration-dependent. Inspect Wavelog after an
uncertain result before retrying. Multiple exact station matches require
resolution in Wavelog or more specific identity fields. Missing locations are
created through the separate Create action, not silently during upload.

## Draft contribution description

Suggested title: **Add AD8IS Wavelog operation upload extension**

Operators exporting a new activation need the corresponding Wavelog
station-location before they can import its contacts. This extension previews
each effective callsign/grid/SOTA/POTA combination, reconciles it against
readable Wavelog stations, and provides separately confirmed creation and QSO
upload actions from an operation dashboard panel. An unchanged grid with
different activation references remains a different identity; a power change
stays per contact.

The integration uses public HTTPS Wavelog API v2, Halo account storage and the
built-in full ADIF generator. It blocks ambiguous targets, preserves existing
logbook links during creation, and reports partial or uncertain import results
without automatic retries. No Halo core changes or companion service are
required. Installation, scopes, permissions, limitations and test procedures
are documented in README.md and TESTING.md.

Validation: automated transport/form tests, an ES2020 bundled-SDK activation
test, typecheck, formatting and package validation. The human reported the
incremental panel, connectivity, preview, reconciliation, creation and upload
milestones working on v26.11.0 build 193. Split-operation device coverage and
other OS/platform testing are unverified; synthetic tests cover segment
grouping and interruption behavior. See the results matrix for exact claims.

This description can accompany a standalone repository or an extension-source
contribution; adapt file paths and contribution layout to the chosen target.
It does not propose an app-core change. No PR or catalog entry has been created.

## Human review and publication gate

1. Install alpha.8, verify account/panel/settings preservation, and follow its
   short device checklist in TESTING.md. Record only the checks actually run.
2. Review `git diff`, new files and the existing milestone history. `LICENSE`
   is still untracked at preparation time; include it when staging the release
   so the source distribution carries its AGPL-3.0-only license. Review the bundled
   third-party notices too. No WaveRover code is included.
3. Make your own traceable commit, signed/verified where possible. Suggested
   message: `fix: harden manual upload task recovery and document release`.
   Preserve the earlier device-tested milestone commits for review.
4. Choose the repository/contribution destination, review this description and
   release notes, then create the PR/release yourself. Catalog publication,
   tags, public asset uploads and maintainer messages need a separate explicit
   instruction; none are performed by this preparation step.
