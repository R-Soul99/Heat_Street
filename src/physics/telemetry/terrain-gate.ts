/**
 * Headless drive harness for the D-01 prototype gate (plan 04.2-05).
 *
 * Drives a pure-pursuit lane follower around the procedural gate course (or a
 * flat-terrain baseline lane) in a throwaway Rapier world at the fixed 1/60
 * step and reports smoothness metrics. Every run owns its own `createWorld()`
 * and frees it in `finally` (T-02-06 precedent); callers pass `defaultTuning()`
 * -- no browser-saved tuning can leak into this path (Pitfall 8).
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three`, touch the DOM, or read a wall clock.
 */
import type * as RAPIER from "@dimforge/rapier3d";
import type { InputFrame } from "../../core/input-tape";
import { defaultSurfaceProfiles } from "../../core/surface-tuning";
import { buildGateCourse, type GateLane } from "../../core/terrain-gate-course";
import {
  type GateLaneMetrics,
  highPassRms,
  maxTickDropRatio,
} from "../../core/terrain-gate-metrics";
import type { TerrainGrid } from "../../core/terrain-grid";
import {
  createTerrainGrid,
  sampleTerrainHeight,
  upsampleTerrainGrid,
} from "../../core/terrain-grid";
import { createPaintMap, type PaintMap } from "../../core/terrain-paint";
import type { VehicleTuning } from "../../core/vehicle-tuning";
import { createSurfaceMap, type SurfaceContext } from "../surface";
import { buildTerrainCollider } from "../terrain-scene";
import { createVehicle, sampleVehicle } from "../vehicle";
import { createWorld } from "../world";
import { ROUTINES } from "./routines";
import { runRoutine } from "./run";

export type { GateLaneMetrics } from "../../core/terrain-gate-metrics";

/** Ticks discarded from the start of every run (standing-start transient). */
const WARMUP_TICKS = 180;
const MAX_TICKS = 3600;
const LOOKAHEAD_M = 12;
const SPAWN_CLEARANCE_M = 0.6;

/** One post-warm-up tick with fewer than four wheels in contact (opt-in diagnostics). */
export interface ContactLossDiag {
  laneId: string;
  tick: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  /** Indices of wheels not touching the ground this tick. */
  wheelsOff: number[];
  suspensionLengths: number[];
  steer: number;
  throttle: number;
  brake: number;
  rearSideFriction?: number;
}

type LanePoints = readonly (readonly [number, number, number])[];

let cachedCourse: ReturnType<typeof buildGateCourse> | null = null;
function gateCourse(): ReturnType<typeof buildGateCourse> {
  if (cachedCourse === null) cachedCourse = buildGateCourse();
  return cachedCourse;
}

/** Flat terrain: 400x400 cells at 3 m centred on the origin, all heights 0. */
function flatGrid(): TerrainGrid {
  return createTerrainGrid({ rows: 400, cols: 400, cellSizeM: 3, originX: -600, originZ: -600 });
}

function flatPaint(): PaintMap {
  return createPaintMap({
    originX: -600,
    originZ: -600,
    widthM: 1200,
    depthM: 1200,
    metresPerPixel: 4,
    fill: "tarmac",
    road: true,
  });
}

