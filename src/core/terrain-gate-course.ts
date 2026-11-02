/**
 * Procedural prototype-gate course for phase 04.2 (decision D-01).
 *
 * A closed loop of four lanes (hill road, banked 180-degree bend, road
 * climbing a hillside, flat return bend) plus a 35-degree slope-cap ridge,
 * laid out EAST of feel-test (feel-test spans x -670..670; this course starts
 * at x = 700). It is generated in code so the gate does not depend on the
 * editor or the terrain file format (04.2-RESEARCH gate point 5): the same
 * grid is used by the headless harness (plan 05) and, later, by the in-game
 * human drive (plan 06).
 *
 * Smoothness (RESEARCH point 1): each lane levels a band wider than the
 * painted road (5 m half-width level, blended to the surrounding terrain over
 * the next 6 m with a smoothstep).
 *
 * Layering: pure data transform, no three/rapier/DOM.
 */

import { createTerrainGrid, type TerrainGrid } from "./terrain-grid.ts";
import { DEFAULT_MAX_BANK_DEG, MAX_SLOPE_DEG } from "./terrain-limits.ts";
import { createPaintMap, encodePaintValue, type PaintMap } from "./terrain-paint.ts";

export const GATE_ORIGIN_X = 700;
export const GATE_ORIGIN_Z = -519;
export const GATE_CELL_SIZE_M = 3;
export const GATE_COLS = 200;
export const GATE_ROWS = 346;
/** Half-width of the painted, levelled road (m). */
export const GATE_ROAD_HALF_WIDTH_M = 5;
/** Half-width of the LEVELLED band: wider than the paint so the 3 m grid vertices beside the road stay level. */
export const GATE_LEVEL_HALF_WIDTH_M = 6.5;
/** Outer edge of the blend band (m from the centreline). */
export const GATE_BLEND_OUTER_M = 12.5;
/** Spacing of the sampled lane centrelines (m). */
export const GATE_LANE_STEP_M = 1.5;

const HILL_X = 820;
const CLIMB_X = 940;
const BEND_RADIUS_M = 60;
const BEND_STRAIGHT_M = 30;
const LANE_Z_MAX = 400;
const HILLSIDE_TAN = Math.tan((20 * Math.PI) / 180);
const HILLSIDE_CAP_M = 30;

export interface GateLane {
  readonly id: "hill" | "bank" | "climb" | "return";
  /** Centreline samples [x, y, z] every GATE_LANE_STEP_M, in driving order. */
  readonly points: readonly (readonly [number, number, number])[];
}

