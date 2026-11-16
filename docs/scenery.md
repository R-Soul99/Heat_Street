# Scenery (07.1.3)

Scenery is the set of placeable things in a terrain sidecar: trees, bushes, hedges, fences and
buildings. One module, `src/render/scenery-view.ts`, draws it for both the game and the editor.
Colliders come from `src/core/scenery-geometry.ts` and `src/physics/terrain-scene.ts`, so the
numbers the player sees and drives into are the same numbers.

## Catalog ids

The catalog lives in code (`src/core/scenery-catalog.ts`); the sidecar stores only ids.
**Ids are a file format. Never rename or remove one: add a new id instead.**

| Kind | Ids |
|---|---|
| tree | `pine`, `oak`, `dead` |
| bush | `round`, `scrub` |
| hedge | `box` |
| fence | `post-rail`, `picket`, `chainlink` |
| building style | `shed`, `house`, `barn`, `shop`, `block` |

A building with no style is a terrain-native building (plain box, no roof).

## Limits

| Limit | Value | Note |
|---|---|---|
| Point features (trees and bushes) | 4,000 | parser safety limit |
| Line features (hedges and fences) | 500 | parser safety limit |
| Points per line | 64 | |
| Buildings | 2,000 | parser safety limit |
| Scenery triangles | 40,000 | HARD editor limit, see Budget |

## Solidity (D-10)

| Kind | Solid to cars | Pursuit line of sight |
|---|---|---|
| tree | yes, trunk only | does not block |
| bush | no | does not block |
| hedge | yes | blocks |
| fence | yes | does not block |
| building | yes | blocks |

In the game, `TerrainScene.sightTransparentHandles` (trunk and fence colliders) is added to the
set of colliders the pursuit line-of-sight ray ignores, so trunks and fences are see-through while
hedges and buildings block.

## Hedge and fence minimum height

Hedges and fences have a 1.0 m minimum height. Measured headlessly (flat grass, full throttle for
4 s from 15 m, plan 06): a 1.0 m line stops the car (chassis rise 0.47 m, car stopped at
x = -2.85 / -2.55), while a 0.5 m line was climbed over (car ended at x = 31.9 / 41.7). Below
about 1.0 m the wheels simply drive over the kerb, so the minimum keeps a "solid" line solid.
Line colliders are at least 0.4 m thick (thin fences would tunnel at speed).

## Hedges and fences on slopes

Each hedge or fence segment (at most 8 m) follows the ground: it runs from the ground height at
its start to the ground height at its end, tilted along its length (`LineSegment.pitch`). The
drawn hedge box, the fence rails and the collider all use the same tilt (`lineBoxQuat`), so
neither end floats or is buried and the rails stay on their posts. Posts and picket slats stand
upright, each seated on the ground under it. The collider also extends 0.3 m below that ground
line, which covers a small dip under the middle of a segment. A segment is still one straight
piece, so over a sharp crest or hollow shorter than a segment its middle can sit a little above
or below the ground. The tilt changes no box counts: triangle estimates and the 40,000 budget
depend only on line length, never on terrain height.

## Rendering rules

- No scenery mesh casts or receives shadows (D-19).
- Palette buildings are one merged mesh per style and are NOT in `buildingMeshes`; they are not
  camera-faded. The car x-ray covers a car hidden behind one (D-17).
- Terrain-native (style-less) buildings are drawn on maps that are not `legacyGlbBuildings`; styled
  buildings are drawn on every map (D-11).
- AI cars ignore scenery: there is no scenery avoidance in `ai-avoidance.ts` or the AI fleet
  (D-20). AI cars will drive into trees and fences like any other solid. Keep scenery off the
  routes AI cars use.

## Budget (D-09)

- At most 12 draw calls (the layout uses 11): trunks, cone canopies, sphere canopies, bushes, one
  unit-box InstancedMesh for every hedge segment, fence rail/panel and fence post, one merged mesh
  per building style (5), and one for style-less buildings.
- 40,000 scenery triangles is a **hard** limit in the editor. The editor refuses any placement,
  scatter or line that would go over it. Scatter places as many as fit and reports how many were
  skipped. Deletes and moves are always allowed. The parser caps above (4,000 / 500 / 2,000) stay
  as the file safety limit.
- Triangles are counted from the catalog table, not from scale or height (`SCENERY_TRIANGLES`):

| Part | Triangles |
|---|---|
| tree trunk (open cylinder, 5 sides) | 10 |
| cone canopy (open, 5 sides) | 5 |
| sphere canopy | 20 |
| bush | 20 |
| unit box (hedge segment, fence rail, fence post) | 12 |
| building walls | 12 |
| pitched roof (closed prism) | 8 |
| flat roof (slab) | 12 |

- Fence cost per 8 m segment: post-rail 1 rail box, picket 11 boxes (a backing rail and ten slats,
  one slat about every 0.8 m), chainlink 3 wire boxes, plus one post box per segment start and one
  closing post per line (`fenceRailBoxCount`, 12 triangles each). The fence collider is still one
  solid panel per segment, so a car cannot slip between slats.
- The dense worst-case fixture (`tests/fixtures/dense-scenery.ts`; 30 hedges, 1 post-rail, 3 picket and 6 chainlink fence lines) totals **37,900** triangles in
  the sums above and in the meshes `createSceneryView` actually builds
  (`tests/scenery-view.test.ts` checks both and that the draw count stays at or under 12).
