# Wavelog operation upload

AD8IS Wavelog is an operation dashboard panel for Ham2K Halo / PoLo Next.
Preview station-location combinations, compare them with your public HTTPS
Wavelog API v2 server, create reviewed missing locations and upload your QSOs.
Creation and upload are separate explicit actions.

Configure your Wavelog URL and `wl2_` token in Settings → Accounts → Wavelog.
HTTPS is assumed if you omit the URL scheme; explicit HTTP is not supported.
Then use the panel's menu → Test connection (read-only). Your token needs
`station:read`. The complete workflow needs station:read, station:write, logbook:read,
logbook:write, lookup:read and qso:write. Legacy API keys are not supported.
Credentials are stored by Halo's account/keychain facilities and are not logged
or placed in panel/layout settings.

The extension requests wildcard network access because Wavelog is self-hosted
at users' own hostnames. It makes requests only to your configured Wavelog API;
Halo itself may follow server redirects. Use a trusted public HTTPS URL that
serves API JSON directly, without an interactive SSO/login redirect. LAN,
Tailscale and plain HTTP installations are outside this version's scope.

Opening the panel triggers a read-only station check when online; uploads and
station creation require confirmation. No
companion server or change to Halo itself is required. This is an independent
integration, not an official Wavelog or Ham2K release.

Use the panel menu → Preview station-locations (local) for an account-free dry
run of the operation. Preview settings control match fields, naming and grid
precision. It uses Halo's full ADIF generator, not activity-specific award
submission files. BREAK/START segments, explicit contact locations and per-QSO
power are preserved; no Wavelog request is made by the preview.

Compare with Wavelog (read-only) reports existing IDs, proposed new locations,
ambiguous matches and missing identity fields. Automatic names contain available
SOTA/POTA refs and grid; dates and callsigns are omitted from names only.

Create missing station-location… (no QSOs) is an explicit write action. It lets
you review required metadata and confirm one new station and its active-logbook
link. Canceling or leaving confirmation unchecked makes no writes. Callsign
lookup is optional. Required write permissions are station:write and
logbook:write, in addition to their read scopes. No contacts are imported.
Inspect Wavelog before retrying an uncertain or partially successful creation.

Upload new QSOs reviews target station IDs and counts before an explicit
confirmation. It imports sequential ADIF batches and reports aggregate outcomes.
Missing station-locations are reviewed and created first, with separate confirmations. Upload needs qso:write
and station:read; the complete workflow uses the six scopes listed in README.
Actions run as tracked jobs, not from panel rendering. Keep Halo foregrounded
and inspect Wavelog before retrying any interrupted or uncertain import.
⚠️ Edits to previously uploaded QSOs are not synced. Correct them in Wavelog
too; some changes may create duplicates. There is no automatic retry,
restart/resume, live sync or edit/delete mirroring.
