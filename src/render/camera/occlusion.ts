/**
 * Occlusion classification and both CAM-04 mitigation curves (fade / steepen)
 * as pure functions. Imports ONLY `smoothstep01` from `./camera-math` — no
 * `three`.
 *
 * The scene-graph ray-vs-mesh query that produces the `OcclusionHit[]` input
 * deliberately lives elsewhere (plan 03-08's
 * `src/render/camera/occlusion-probe.ts`) precisely so this decision logic
 * stays Node-testable, mirroring the reason `src/physics/vehicle-assists.ts`
 * gives for its own shape: a free function with explicit parameters is
 * directly unit-testable with hand-built inputs, no scene, no engine.
 *
 * A spatial acceleration structure for that ray-vs-mesh query is explicitly
 * NOT used this phase — CLAUDE.md scopes that class of tool to real
 * city-scale geometry ("once you're querying render-only geometry" / "once
 * it doesn't scale"), and this phase has a handful of placeholder boxes,
 * well under that bar. Plain per-frame scene queries are more than fast
 * enough here.
 */
import { smoothstep01 } from "./camera-math";

/**
 * The minimal structural subset of a `THREE.Intersection` this logic needs,
 * so a test can build one by hand and the probe can map real intersections
 * onto it.
 */
export interface OcclusionHit {
  readonly distance: number;
  readonly id: number;
}

export interface OcclusionState {
  readonly occluded: boolean;
  readonly occluderIds: readonly number[];
}

/**
 * `"off"` exists so plan 03-08's debug A/B toggle can cycle through a
 * no-mitigation baseline, which is what makes the SC6 playtest a genuine
 * three-way comparison rather than a forced choice.
 */
export type OcclusionMitigation = "fade" | "steepen" | "off";

/** Clamp `v` into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Classify a set of raycast hits between the camera and its target. Keeps
 * only hits with `distance > 0` and `distance < targetDistanceM -
 * nearTargetMarginM`, sorts ascending by distance, and de-duplicates ids.
 *
 * The `- nearTargetMarginM` term guards against the car's own ground plane
 * or a kerb the ray clips just short of the car registering as a building —
 * a wheel-height kerb must not fade a whole building.
 */
export function classifyOcclusion(
  hits: readonly OcclusionHit[],
  targetDistanceM: number,
  nearTargetMarginM: number,
): OcclusionState {
  const cutoff = targetDistanceM - nearTargetMarginM;
  const seen = new Set<number>();
  const kept: OcclusionHit[] = [];
  for (const hit of hits) {
    if (hit.distance > 0 && hit.distance < cutoff) {
      kept.push(hit);
    }
  }
  kept.sort((a, b) => a.distance - b.distance);
  const occluderIds: number[] = [];
  for (const hit of kept) {
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      occluderIds.push(hit.id);
    }
  }
  return { occluded: occluderIds.length > 0, occluderIds };
}

/**
 * Mitigation (a): fade the target's material opacity down toward a low but
 * non-zero floor when occluded, and back up to `baseOpacity` when not — a
 * fully invisible target removes spatial context entirely, per
 * 03-RESEARCH.md's explicit "low but non-zero floor".
 */
export function fadeTargetOpacity(
  isOccluded: boolean,
  baseOpacity: number,
  floorOpacity: number,
): number {
  return isOccluded ? floorOpacity : baseOpacity;
}

/**
 * Fraction of a fan of occlusion-probe rays that were occluded, in [0, 1].
 * Guarded against `totalRayCount` of 0 (returns 0, not `NaN`).
 */
export function densityFrom(occludedRayCount: number, totalRayCount: number): number {
  if (totalRayCount <= 0) return 0;
  return clamp(occludedRayCount / totalRayCount, 0, 1);
}

/**
 * Mitigation (b): blend the camera's pitch from `basePitchRad` toward
 * `maxPitchRad` (near-overhead) as occlusion `density01` rises, relaxing
 * back in open areas. Uses `smoothstep01` so the transition into and out of
 * a dense cluster has no visible corner. A density outside [0,1] is clamped
 * rather than extrapolated.
 */
export function steepenPitchRad(
  basePitchRad: number,
  maxPitchRad: number,
  density01: number,
): number {
  const t = smoothstep01(clamp(density01, 0, 1));
  return basePitchRad + (maxPitchRad - basePitchRad) * t;
}

/**
 * Half-spread of the occlusion-probe's fan of rays, in radians: PI/6 (30
 * degrees each side of centre, 60 degrees total). Bounded deliberately —
 * `src/render/camera/occlusion-probe.ts`'s `occludedFanRayCount` casts each
 * ray from a camera position rotated by one of these offsets about the
 * target, and a wider fan would sample poses the rig can never actually
 * occupy, reporting a density signal that has nothing to do with what the
 * player can see (plan 03-09's own instruction).
 */
const FAN_HALF_SPREAD_RAD = Math.PI / 6;

/**
 * `count` offsets (radians) spread evenly across
 * `[-FAN_HALF_SPREAD_RAD, +FAN_HALF_SPREAD_RAD]`, symmetric about 0 and
 * sorted ascending. `count <= 1` always returns `[0]` — a fan of one
 * degenerates to the single centre ray, and a `count` of 0 must never hand
 * `densityFrom` a zero denominator (that function already guards it, but this
 * keeps the caller's array non-empty too).
 */
export function fanOffsetsRad(count: number): readonly number[] {
  if (count <= 1) {
    return [0];
  }
  const offsets: number[] = [];
  const step = (2 * FAN_HALF_SPREAD_RAD) / (count - 1);
  for (let i = 0; i < count; i++) {
    offsets.push(-FAN_HALF_SPREAD_RAD + step * i);
  }
  return offsets;
}