/** Straight baseline lane along -Z on the flat terrain (x = 0, z +350 .. -350). */
const FLAT_LANE: LanePoints = (() => {
  const out: [number, number, number][] = [];
  for (let z = 350; z >= -350; z -= 1.5) out.push([0, 0, z]);
  return out;
})();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function runLanePoints(
  laneId: string,
  points: LanePoints,
  grid: TerrainGrid,
  paint: PaintMap,
  speedMs: number,
  direction: 1 | -1,
  tuning: VehicleTuning,
  colliderSubdiv: 1 | 2,
  onContactLoss?: (d: ContactLossDiag) => void,
): GateLaneMetrics {
  const pts = direction === 1 ? points : [...points].reverse();
  const n = pts.length;
  const world = createWorld();
  try {
    const colliderGrid = colliderSubdiv === 2 ? upsampleTerrainGrid(grid, 2) : grid;
    const { collider, paint: lookup } = buildTerrainCollider(world, colliderGrid, paint, "grass");
    const map = createSurfaceMap();
    map.register(collider.handle, "grass");
    const surfaces: SurfaceContext = { map, profiles: defaultSurfaceProfiles(), paint: lookup };

    const [sx, , sz] = pts[0];
    const [nx, , nz] = pts[Math.min(1, n - 1)];
    const headingRad = Math.atan2(-(nx - sx), -(nz - sz));
    const sy = sampleTerrainHeight(colliderGrid, sx, sz) + SPAWN_CLEARANCE_M;
    const vehicle = createVehicle(world, tuning, { x: sx, y: sy, z: sz });
    vehicle.resetPose({ x: sx, y: sy, z: sz, headingRad });

    // Spacing is ~1.5 m; 8 points ~ 12 m lookahead.
    const ahead = Math.max(1, Math.round(LOOKAHEAD_M / 1.5));
    let idx = 0;

    const cap = MAX_TICKS - WARMUP_TICKS;
    const vy = new Float64Array(cap);
    const susp = [
      new Float64Array(cap),
      new Float64Array(cap),
      new Float64Array(cap),
      new Float64Array(cap),
    ];
    const spd = new Float64Array(cap);
    let recorded = 0;
    let contactLoss = 0;

    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const s = sampleVehicle(vehicle);
      const px = s.position.x;
      const pz = s.position.z;
      while (idx < n - 1) {
        const a = (px - pts[idx][0]) ** 2 + (pz - pts[idx][2]) ** 2;
        const b = (px - pts[idx + 1][0]) ** 2 + (pz - pts[idx + 1][2]) ** 2;
        if (b < a) idx++;
        else break;
      }
      if (idx >= n - 2) break;
      const target = pts[Math.min(n - 1, idx + ahead)];

      // Chassis forward = rotate local -Z by the quaternion; right = (-fz, fx).
      const q = s.rotation;
      const fx = -2 * (q.x * q.z + q.w * q.y);
      const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
      const fl = Math.hypot(fx, fz) || 1;
      const ffx = fx / fl;
      const ffz = fz / fl;
      const dx = target[0] - px;
      const dz = target[2] - pz;
      const angle = Math.atan2(dx * -ffz + dz * ffx, dx * ffx + dz * ffz);
      const v = s.forwardSpeedMs;
      const braking = v > speedMs + 2;
      const frame: InputFrame = {
        steer: clamp(2.0 * angle, -1, 1),
        throttle: braking ? 0 : clamp(0.3 + 0.15 * (speedMs - v), 0, 1),
        brake: braking ? 0.3 : 0,
        handbrake: false,
      };
      vehicle.tick(frame, tuning, surfaces);
      world.step();

      if (tick >= WARMUP_TICKS) {
        const after = sampleVehicle(vehicle);
        vy[recorded] = after.linvel.y;
        for (let w = 0; w < 4; w++)
          susp[w][recorded] = vehicle.controller.wheelSuspensionLength(w) ?? 0;
        spd[recorded] = after.forwardSpeedMs;
        if (after.contacts < 4) {
          contactLoss++;
          if (onContactLoss !== undefined) {
            const wheelsOff: number[] = [];
            const suspensionLengths: number[] = [];
            for (let w = 0; w < 4; w++) {
              if (!vehicle.controller.wheelIsInContact(w)) wheelsOff.push(w);
              suspensionLengths.push(vehicle.controller.wheelSuspensionLength(w) ?? 0);
            }
            onContactLoss({
              laneId,
              tick,
              x: after.position.x,
              y: after.position.y,
              z: after.position.z,
              vy: after.linvel.y,
              wheelsOff,
              suspensionLengths,
              steer: frame.steer,
              throttle: frame.throttle,
              brake: frame.brake,
              rearSideFriction: vehicle.rearGrip.sideFriction,
            });
          }
        }
        recorded++;
      }
    }

    const vySeries = vy.subarray(0, recorded);
    const spdSeries = spd.subarray(0, recorded);
    let suspJitter = 0;
    for (let w = 0; w < 4; w++) {
      suspJitter = Math.max(suspJitter, highPassRms(susp[w].subarray(0, recorded), 15));
    }
    return {
      laneId,
      speedMs,
      direction,
      colliderSubdiv,
      verticalJitterMs: highPassRms(vySeries, 15),
      suspensionJitterM: suspJitter,
      contactLossTicks: contactLoss,
      speedJitterMs: highPassRms(spdSeries, 30),
      maxTickDrop: maxTickDropRatio(spdSeries, speedMs),
      ticks: recorded,
    };
  } finally {
    world.free();
  }
}

/** Drive one gate lane (hill / bank / climb) and measure it. */
export function runGateLane(
  lane: GateLane,
  speedMs: number,
  direction: 1 | -1,
  tuning: VehicleTuning,
  opts: { colliderSubdiv: 1 | 2; onContactLoss?: (d: ContactLossDiag) => void },
): GateLaneMetrics {
  const { grid, paint } = gateCourse();
  return runLanePoints(
    lane.id,
    lane.points,
    grid,
    paint,
    speedMs,
    direction,
    tuning,
    opts.colliderSubdiv,
    opts.onContactLoss,
  );
}

/** The gate course's own lanes (same object the harness drives). */
export function gateCourseLanes(): readonly GateLane[] {
  return gateCourse().lanes;
}

/** Flat straight lane on a flat terrain heightfield: the D-01 live baseline. */
export function runFlatBaseline(speedMs: number, tuning: VehicleTuning): GateLaneMetrics {
  return runLanePoints("flat", FLAT_LANE, flatGrid(), flatPaint(), speedMs, 1, tuning, 1);
}

/**
 * Every telemetry routine on the legacy cuboid ground and on a flat terrain
 * heightfield; the two must agree within 1% (RESEARCH "flat regression").
 */
export function runFlatRegression(
  tuning: VehicleTuning,
): { id: string; legacy: number; terrain: number }[] {
  const grid = flatGrid();
  const paint = flatPaint();
  const builder = (world: RAPIER.World): RAPIER.Collider =>
    buildTerrainCollider(world, grid, paint, "tarmac").collider;
  return ROUTINES.map((routine) => ({
    id: routine.id,
    legacy: runRoutine(routine, tuning).value,
    terrain: runRoutine(routine, tuning, undefined, builder).value,
  }));
}
