# AD8IS Wavelog

A Halo / Ham2K PoLo Next extension. **Phase 1 is an operation panel only**:
it shows the extension version, selected operation's name/ID, station callsign,
and Halo's real-contact count. It refreshes when the operation or log changes.
An operation with no contacts and a view without an operation have explicit
empty states. It uses Halo's standard Markdown rendering and theme.

This version has no network permission, credentials, station-location creation
or QSO upload. Those follow the human-reviewed phases in [PLAN.md](PLAN.md).
Wavelog's server and the existing WaveRover wrapper are unaffected.

The operation dashboard panel is the intended final interface. Later milestones
add Preview, Upload and results there using existing Halo extension APIs, without
changes to Halo itself. Optional live upload is a possible later phase, not part
of this release; the panel can then display connection, queue and error status.

## Install and try

The built file is `dist/ad8is-wavelog-0.1.0-alpha.1.h2kext`. Copy it to your
device using your normal file-transfer workflow. In Halo open **Settings →
Extensions & Features → Install from file…**, choose it, and enable AD8IS
Wavelog if needed. In an operation view's layout editor, add the **Wavelog**
panel. Exact layout controls can vary by device; this adds a panel rather than
a new export or menu command.

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
The manifest uses API 1: this milestone only uses the basic panel contract,
operation/log triggers and supplied render data. The target app's API ceiling
is 26. Shared libraries remain host-provided, not bundled copies. Future phases
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
