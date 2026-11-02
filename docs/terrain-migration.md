# Terrain migration record (Phase 04.2)

This document records every known difference between the legacy compiled maps
(ribbon roads + legacy heightfield collider) and the terrain versions the game now
loads for `feel-test`, `grid-test` and `juliette-ga` (phase 04.2, plans 11 and 15;
SC-5, D-07, D-08). The converter is `tools/map-compiler/terrain/convert.ts`
(`npm run convert-terrain -- --area <id|all>`), configured by `CONVERT_CONFIG`.

Date of the medal re-record: 2026-11-02.

## Summary of what changed for every migrated map

| Aspect | Legacy | Terrain (migrated) |
|---|---|---|
| Format files | `<area>.map.json` (road graph), `<area>.collision.json` (128x128 heightfield + building boxes), `<area>.glb` (ribbon roads, shoulders, buildings, crests) | `<area>.terrain.bin` (height grid + paint map) and `<area>.terrain.json` (sidecar: road graph v1, objects, building colliders). Legacy files stay on disk, still used for building meshes and by legacy-loader tests |
| Ground height source | Legacy 128x128 heightfield with a 0.1 m sink below the road ribbons | Terrain grid. feel-test exactly 0 m. Other maps: legacy heightfield resampled with the 0.1 m sink removed, then every road band levelled to its road-graph height |
| Road shoulders | Ribbon shoulder skirts in the .glb (6 m after phase 04.1) | No separate road mesh. A levelled band (road half width) plus a shoulder of 2 grid cells blended back to the surrounding ground with a smoothstep |
| Surfaces | Per-ribbon surface on road colliders, ground surface elsewhere | Paint map at 0.5 m per pixel. Road pixels carry their edge's surface, tarmac wins over unpaved where roads overlap |
| Buildings | Box colliders from `collision.json`, meshes from the .glb `buildings` node | Colliders from the terrain sidecar `buildings` array (same boxes). Meshes still come from the legacy .glb `buildings` node (`legacyGlbBuildings: true`) |
| Crests | Authored crests baked into the .glb and runtime trimesh | Sidecar `objects`, identical geometry |
| Routes | `<area>.routes.json` against `<area>.map.json` | Unchanged file. The road graph is copied verbatim, so node and edge ids are identical and routes validate unchanged |
| Saved player bests | `localStorage` key `heat-street.medals.v1`, keyed by course id | Kept. Course ids did not change, so existing bests remain, but they are now graded against the re-recorded bands below |

## Per map

### feel-test

| | Legacy | Terrain |
|---|---|---|
| Collider grid | 128x128 heightfield over 1340 x 1040 m (about 10.6 x 8.2 m cells) | 347 x 447 vertices at 3 m (155,904 vertices) |
| Paint resolution | n/a | 2682 x 2082 px at 0.5 m |
| Heights | Flat, sink 0.1 m under ribbons | Exactly 0 m everywhere (flat test area) |
| Ground surface | tarmac | tarmac (3 gravel road edges keep gravel) |
| Buildings | none | none (`legacyGlbBuildings: false`) |
| Crests | 7 authored crests | 7 sidecar objects, identical geometry |
| Medals | unchanged | unchanged (D-07: geometry identical, so `feel-test.medals.json` was not re-recorded) |

### grid-test

| | Legacy | Terrain |
|---|---|---|
| Collider grid | 128x128 heightfield over 720 x 600 m (about 5.7 x 4.7 m cells) | 200 x 240 vertices at 3 m (48,441 vertices) |
| Paint resolution | n/a | 1440 x 1200 px at 0.5 m |
| Heights | Flat-authored heightfield, sink 0.1 m | Legacy heights with sink removed (off-road within 0.01 m of legacy), roads levelled to graph height |
| Ground surface | grass | grass |
| Buildings | 124 boxes | 124 sidecar colliders, meshes from legacy .glb |
| Crests | none | none |

| Course | Old reference (s) | New reference (s) |
|---|---:|---:|
| `grid-test-stagger-run` (p2p) | 107 | 138.25 |
| `grid-test-block-loop` (circuit, 3 laps) | 354 | 354.833 |