export interface GateSpawn {
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

/** Spawn y is left to the caller (sample the terrain + clearance). */
export const GATE_SPAWNS: {
  readonly laneA: GateSpawn;
  readonly laneC: GateSpawn;
  readonly cap: GateSpawn;
} = {
  laneA: { x: HILL_X, z: -390, headingRad: Math.PI },
  laneC: { x: CLIMB_X, z: 390, headingRad: 0 },
  cap: { x: 815, z: -90, headingRad: Math.PI / 2 },
};

/** Lane A centreline height: four 8 m hills along z -400..400. */
export function gateHillHeight(z: number): number {
  if (z < -LANE_Z_MAX || z > LANE_Z_MAX) return 0;
  return 4 * (1 - Math.cos((2 * Math.PI * (z + LANE_Z_MAX)) / 200));
}

/**
 * Length (m) of every parabolic vertical curve on lane C. An 8% grade change
 * at 25 m/s over a 60 m curve is v^2 * dg / L = 0.83 m/s^2 of vertical
 * acceleration (a hard break is an impulse and launches the car). The map
 * authoring road brush needs the same treatment: roughly 2.4 s of travel at
 * the design speed per grade change (grade change x speed^2 / 60 m stays well
 * below 1 m/s^2 for 8% at 25 m/s).
 */
export const GATE_VERTICAL_CURVE_M = 60;

/** Integral of a 0 -> 1 linear ramp starting at `a` with length `len`, evaluated at `s`. */
function rampIntegral(s: number, a: number, len: number): number {
  if (s <= a) return 0;
  if (s >= a + len) return s - a - len / 2;
  const t = s - a;
  return (t * t) / (2 * len);
}

/**
 * Lane C centreline height: 8% up from z=+400, flat, 8% down to z=-400, with
 * every grade change blended by a parabolic vertical curve of
 * GATE_VERTICAL_CURVE_M (centred on the old breaks z = +-100; the end curves
 * start at z = +-400 so the lane meets flat ground with zero grade). The
 * plateau is therefore 24 - 0.04 * curve = 21.6 m.
 */
export function gateClimbHeight(z: number): number {
  if (z >= LANE_Z_MAX || z <= -LANE_Z_MAX) return 0;
  const s = LANE_Z_MAX - z; // distance along the climb direction
  const len = GATE_VERTICAL_CURVE_M;
  const half = len / 2;
  return (
    0.08 *
    (rampIntegral(s, 0, len) -
      rampIntegral(s, 300 - half, len) -
      rampIntegral(s, 500 - half, len) +
      rampIntegral(s, 800 - len, len))
  );
}

interface LaneSample {
  x: number;
  y: number;
  z: number;
  /** Outward (crossfall high side) unit normal. */
  nx: number;
  nz: number;
  /** Bank angle tangent applied across this sample (0 for unbanked). */
  bankTan: number;
  /** True where the surrounding terrain is the lane C hillside, which already meets the road edge (no blend). */
  hillside: boolean;
}

function buildLaneSamples(maxBankDeg: number): Record<GateLane["id"], LaneSample[]> {
  const bankTan = Math.tan((maxBankDeg * Math.PI) / 180);
  const step = GATE_LANE_STEP_M;

  const hill: LaneSample[] = [];
  const nHill = Math.round((2 * LANE_Z_MAX) / step);
  const zStep = (2 * LANE_Z_MAX) / nHill; // exact so the lane ends land on z = +-400
  for (let i = 0; i <= nHill; i++) {
    const z = -LANE_Z_MAX + i * zStep;
    hill.push({ x: HILL_X, y: gateHillHeight(z), z, nx: -1, nz: 0, bankTan: 0, hillside: false });
  }

  const climb: LaneSample[] = [];
  for (let i = 0; i <= nHill; i++) {
    const z = LANE_Z_MAX - i * zStep;
    climb.push({ x: CLIMB_X, y: gateClimbHeight(z), z, nx: 1, nz: 0, bankTan: 0, hillside: true });
  }

  // Banked bend: 30 m of straight on lane A's end (bank ramps in), the arc,
  // then 30 m of straight onto lane C's start (bank ramps out).
  const bank: LaneSample[] = [];
  const nStraight = Math.round(BEND_STRAIGHT_M / step);
  for (let i = 0; i < nStraight; i++) {
    const z = LANE_Z_MAX - BEND_STRAIGHT_M + i * step;
    bank.push({
      x: HILL_X,
      y: gateHillHeight(z),
      z,
      nx: -1,
      nz: 0,
      bankTan: (bankTan * i) / nStraight,
      hillside: false,
    });
  }
  const nArc = Math.round((Math.PI * BEND_RADIUS_M) / step);
  for (let i = 0; i <= nArc; i++) {
    const phi = Math.PI - (Math.PI * i) / nArc;
    bank.push({
      x: 880 + BEND_RADIUS_M * Math.cos(phi),
      y: 0,
      z: LANE_Z_MAX + BEND_RADIUS_M * Math.sin(phi),
      nx: Math.cos(phi),
      nz: Math.sin(phi),
      bankTan,
      hillside: 880 + BEND_RADIUS_M * Math.cos(phi) > 925,
    });
  }
  for (let i = 1; i <= nStraight; i++) {
    const z = LANE_Z_MAX - i * step;
    bank.push({
      x: CLIMB_X,
      y: gateClimbHeight(z),
      z,
      nx: 1,
      nz: 0,
      bankTan: (bankTan * (nStraight - i)) / nStraight,
      hillside: true,
    });
  }

  // Flat return bend: lane C's end back to lane A's start.
  const ret: LaneSample[] = [];
  for (let i = 0; i <= nArc; i++) {
    const phi = -(Math.PI * i) / nArc;
    ret.push({
      x: 880 + BEND_RADIUS_M * Math.cos(phi),
      y: 0,
      z: -LANE_Z_MAX + BEND_RADIUS_M * Math.sin(phi),
      nx: Math.cos(phi),
      nz: Math.sin(phi),
      bankTan: 0,
      hillside: 880 + BEND_RADIUS_M * Math.cos(phi) > 925,
    });
  }
  return { hill, bank, climb, return: ret };
}

function toLane(id: GateLane["id"], samples: readonly LaneSample[]): GateLane {
  return { id, points: samples.map((s) => [s.x, s.y, s.z] as const) };
}

/** Lane centrelines at the default bank (bank does not move the centreline). */
export const GATE_LANES: readonly GateLane[] = (() => {
  const s = buildLaneSamples(DEFAULT_MAX_BANK_DEG);
  return [
    toLane("hill", s.hill),
    toLane("bank", s.bank),
    toLane("climb", s.climb),
    toLane("return", s.return),
  ];
})();

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Hillside terrain beside lane C plus nothing else (ridge added separately). */
function hillsideHeight(x: number, z: number): number {
  const roadH = gateClimbHeight(z);
  if (x >= CLIMB_X + GATE_LEVEL_HALF_WIDTH_M) {
    return roadH + Math.min(HILLSIDE_CAP_M, (x - CLIMB_X - GATE_LEVEL_HALF_WIDTH_M) * HILLSIDE_TAN);
  }
  if (x <= CLIMB_X - GATE_LEVEL_HALF_WIDTH_M) {
    return Math.max(0, roadH - (CLIMB_X - GATE_LEVEL_HALF_WIDTH_M - x) * HILLSIDE_TAN);
  }
  return roadH;
}

/**
 * Rolling terrain that follows lane A's hills so the hill road does not sit on
 * an embankment: full strength across the levelled band, faded out by smoothstep
 * on both sides (43 m west, 53 m east) so no side slope exceeds ~16 degrees.
 */
function rollingHeight(x: number, z: number): number {
  const hill = gateHillHeight(z);
  if (hill === 0) return 0;
  const f =
    x <= HILL_X
      ? smoothstep((x - 770) / (HILL_X - GATE_LEVEL_HALF_WIDTH_M - 770))
      : smoothstep((880 - x) / (880 - (HILL_X + GATE_LEVEL_HALF_WIDTH_M)));
  return hill * f;
}

/** Slope-cap ridge: x 700..800, z -120..-60, side slope = maxSlopeDeg, capped at 20 m. */
function ridgeHeight(x: number, z: number, slopeTan: number): number {
  if (x < 700 || x > 800 || z < -120 || z > -60) return 0;
  const h = Math.min(800 - x, z + 120, -60 - z) * slopeTan;
  return h < 0 ? 0 : h > 20 ? 20 : h;
}

export function buildGateCourse(opts?: { maxBankDeg?: number; maxSlopeDeg?: number }): {
  grid: TerrainGrid;
  paint: PaintMap;
  lanes: readonly GateLane[];
} {
  const maxBankDeg = opts?.maxBankDeg ?? DEFAULT_MAX_BANK_DEG;
  const maxSlopeDeg = opts?.maxSlopeDeg ?? MAX_SLOPE_DEG;
  const slopeTan = Math.tan((maxSlopeDeg * Math.PI) / 180);

  const grid = createTerrainGrid({
    rows: GATE_ROWS,
    cols: GATE_COLS,
    cellSizeM: GATE_CELL_SIZE_M,
    originX: GATE_ORIGIN_X,
    originZ: GATE_ORIGIN_Z,
  });
  const stride = GATE_ROWS + 1;
  const nVert = (GATE_ROWS + 1) * (GATE_COLS + 1);

  // Base terrain: hillside + ridge.
  const base = new Float32Array(nVert);
  for (let c = 0; c <= GATE_COLS; c++) {
    const x = GATE_ORIGIN_X + c * GATE_CELL_SIZE_M;
    for (let r = 0; r <= GATE_ROWS; r++) {
      const z = GATE_ORIGIN_Z + r * GATE_CELL_SIZE_M;
      base[r + c * stride] =
        hillsideHeight(x, z) + Math.max(ridgeHeight(x, z, slopeTan), rollingHeight(x, z));
    }
  }

  const samples = buildLaneSamples(maxBankDeg);
  // Order matters: ties go to the later lane, so the banked bend overrides the
  // plain lane ends it overlaps.
  const order: GateLane["id"][] = ["hill", "climb", "return", "bank"];
  const bestDist = new Float32Array(nVert).fill(Number.POSITIVE_INFINITY);
  const laneH = new Float32Array(nVert);
  const noBlend = new Uint8Array(nVert);

  const paint = createPaintMap({
    originX: GATE_ORIGIN_X,
    originZ: GATE_ORIGIN_Z,
    widthM: GATE_COLS * GATE_CELL_SIZE_M,
    depthM: GATE_ROWS * GATE_CELL_SIZE_M,
    metresPerPixel: 0.5,
    fill: "grass",
  });
  const roadValue = encodePaintValue("tarmac", true);

  for (const id of order) {
    const pts = samples[id];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const sx = b.x - a.x;
      const sz = b.z - a.z;
      const len2 = sx * sx + sz * sz;
      const minX = Math.min(a.x, b.x) - GATE_BLEND_OUTER_M;
      const maxX = Math.max(a.x, b.x) + GATE_BLEND_OUTER_M;
      const minZ = Math.min(a.z, b.z) - GATE_BLEND_OUTER_M;
      const maxZ = Math.max(a.z, b.z) + GATE_BLEND_OUTER_M;
      const c0 = Math.max(0, Math.ceil((minX - GATE_ORIGIN_X) / GATE_CELL_SIZE_M));
      const c1 = Math.min(GATE_COLS, Math.floor((maxX - GATE_ORIGIN_X) / GATE_CELL_SIZE_M));
      const r0 = Math.max(0, Math.ceil((minZ - GATE_ORIGIN_Z) / GATE_CELL_SIZE_M));
      const r1 = Math.min(GATE_ROWS, Math.floor((maxZ - GATE_ORIGIN_Z) / GATE_CELL_SIZE_M));
      for (let c = c0; c <= c1; c++) {
        const x = GATE_ORIGIN_X + c * GATE_CELL_SIZE_M;
        for (let r = r0; r <= r1; r++) {
          const z = GATE_ORIGIN_Z + r * GATE_CELL_SIZE_M;
          let t = len2 > 0 ? ((x - a.x) * sx + (z - a.z) * sz) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = a.x + sx * t;
          const cz = a.z + sz * t;
          const dist = Math.hypot(x - cx, z - cz);
          const idx = r + c * stride;
          if (dist > GATE_BLEND_OUTER_M || dist > bestDist[idx]) continue;
          bestDist[idx] = dist;
          noBlend[idx] = a.hillside ? 1 : 0;
          let nx = a.nx + (b.nx - a.nx) * t;
          let nz = a.nz + (b.nz - a.nz) * t;
          const nl = Math.hypot(nx, nz) || 1;
          nx /= nl;
          nz /= nl;
          const d = (x - cx) * nx + (z - cz) * nz;
          const dc =
            d < -GATE_LEVEL_HALF_WIDTH_M
              ? -GATE_LEVEL_HALF_WIDTH_M
              : d > GATE_LEVEL_HALF_WIDTH_M
                ? GATE_LEVEL_HALF_WIDTH_M
                : d;
          laneH[idx] = a.y + (b.y - a.y) * t + dc * (a.bankTan + (b.bankTan - a.bankTan) * t);
        }
      }
      // Paint: stamp a disc of the road half-width around the segment start
      // (and the final point below).
      stampRoad(paint, a.x, a.z, roadValue);
    }
    const last = pts[pts.length - 1];
    stampRoad(paint, last.x, last.z, roadValue);
  }

