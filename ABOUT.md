# Wavelog local preview and connection test

AD8IS Wavelog is an operation dashboard panel for Ham2K Halo / PoLo Next.
This development version previews local station-location combinations and tests a public HTTPS
Wavelog API v2 connection. It can compare the local groups against existing station-locations, without changing them; reviewed station creation is now available, with QSO upload reserved for a later milestone.

Configure your Wavelog URL and `wl2_` token in Settings → Accounts → Wavelog.
HTTPS is assumed if you omit the URL scheme; explicit HTTP is not supported.
Then use the panel's menu → Test connection (read-only). Your token needs
`station:read`. Other upload permissions are checked only for future readiness.
Credentials are stored by Halo's account/keychain facilities and are not logged
or placed in panel/layout settings.

The extension requests wildcard network access because Wavelog is self-hosted
at users' own hostnames. It makes requests only to your configured Wavelog API;
Halo itself may follow server redirects. Use a trusted public HTTPS URL that
serves API JSON directly, without an interactive SSO/login redirect. LAN,
Tailscale and plain HTTP installations are outside this version's scope.

There are no automatic uploads or requests while the panel renders, and no
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
