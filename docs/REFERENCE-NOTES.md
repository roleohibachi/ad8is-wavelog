# Station-location references reviewed

Reviewed 2026-11-16, as supplementary context for the implementation plan.
No source from these projects has been copied into the extension.

- [DB4SCW: Station Locations in Wavelog and POTA](https://www.db4scw.de/station-locations-in-wavelog-and-pota/)
  (article dated 2026-04-29).
- [mooxle/pota2wavelog](https://github.com/mooxle/pota2wavelog), source checkout
  at `../references/pota2wavelog` relative to this project; commit
  `9718388d2b2b533efce34c8f76a3292b4221ef4c`. The current source is more developed
  than the cached README returned by web search; findings below use that source.

## Agreement with our design

Wavelog station-locations carry station grid and activation data used for
statistics and downstream confirmations. Create or reuse the correct station
before importing its contacts. A generic portable station with a dummy grid is
not equivalent to a correctly attributed log. The article also illustrates one
park spanning different grids, supporting our decision that park reference
alone is not enough to identify a station-location.

The Python tool follows the same basic read/preview/create/import sequence and
supports multiple simultaneous POTA references. Its use of the full PoLo ADIF
export is consistent with our desire to retain the complete activation identity
rather than rely on one activity-specific file. Previewing station metadata and
allowing correction before creating it are useful patterns we already plan.

Station creation does not fully configure downstream QSL services. The article
discusses separate LoTW/eQSL behavior, and the tool describes manual QRZ upload
configuration. Our extension must report success as a Wavelog import, without
promising external service configuration or delivery. Do not copy its generic
station workaround, credential propagation, or automatic QRZ setup.

## Deliberate differences

The tool's `check_duplicate` currently searches station _names_ for any requested
POTA ref, then applies a locator-distance threshold if both grids exist. Its
callsign parameter is unused, and it does not compare the complete POTA set or
SOTA identity. This is an interactive candidate suggestion, not a sufficient
exact-match algorithm for our extension. We use structured station fields and
the entire selected identity combination; ambiguous candidates require selection.

The tool offers GPS-drift merging and correction of a configured home-grid
fallback. Its importer can rewrite MY_GRIDSQUARE to the chosen station grid.
We will not infer that nearby locations are identical, replace a home grid, or
change the source location automatically. Any future correction feature would
need explicit user review and separate tests. Park-directory coordinates are
not evidence of the actual operating position and must not silently replace
Halo's location.

The Python parser filters activation detection to POTA-tagged QSOs and its
new-station payload has no SOTA reference. Our uploader must also handle SOTA,
combined SOTA/POTA and neither-reference locations. Per-QSO power stays intact.

The current tool uses legacy `station_info`, `create_station` and QSO endpoints;
it does not establish API v2 behavior for our extension. Also, station-list errors
return an empty list in that tool: our implementation must distinguish failure
to read stations from a successful empty result, and stop creation on failure.
Its observed creation-body-size workaround is not treated as a universal API
limit; use documented APIs and actionable server errors instead.

## Additional regression cases

- Same grid/POTA combination but different station call: no automatic reuse.
- Same call/grid/POTA but absent versus present SOTA: distinct identity.
- POTA set A+B versus A only: distinct identity; incidental station naming has
  no influence on matching.
- Nearby distinct grids do not merge merely because they are within 5 km.
- A home grid in the source is not silently replaced by park coordinates.
- An unsuccessful station-list request cannot authorize creating new stations.
- A power change does not split station-locations or overwrite per-QSO power.

These references support the overall architecture, not each other's heuristic
assumptions. Our extension retains the reviewed station-combination semantics.