  for (let i = 0; i < nVert; i++) {
    const d = bestDist[i];
    if (d === Number.POSITIVE_INFINITY) {
      grid.heights[i] = base[i];
    } else if (d <= GATE_LEVEL_HALF_WIDTH_M) {
      grid.heights[i] = laneH[i];
    } else if (noBlend[i] === 1) {
      grid.heights[i] = base[i];
    } else {
      const w = smoothstep(
        (d - GATE_LEVEL_HALF_WIDTH_M) / (GATE_BLEND_OUTER_M - GATE_LEVEL_HALF_WIDTH_M),
      );
      grid.heights[i] = laneH[i] * (1 - w) + base[i] * w;
    }
  }

  return {
    grid,
    paint,
    lanes: [
      toLane("hill", samples.hill),
      toLane("bank", samples.bank),
      toLane("climb", samples.climb),
      toLane("return", samples.return),
    ],
  };
}

function stampRoad(paint: PaintMap, x: number, z: number, value: number): void {
  const mpp = paint.metresPerPixel;
  const r = GATE_ROAD_HALF_WIDTH_M;
  const px0 = Math.max(0, Math.floor((x - r - paint.originX) / mpp));
  const px1 = Math.min(paint.width - 1, Math.ceil((x + r - paint.originX) / mpp));
  const pz0 = Math.max(0, Math.floor((z - r - paint.originZ) / mpp));
  const pz1 = Math.min(paint.height - 1, Math.ceil((z + r - paint.originZ) / mpp));
  const r2 = r * r;
  for (let pz = pz0; pz <= pz1; pz++) {
    const wz = paint.originZ + (pz + 0.5) * mpp;
    for (let px = px0; px <= px1; px++) {
      const wx = paint.originX + (px + 0.5) * mpp;
      const dx = wx - x;
      const dz = wz - z;
      if (dx * dx + dz * dz <= r2) paint.data[pz * paint.width + px] = value;
    }
  }
}
