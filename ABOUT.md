# Wavelog connection test

AD8IS Wavelog is an operation dashboard panel for Ham2K Halo / PoLo Next.
This development version displays operation details and tests a public HTTPS
Wavelog API v2 connection. It reads existing station-locations; station creation
and QSO upload will come in later milestones.

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
