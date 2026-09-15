/**
 * Collision sidecar authoring: converts plan 04-07's `BuildingBox` list (OSM
 * building footprints already resolved to oriented-bounding-box prisms) into
 * `src/core/map-collision.ts`'s sidecar shape. DATA ONLY — no Rapier import,
 * no collider construction anywhere in this file; Rapier objects are created
 * at runtime by `src/physics/map-scene.ts` (plan 04-08), never here. The
 * compiler has no business importing a physics engine — 04-PATTERNS.md's own
 * classification of this module flags exactly this split.
 *
 * `BuildingBox.positions` bakes a prism's 8 corner vertices directly into
 * world-space (it is authored for the `.glb`, which needs real vertex
 * positions, not a parametric box) and carries no separate rotation angle.
 * This module DERIVES `center`/`halfExtents`/`rotationY` from those baked
 * corners instead of threading a second, independently-computed rotation
 * value through `BuildingBox`'s own shape — so a building's footprint
 * geometry has exactly one source of truth (the baked corners), and the
 * physics collider this sidecar describes is reconstructed to occupy exactly
 * the same rectangle the `.glb`'s building mesh already renders.
 *
 * The base corners (`positions` indices 0-3) are `geometry/building-box.ts`'s
 * `rect.corners` — four points in order AROUND the rectangle, so the edge
 * `corner[1] - corner[0]` and the edge `corner[2] - corner[1]` are exactly
 * the rectangle's two perpendicular sides. `rotationY` is derived from the
 * first edge's direction; `halfExtents.x`/`halfExtents.z` are half of each
 * edge's own length. A box is fully symmetric about its own center, so which
 * of the two perpendicular edges is called "the x axis" is an arbitrary but
 * self-consistent choice — reconstructing `center +/- halfExtents` rotated by
 * `rotationY` reproduces the exact original rectangle regardless of that
 * choice.
 *
 * Layering: pure data transform — no `node:fs`, no network, no `three`, no
 * Rapier. NOT mechanically enforced — `tests/layering.test.ts` does not scan
 * `tools/**`; this file's own discipline is the only guard.
 */
import { sampleHeightfieldBilinear } from "../../../src/core/heightfield-sample.ts";
import type { MapCollision, MapCollisionBuilding } from "../../../src/core/map-collision.ts";
import { MAP_COLLISION_VERSION } from "../../../src/core/map-collision.ts";
import type { BuildingBox } from "../geometry/building-box.ts";
import type { HeightfieldGrid } from "./heightfield.ts";

interface XZ {
  readonly x: number;
  readonly z: number;
}

/** Reads vertex `index`'s X/Z from a `BuildingBox.positions` buffer (stride 3, Y ignored here). */
function xzAt(positions: Float32Array, index: number): XZ {
  return { x: positions[index * 3], z: positions[index * 3 + 2] };
}

/**
 * Converts one `BuildingBox` into a `MapCollisionBuilding`, per this file's
 * header comment. `box.positions[1]` is base corner 0's Y (the prism's
 * ground level — every base corner shares the same Y, per `buildPrism`).
 *
 * Plan 04-11's grounding-fix follow-up: the building's TRUE ground level and
 * the off-road heightfield's own (sunk, coarse) sampled height at the same
 * XZ point can disagree by several metres — measured on the real compiled
 * area, up to 6.69m. Since the heightfield collider exists everywhere across
 * the map's bounds, INCLUDING under every building, a car driving on that
 * sunk terrain near a building sat at true ground level could pass clean
 * underneath the building's collider without ever touching it — the
 * "I can still pass through buildings, not sure if it's under or through"
 * finding. The collider's bottom is extended down to
 * `min(groundY, localHeightfieldY)` so it always reaches at least as low as
 * whatever ground the player could actually be standing on nearby, closing
 * that gap regardless of how sunk the local terrain is. `heightfield` is
 * REQUIRED (not optional) here — a building with no heightfield to sample
 * keeps its plain true-ground-level box, per the ternary below.
 */
function buildingToCollisionEntry(
  box: BuildingBox,
  heightfield: HeightfieldGrid | undefined,
): MapCollisionBuilding {
  const c0 = xzAt(box.positions, 0);
  const c1 = xzAt(box.positions, 1);
  const c2 = xzAt(box.positions, 2);
  const c3 = xzAt(box.positions, 3);
  const groundY = box.positions[1];
  const centerX = (c0.x + c1.x + c2.x + c3.x) / 4;
  const centerZ = (c0.z + c1.z + c2.z + c3.z) / 4;

  const edge01X = c1.x - c0.x;
  const edge01Z = c1.z - c0.z;
  const halfX = Math.hypot(edge01X, edge01Z) / 2;

  const edge12X = c2.x - c1.x;
  const edge12Z = c2.z - c1.z;
  const halfZ = Math.hypot(edge12X, edge12Z) / 2;

  // Unit direction of edge01, in world XZ. A local +X axis rotated by a
  // Y-axis quaternion of angle `theta` maps to world (cos(theta), -sin(theta))
  // (verified against src/physics/vehicle.ts's `rotateVec` convention — the
  // SAME quaternion convention `src/physics/map-scene.ts`'s runtime collider
  // construction uses), so recovering `theta` from a known world direction
  // (ex, ez) is `atan2(-ez, ex)`.
  const edgeLen = halfX * 2;
  const ex = edgeLen > 0 ? edge01X / edgeLen : 1;
  const ez = edgeLen > 0 ? edge01Z / edgeLen : 0;
  const rotationY = Math.atan2(-ez, ex);

  const localTerrainY =
    heightfield === undefined ? groundY : sampleHeightfieldBilinear(heightfield, centerX, centerZ);
  const bottomY = Math.min(groundY, localTerrainY);
  const topY = groundY + box.heightM;
  const halfY = (topY - bottomY) / 2;

  return {
    center: { x: centerX, y: bottomY + halfY, z: centerZ },
    halfExtents: { x: halfX, y: halfY, z: halfZ },
    rotationY,
  };
}

/**
 * Builds the collision sidecar for `areaId` from `boxes` (plan 04-07's
 * `buildingBoxes(...)` output) and `heightfield` (plan 04-10's
 * `buildHeightfield(...)` output, D-P28/D-P29). Pure function: the same
 * `boxes`/`heightfield` in produce a byte-identical `MapCollision` object out
 * — `cli.ts`'s "two consecutive compiles produce a byte-identical sidecar"
 * acceptance criterion depends on this, since both `buildingBoxes` and
 * `buildHeightfield` are themselves deterministic given the same cached
 * OSM/DEM snapshot.
 */
export function buildMapCollision(
  areaId: string,
  boxes: readonly BuildingBox[],
  heightfield: HeightfieldGrid,
): MapCollision {
  return {
    collisionVersion: MAP_COLLISION_VERSION,
    areaId,
    buildings: boxes.map((box) => buildingToCollisionEntry(box, heightfield)),
    // `Array.from` converts `HeightfieldGrid`'s internal `Float32Array` into a
    // plain JSON-serialisable array — `JSON.stringify` does not turn a
    // `Float32Array` into a JSON array (verified empirically; see
    // `MapCollisionHeightfield`'s own doc comment in `src/core/map-collision.ts`).
    heightfield: {
      rows: heightfield.rows,
      cols: heightfield.cols,
      heights: Array.from(heightfield.heights),
      originX: heightfield.originX,
      originZ: heightfield.originZ,
      scaleX: heightfield.scaleX,
      scaleZ: heightfield.scaleZ,
      sinkM: heightfield.sinkM,
    },
  };
}