The old grid-test numbers were never a driven run: `tools/map-compiler/synthetic/author-grid-routes.ts`
generated them from an average-speed formula. The new numbers are a designer reference run.
**Re-running `author-grid-routes.ts` would overwrite `grid-test.medals.json` with formula values
again**, so don't run it unless you mean to replace the reference.

### juliette-ga

| | Legacy | Terrain |
|---|---|---|
| Collider grid | 128x128 heightfield over 5504 x 5657 m (about 43 x 45 m cells) | 708 x 689 vertices at 8 m (489,210 vertices) |
| Paint resolution | n/a | 11024 x 11328 px at 0.5 m (about 125M pixels, within the 2^27 cap) |
| Heights | Flat-authored heightfield (phase 04.1), sink 0.1 m | Legacy heights with sink removed, roads levelled to graph height (node/point heights within 0.02 m) |
| Ground surface | grass | grass |
| Buildings | 85 boxes | 85 sidecar colliders, meshes from legacy .glb |
| Crests | 3 authored crests | 3 sidecar objects, identical geometry |
| Shoulder blend width | 6 m ribbon shoulder | 2 cells = 16 m smoothstep blend |

| Course | Old reference (s) | New reference (s) |
|---|---:|---:|
| `juliette-backroads-run` (p2p) | 180 | 170.65 |
| `juliette-three-lap-loop` (circuit, 3 laps) | 420 | 307.683 |

Note on the circuit reference: in lap 3 the circuit-03 to circuit-04 sector took about 76 s,
against about 42 to 48 s on laps 1 and 2 (probably an incident on that run). The total is
used as the user recorded it.

## Medal reference re-record (D-07)

- Recorded 2026-11-02 by the user, one designer reference run per course, on the migrated
  terrain maps. Each line was produced by the debug-only `[medal-reference]` console log
  (`buildReferenceCourseRecord` in `src/core/medal-reference.ts`, printed from `src/main.ts`
  `onCompleted` under `?debug`) and pasted unchanged into the medals files.
- **Car used:** the shipped feel-preset car, not the base `defaultTuning()` car. Since commit
  3363300 the user's own feel preset is `FEEL_DEFAULTS`, and with no saved tuning `src/main.ts`
  builds the player car from it on every URL. The user cleared stale saved tuning before the
  runs. `handlingContentVersion` is `"261101-terrain"` (the value plan 04.2-15 pins); it
  stands for the terrain maps driven on this feel-preset car.
- **The times are PROVISIONAL.** The user says the car still needs tuning, and these runs had
  several spins. They are placeholders and will be re-recorded after the handling work. The
  medals file format has no notes field, so this is recorded here and in the plan summary only.
- Thresholds use the unchanged medal bands (ace 0.9, gold 1.0, silver 1.15, bronze 1.35 of the
  reference total).
- Headless telemetry and feel-dossier tools still use `defaultTuning()` (the old base car), not
  the shipped feel preset (follow-up).
- The Circuit Race AI tests (`tests/ai-lap.test.ts`, `tests/ai-field.test.ts`) now read a frozen
  copy of the phase 06-03 Juliette reference
  (`tests/fixtures/juliette-ga.06-03-legacy.medals.json`). Circuit Race is forced off on terrain
  areas, and the AI pace calibration was made against the legacy map and that reference. Against
  the new circuit reference the AI is about 30% slower than Silver pace (follow-up, if Circuit
  Race is brought to terrain).

## Differences the user noticed while driving

- Roads on juliette-ga and grid-test feel narrow but look realistic. All roads may be widened
  by 1 to 2 m later (follow-up, not done).
- Lift-off oversteer is still open: releasing the throttle at speed on the narrow roads spins
  the car. This is a feel follow-up, not a terrain issue.
- feel-test: no differences expected (identical geometry).

## Known issues

- **No boundary at the terrain edge (open).** During the reference runs the user drove off the
  edge of the terrain area and fell off the world. The user found no gaps in the ground. The
  heightfield edge has no wall or barrier, so the car can drive off the map. Follow-up: add an
  edge wall, an invisible barrier, or a respawn when the car leaves the bounds.
- Medal references are provisional (see above).

## Maps that were not migrated (D-08)

`my-map`, `newton-poppleford` and `skidders-and-popp` still load through the legacy ribbon
loader. They have no medals and no guarantees. The legacy ribbon/collision path is kept for
them and for future bridges, overpasses and tunnels.
