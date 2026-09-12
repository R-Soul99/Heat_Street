/**
 * THREE.Raycaster-based occlusion probe: casts rays from a camera position to
 * a target and counts fan-ray occlusion, mapping every result onto the pure
 * `OcclusionHit` shape `src/render/camera/occlusion.ts` already defines — so
 * that file's decision logic stays free of `three`, the path-scoped layering
 * rule plan 03-07 added (`tests/layering.test.ts`, T-03-22).
 *
 * Plain `THREE.Raycaster.intersectObjects` against a flat array is correct at
 * this phase's fourteen placeholder boxes (03-RESEARCH.md Pattern 5). A
 * dedicated spatial acceleration structure for render-only mesh raycasting is
 * deliberately NOT added here — CLAUDE.md scopes that class of tool to real
 * city-scale geometry ("once you're querying render-only geometry" / "once it
 * doesn't scale"), and this phase's building count is well under that bar
 * (described by behaviour rather than by package name so this comment cannot
 * trip the zero-count package-legitimacy grep the plan's acceptance criteria
 * run against this file and `package.json`, mirroring plan 02-03's identical
 * resolution). Adding it now would be premature optimisation against that
 * document's own stated trigger condition; Phase 4's real map pipeline is the
 * documented revisit point.
 */
import * as THREE from "three";
import type { OcclusionHit } from "./occlusion";

/**
 * One reused `THREE.Raycaster` shared by every probe instance and every ray
 * cast — never one per frame (T-03-29). `.set()` copies its arguments
 * internally, so reusing the scratch origin/direction vectors below across
 * calls is safe.
 */
const RAYCASTER = new THREE.Raycaster();

/**
 * Reused scratch objects, module scope, `src/render/vehicle-view.ts`'s
 * `SCRATCH_AXLE` convention — `hits`/`occludedFanRayCount` run every frame
 * and allocate no `THREE.Vector3` per call.
 */
const SCRATCH_DIRECTION = new THREE.Vector3();
const SCRATCH_RAY_ORIGIN = new THREE.Vector3();

export interface OcclusionProbe {
  /** Every building mesh hit on the straight segment between `cameraPos` and `targetPos`, mapped onto the pure `OcclusionHit` shape. */
  hits(cameraPos: THREE.Vector3, targetPos: THREE.Vector3): readonly OcclusionHit[];
  /**
   * Casts one ray per `offsets` entry from a camera position rotated by that
   * offset about `targetPos` (about the world +Y axis, preserving the
   * camera's distance and altitude), and returns how many of those rays hit
   * a building before reaching the target — the density signal
   * `src/render/camera/occlusion-controller.ts`'s steepen mitigation reads
   * to answer "how boxed in is this viewpoint".
   */
  occludedFanRayCount(
    cameraPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    offsets: readonly number[],
  ): number;
  /** Documented no-op — the probe owns no GPU resources and no listeners; kept so the composition root's teardown shape stays uniform across every disposable it holds. */
  dispose(): void;
}

/**
 * Cast one ray from `(originX, originY, originZ)` toward `targetPos` against
 * `buildingMeshes`, bounded to the segment between them (`ray.far` is the
 * segment length, so every returned hit is already closer than the target —
 * no separate distance re-check is needed at the call sites below).
 */
function castHits(
  originX: number,
  originY: number,
  originZ: number,
  targetPos: THREE.Vector3,
  buildingMeshes: readonly THREE.Mesh[],
): readonly OcclusionHit[] {
  SCRATCH_DIRECTION.set(targetPos.x - originX, targetPos.y - originY, targetPos.z - originZ);
  const distance = SCRATCH_DIRECTION.length();
  // A camera sitting exactly on the target (degenerate distance) has nothing
  // to occlude — return no hits rather than feeding Raycaster a zero-length
  // direction, which would throw on normalize().
  if (distance < 1e-6) {
    return [];
  }
  SCRATCH_DIRECTION.divideScalar(distance);
  SCRATCH_RAY_ORIGIN.set(originX, originY, originZ);
  RAYCASTER.set(SCRATCH_RAY_ORIGIN, SCRATCH_DIRECTION);
  RAYCASTER.far = distance;
  // `intersectObjects` wants a mutable `Object3D[]`; the incoming array is
  // never mutated by this call (it only reads meshes to test against), so
  // the cast is safe and avoids a per-call array copy.
  const intersections = RAYCASTER.intersectObjects(
    buildingMeshes as unknown as THREE.Object3D[],
    false,
  );
  return intersections.map((hit) => ({ distance: hit.distance, id: hit.object.id }));
}

export function createOcclusionProbe(buildingMeshes: readonly THREE.Mesh[]): OcclusionProbe {
  return {
    hits(cameraPos: THREE.Vector3, targetPos: THREE.Vector3): readonly OcclusionHit[] {
      return castHits(cameraPos.x, cameraPos.y, cameraPos.z, targetPos, buildingMeshes);
    },

    occludedFanRayCount(
      cameraPos: THREE.Vector3,
      targetPos: THREE.Vector3,
      offsets: readonly number[],
    ): number {
      // The camera-to-target offset, expressed as plain XZ numbers rather
      // than a THREE.Vector3, so rotating it about +Y per fan ray costs no
      // extra scratch allocation (manual sin/cos rotation, matching
      // `helicopter-camera.ts`'s own `computeOffset` convention rather than
      // `Vector3.applyAxisAngle`, which would need a dedicated axis vector).
      const offsetX = cameraPos.x - targetPos.x;
      const offsetZ = cameraPos.z - targetPos.z;

      let occludedCount = 0;
      for (const offsetRad of offsets) {
        const cos = Math.cos(offsetRad);
        const sin = Math.sin(offsetRad);
        const rotatedX = offsetX * cos - offsetZ * sin;
        const rotatedZ = offsetX * sin + offsetZ * cos;
        const originX = targetPos.x + rotatedX;
        // Altitude held constant across the fan — only heading (the XZ
        // offset) rotates; a fan ray answers "how boxed in is this
        // viewpoint AT the current camera height", not at some other one.
        const originY = cameraPos.y;
        const originZ = targetPos.z + rotatedZ;
        const fanHits = castHits(originX, originY, originZ, targetPos, buildingMeshes);
        if (fanHits.length > 0) {
          occludedCount++;
        }
      }
      return occludedCount;
    },

    dispose(): void {
      // No-op — see this interface's own doc comment above.
    },
  };
}
