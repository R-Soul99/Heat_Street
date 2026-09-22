/**
 * Pure racing-line builder (plan 07-01, D-11): a deterministic, frozen
 * closed-loop polyline over a circuit course's own road-graph path, smoothed
 * within the carriageway width, curvature-profiled for target speed, and
 * scaled to a fixed compile-time Silver-pace calibration constant.
 *
 * This is the load-bearing risk item in CIRC-02: whether a pure-pursuit
 * driver (`src/core/ai-driver.ts`) can lap the real Juliette circuit cleanly
 * at Silver pace against this exact line. `tests/ai-lap.test.ts` is the
 * headless end-to-end proof.
 *
 * Pure by construction: imports only `./navigation`, `./course`,
 * `./road-graph`, `./surface-tuning`, `./surface-types`, `./medal-timing`,
 * `./heading` — no renderer, no physics engine, no DOM, no wall clock, no
 * `Math.random`/`Date.now`. `tests/layering.test.ts` mechanically enforces
 * this for every file under `src/core/`, and this plan's own source-guard
 * test additionally forbids any reference to player/placement/race-standing
 * state (D-09/CIRC-02: this line and its pace are a single fixed compile-time
 * artifact, never derived from any racer's live state).
 */
import type { Course, CourseCheckpoint } from "./course";
import { yawFromTravelDirection } from "./heading";
import { MEDAL_BANDS } from "./medal-timing";
import {
  DEFECT_CLEARANCE_M,
  DEFECT_COORDINATES,
  findRoadPath,
  type NavigationGraph,
} from "./navigation";
import type { RoadGraphEdge } from "./road-graph";
import type { SurfaceProfiles } from "./surface-tuning";
import type { SurfaceType } from "./surface-types";

/** One densely-sampled point on the racing line. */
export interface RacingLinePoint {
  /** Smoothed, apex-cutting position — what the AI actually drives toward. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The true road centreline sample this point was resampled from — the clamp reference `x`/`z` never stray past `halfWidthM - edgeMarginM` of. */
  readonly centreX: number;
  readonly centreZ: number;
  /** Half the carriageway width at this arc position, metres (`edge.widthM / 2`). */
  readonly halfWidthM: number;
  readonly surface: SurfaceType;
  /** Cumulative arc length from `points[0]`, metres. Strictly increasing along the array. */
  readonly arcM: number;
  /** Signed curvature (1/radius), from `curvatureFromThreePoints` over the smoothed line. */
  readonly curvature: number;
  /** Final, pace-scaled target speed at this point, m/s. */
  readonly targetSpeedMs: number;
}

/** A deterministic, frozen closed-loop racing line for one circuit course. */
export interface RacingLine {
  readonly courseId: string;
  readonly points: readonly RacingLinePoint[];
  /** Total loop length, metres — `points[points.length - 1]` wraps back to `points[0]` over this remaining arc. */
  readonly lapLengthM: number;
  /** Per-checkpoint cumulative arc at which each `course.checkpoints[i]` is reached, strictly increasing; the last entry equals `lapLengthM` exactly. */
  readonly checkpointArcM: readonly number[];
}

export interface RacingLineParams {
  readonly spacingM: number;
  readonly smoothingWindow: number;
  readonly smoothingPasses: number;
  readonly edgeMarginM: number;
  readonly curvatureChordPoints: number;
  readonly aLatMaxMs2: number;
  readonly aBrakeMs2: number;
  readonly aAccelMs2: number;
  readonly topSpeedMs: number;
  readonly paceScale: number;
}

/**
 * FIXED compile-time calibration of the whole speed profile to Silver pace
 * (D-09/CIRC-02). Never varied at runtime, never derived from any racer's
 * state — the entire point of a fixed-difficulty AI is that this is a single
 * constant chosen once (Task 3's calibration step) and baked into the
 * shipped build, not a live knob. Starts at 1.0; Task 3 measures the
 * uncalibrated lap time against `silverLapTargetSec` and adjusts this one
 * number until the headless lap lands within +/-6% of Silver pace.
 */
export const AI_PACE_CALIBRATION = 1.0;

export const DEFAULT_RACING_LINE_PARAMS: RacingLineParams = Object.freeze({
  spacingM: 2,
  smoothingWindow: 6,
  smoothingPasses: 4,
  edgeMarginM: 1.25,
  curvatureChordPoints: 3,
  aLatMaxMs2: 7.0,
  aBrakeMs2: 6.0,
  aAccelMs2: 3.0,
  topSpeedMs: 45,
  paceScale: AI_PACE_CALIBRATION,
});

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Standard circumradius-from-3-points curvature formula: `k = 4*Area / (|AB|*|BC|*|CA|)`. */
export function curvatureFromThreePoints(
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
  c: { readonly x: number; readonly z: number },
): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) return 0;
  return (4 * area) / (ab * bc * ca);
}

/** `v = sqrt(aLatMaxMs2 / curvature)`, clamped to `topSpeedMs`, per RESEARCH.md's curvature-derived speed profile. */
export function targetSpeedAtCurvature(
  curvature: number,
  aLat: number,
  topSpeedMs: number,
): number {
  if (curvature < 1e-6) return topSpeedMs;
  return Math.min(topSpeedMs, Math.sqrt(aLat / curvature));
}

/** `totalTimeSec * MEDAL_BANDS.silver / laps` — the reference-split-anchored Silver per-lap target (D-09). */
export function silverLapTargetSec(reference: {
  readonly totalTimeSec: number;
  readonly laps: number;
}): number {
  return (reference.totalTimeSec * MEDAL_BANDS.silver) / reference.laps;
}

interface RawPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly halfWidthM: number;
  readonly surface: SurfaceType;
}

function samePoint(
  a: RawPoint | undefined,
  b: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  if (a === undefined) return false;
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
}

interface RawLeg {
  readonly checkpointIndex: number;
  /** Raw cumulative arc length (in the pre-resampled polyline) at this leg's end. */
  readonly endArcM: number;
}

/** Builds the raw, dense (un-resampled) closed-loop centreline for the whole lap, per D-11's leg ordering. */
function buildRawPolyline(
  course: Course,
  navigation: NavigationGraph,
): { readonly raw: readonly RawPoint[]; readonly legs: readonly RawLeg[] } {
  const checkpoints = course.checkpoints;
  const raw: RawPoint[] = [];
  const legs: RawLeg[] = [];
  let cumulativeArc = 0;

  for (let legIndex = 0; legIndex < checkpoints.length; legIndex++) {
    const fromNodeId =
      legIndex === 0
        ? checkpoints[checkpoints.length - 1].nodeId
        : checkpoints[legIndex - 1].nodeId;
    const toNodeId = checkpoints[legIndex].nodeId;
    const path = findRoadPath(navigation, fromNodeId, toNodeId);
    if (path.length < 2) {
      throw new Error(
        `buildRacingLine: ${course.id}: no routable path for leg ${legIndex} (node ${fromNodeId} -> node ${toNodeId})`,
      );
    }
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const link = navigation.graph.getLink(a, b);
      if (link === undefined) {
        throw new Error(
          `buildRacingLine: ${course.id}: no graph link ${a} -> ${b} on leg ${legIndex}`,
        );
      }
      const edge: RoadGraphEdge | undefined = navigation.edgesById.get(link.data.edgeId);
      if (edge === undefined) {
        throw new Error(
          `buildRacingLine: ${course.id}: unknown edge id ${link.data.edgeId} on leg ${legIndex}`,
        );
      }
      const orderedPoints = edge.from === a ? edge.points : [...edge.points].reverse();
      const halfWidthM = edge.widthM / 2;
      for (const p of orderedPoints) {
        const candidate: RawPoint = {
          x: p[0],
          y: p[1],
          z: p[2],
          halfWidthM,
          surface: edge.surface,
        };
        const previous = raw[raw.length - 1];
        if (samePoint(previous, candidate)) continue;
        if (raw.length > 0) {
          cumulativeArc += Math.hypot(candidate.x - previous.x, candidate.z - previous.z);
        }
        raw.push(candidate);
      }
    }
    legs.push({ checkpointIndex: legIndex, endArcM: cumulativeArc });
  }

  // The final leg returns to the FIRST leg's starting node (D-11: the loop is
  // closed), so its last raw point duplicates raw[0]. Drop it so `raw` is an
  // implicit closed loop (index after the last one wraps to 0) with no
  // duplicate boundary point, and record the true total raw loop length
  // (the arc length INCLUDING the now-dropped closing point) as the final
  // leg's own endArcM — this is what makes `checkpointArcM`'s last entry
  // exactly the loop length rather than the arc of a near-duplicate point.
  const last = raw[raw.length - 1];
  const first = raw[0];
  let totalRawLength = cumulativeArc;
  if (samePoint(last, first)) {
    raw.pop();
  } else {
    totalRawLength += Math.hypot(last.x - first.x, last.z - first.z);
  }
  legs[legs.length - 1] = { ...legs[legs.length - 1], endArcM: totalRawLength };

  return { raw, legs };
}

interface ResampledPoint extends RawPoint {
  readonly arcM: number;
}

/** Resamples a closed-loop raw polyline to uniform `spacingM` arc spacing (linear interpolation, y included). */
function resampleClosedLoop(
  raw: readonly RawPoint[],
  spacingM: number,
): { readonly points: readonly ResampledPoint[]; readonly totalLengthM: number } {
  const n = raw.length;
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    segLengths.push(len);
    total += len;
  }

  const points: ResampledPoint[] = [];
  let segIndex = 0;
  let segStartArc = 0;
  for (let s = 0; s < total; s += spacingM) {
    while (segIndex < n - 1 && segStartArc + segLengths[segIndex] <= s) {
      segStartArc += segLengths[segIndex];
      segIndex++;
    }
    const a = raw[segIndex];
    const b = raw[(segIndex + 1) % n];
    const segLen = segLengths[segIndex];
    const t = segLen < 1e-9 ? 0 : (s - segStartArc) / segLen;
    points.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      halfWidthM: a.halfWidthM + (b.halfWidthM - a.halfWidthM) * t,
      surface: a.surface,
      arcM: s,
    });
  }
  return { points, totalLengthM: total };
}

function nearestDefectDistance(x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [dx, dz] of DEFECT_COORDINATES) {
    const d = Math.hypot(x - dx, z - dz);
    if (d < best) best = d;
  }
  return best;
}

/** Closed-loop, edge-clamped, defect-clear smoothing pass count applied to a copy of the resampled centreline's XZ positions. */
function smoothWithinCarriageway(
  resampled: readonly ResampledPoint[],
  params: RacingLineParams,
): { readonly x: number; readonly z: number }[] {
  const n = resampled.length;
  let smoothX = resampled.map((p) => p.x);
  let smoothZ = resampled.map((p) => p.z);

  function clampPass(x: number[], z: number[]): void {
    for (let i = 0; i < n; i++) {
      const centreX = resampled[i].x;
      const centreZ = resampled[i].z;
      const maxOffset = Math.max(0, resampled[i].halfWidthM - params.edgeMarginM);
      const offX = x[i] - centreX;
      const offZ = z[i] - centreZ;
      const offLen = Math.hypot(offX, offZ);
      if (offLen > maxOffset) {
        const scale = maxOffset / offLen;
        x[i] = centreX + offX * scale;
        z[i] = centreZ + offZ * scale;
      }
      if (nearestDefectDistance(centreX, centreZ) < DEFECT_CLEARANCE_M) {
        x[i] = centreX;
        z[i] = centreZ;
      }
    }
  }

  // First clamp pass over the raw resampled positions themselves (a no-op
  // for width since offset is 0, but establishes the defect-clear invariant
  // even if smoothingPasses is ever configured to 0).
  clampPass(smoothX, smoothZ);

  for (let pass = 0; pass < params.smoothingPasses; pass++) {
    const nextX = new Array<number>(n);
    const nextZ = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sumX = 0;
      let sumZ = 0;
      let count = 0;
      for (let w = -params.smoothingWindow; w <= params.smoothingWindow; w++) {
        const idx = wrapIndex(i + w, n);
        sumX += smoothX[idx];
        sumZ += smoothZ[idx];
        count++;
      }
      nextX[i] = sumX / count;
      nextZ[i] = sumZ / count;
    }
    clampPass(nextX, nextZ);
    smoothX = nextX;
    smoothZ = nextZ;
  }

  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: smoothX[i], z: smoothZ[i] });
  return out;
}

function findCheckpointArc(
  checkpoint: CourseCheckpoint,
  points: readonly RacingLinePoint[],
  searchCenterArc: number,
  spacingM: number,
  windowPoints: number,
): number {
  const n = points.length;
  const centerIndex = wrapIndex(Math.round(searchCenterArc / spacingM), n);
  let bestIndex = centerIndex;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let w = -windowPoints; w <= windowPoints; w++) {
    const idx = wrapIndex(centerIndex + w, n);
    const p = points[idx];
    const d = Math.hypot(p.centreX - checkpoint.position[0], p.centreZ - checkpoint.position[2]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = idx;
    }
  }
  return points[bestIndex].arcM;
}

/**
 * Builds a deterministic, frozen `RacingLine` for `course` (must be a
 * `mode: "circuit"` course). See this file's own doc comment for the full
 * pipeline (path -> resample -> smooth/clamp -> curvature -> speed profile
 * -> pace scale).
 */
export function buildRacingLine(
  course: Course,
  navigation: NavigationGraph,
  surfaceProfiles: SurfaceProfiles,
  params: RacingLineParams = DEFAULT_RACING_LINE_PARAMS,
): RacingLine {
  if (course.mode !== "circuit") {
    throw new Error(
      `buildRacingLine: ${course.id}: course.mode must be "circuit", got "${course.mode}"`,
    );
  }
  if (course.checkpoints.length === 0) {
    throw new Error(`buildRacingLine: ${course.id}: course has no checkpoints`);
  }

  const { raw, legs } = buildRawPolyline(course, navigation);
  const { points: resampled } = resampleClosedLoop(raw, params.spacingM);
  const n = resampled.length;
  const smoothed = smoothWithinCarriageway(resampled, params);

  // Recompute arc along the SMOOTHED line (may differ slightly from the raw
  // total length since smoothing/clamping moves points).
  const arcM: number[] = new Array(n);
  arcM[0] = 0;
  for (let i = 1; i < n; i++) {
    arcM[i] =
      arcM[i - 1] +
      Math.hypot(smoothed[i].x - smoothed[i - 1].x, smoothed[i].z - smoothed[i - 1].z);
  }
  const lapLengthM =
    arcM[n - 1] + Math.hypot(smoothed[0].x - smoothed[n - 1].x, smoothed[0].z - smoothed[n - 1].z);

  const points: RacingLinePoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = resampled[i];
    const s = smoothed[i];
    points[i] = Object.freeze({
      x: s.x,
      y: r.y,
      z: s.z,
      centreX: r.x,
      centreZ: r.z,
      halfWidthM: r.halfWidthM,
      surface: r.surface,
      arcM: arcM[i],
      curvature: 0,
      targetSpeedMs: 0,
    });
  }

  // Curvature per point, wrapping chord of `curvatureChordPoints`.
  const curvature: number[] = new Array(n);
  const c = params.curvatureChordPoints;
  for (let i = 0; i < n; i++) {
    const a = points[wrapIndex(i - c, n)];
    const b = points[i];
    const cc = points[wrapIndex(i + c, n)];
    curvature[i] = curvatureFromThreePoints(a, b, cc);
  }

  // Curvature-derived speed profile (already clamped to topSpeedMs per point).
  const speed: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const grip = surfaceProfiles[points[i].surface].lateralGrip;
    speed[i] = targetSpeedAtCurvature(curvature[i], params.aLatMaxMs2 * grip, params.topSpeedMs);
  }

  // Braking-feasibility: two backward passes (walking against travel
  // direction), each only REDUCING a point's speed to what braking from the
  // NEXT point's speed allows.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = (i + 1) % n;
      const ds = i === n - 1 ? lapLengthM - arcM[i] : arcM[next] - arcM[i];
      const bound = Math.sqrt(speed[next] * speed[next] + 2 * params.aBrakeMs2 * ds);
      if (speed[i] > bound) speed[i] = bound;
    }
  }
  // Two forward passes: only REDUCING the next point's speed to what
  // accelerating from THIS point's speed allows.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const ds = i === n - 1 ? lapLengthM - arcM[i] : arcM[next] - arcM[i];
      const bound = Math.sqrt(speed[i] * speed[i] + 2 * params.aAccelMs2 * ds);
      if (speed[next] > bound) speed[next] = bound;
    }
  }

  const topCapped = params.topSpeedMs * params.paceScale;
  for (let i = 0; i < n; i++) {
    const scaled = speed[i] * params.paceScale;
    const capped = Math.min(topCapped, scaled);
    const floored = Math.max(3, capped);
    points[i] = Object.freeze({ ...points[i], curvature: curvature[i], targetSpeedMs: floored });
  }

  // Per-checkpoint arc: the last checkpoint (the lap origin/closing node) is
  // set EXACTLY to lapLengthM by construction, never searched — a nearest-
  // point search would find something close to arc 0 (the same location),
  // not the loop-closing arc D-11/the plan's own acceptance requires.
  const checkpointArcM: number[] = new Array(course.checkpoints.length);
  const searchWindow = Math.max(3, params.smoothingWindow);
  for (let i = 0; i < course.checkpoints.length; i++) {
    if (i === course.checkpoints.length - 1) {
      checkpointArcM[i] = lapLengthM;
      continue;
    }
    checkpointArcM[i] = findCheckpointArc(
      course.checkpoints[i],
      points,
      legs[i].endArcM,
      params.spacingM,
      searchWindow,
    );
  }

  return Object.freeze({
    courseId: course.id,
    points: Object.freeze(points),
    lapLengthM,
    checkpointArcM: Object.freeze(checkpointArcM),
  });
}

/**
 * Finds the index of the racing-line point nearest `(x, z)`. With
 * `hintIndex === null`, searches the whole line (used once per driver
 * lifetime, on the first tick). With a hint, searches only
 * `hintIndex +/- windowPoints` (wrapping) — bounded per-tick cost (T-07-03).
 */
export function nearestLineIndex(
  line: RacingLine,
  x: number,
  z: number,
  hintIndex: number | null,
  windowPoints: number,
): number {
  const n = line.points.length;
  if (hintIndex === null) {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(line.points[i].x - x, line.points[i].z - z);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }
  let best = wrapIndex(hintIndex, n);
  let bestDist = Number.POSITIVE_INFINITY;
  for (let w = -windowPoints; w <= windowPoints; w++) {
    const idx = wrapIndex(hintIndex + w, n);
    const d = Math.hypot(line.points[idx].x - x, line.points[idx].z - z);
    if (d < bestDist) {
      bestDist = d;
      best = idx;
    }
  }
  return best;
}

/** Index of the first point at least `distanceM` of arc ahead of `index`, wrapping at `lapLengthM`. */
export function pointAhead(line: RacingLine, index: number, distanceM: number): number {
  const n = line.points.length;
  const base = line.points[wrapIndex(index, n)].arcM;
  let targetArc = base + distanceM;
  if (targetArc >= line.lapLengthM) targetArc -= line.lapLengthM;
  if (targetArc < 0) targetArc += line.lapLengthM;

  // arcM is strictly increasing across the array (0 .. lapLengthM); a linear
  // scan from the wrapped starting index is bounded by n and simple to
  // reason about (n is on the order of ~1000 for this circuit).
  for (let i = 0; i < n; i++) {
    if (line.points[i].arcM >= targetArc) return i;
  }
  return 0;
}

export interface GridPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingRad: number;
}

export interface GridParams {
  readonly frontGapM: number;
  readonly spacingM: number;
  readonly lateralM: number;
  readonly spawnClearanceM: number;
}

export const DEFAULT_GRID_PARAMS: GridParams = Object.freeze({
  frontGapM: 8,
  spacingM: 9,
  lateralM: 1.6,
  spawnClearanceM: 0.6,
});

/**
 * Builds `slotCount` staggered grid poses behind the start/finish line
 * (D-04). Slot 0 is pole. Position sits on the TRUE road centreline
 * (`centreX`/`centreZ`/`y`, not the smoothed racing line), offset laterally
 * by an alternating sign so slots stagger left/right; heading comes from the
 * smoothed racing line's own tangent at that arc, via `yawFromTravelDirection`
 * — the round-trip-correct inverse of `resetPose`'s own forward convention
 * (see `src/core/heading.ts`).
 */
export function buildGridPoses(
  line: RacingLine,
  slotCount: number,
  gridParams: GridParams = DEFAULT_GRID_PARAMS,
): readonly GridPose[] {
  const n = line.points.length;
  const poses: GridPose[] = [];
  for (let k = 0; k < slotCount; k++) {
    let arc = line.lapLengthM - (gridParams.frontGapM + k * gridParams.spacingM);
    arc = ((arc % line.lapLengthM) + line.lapLengthM) % line.lapLengthM;

    // Nearest point by arc (points are strictly increasing 0..lapLengthM).
    let idx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(line.points[i].arcM - arc);
      if (d < bestDist) {
        bestDist = d;
        idx = i;
      }
    }

    const point = line.points[idx];
    const prev = line.points[wrapIndex(idx - 1, n)];
    const next = line.points[wrapIndex(idx + 1, n)];
    const rawTx = next.x - prev.x;
    const rawTz = next.z - prev.z;
    const tangentLen = Math.hypot(rawTx, rawTz) || 1;
    const tx = rawTx / tangentLen;
    const tz = rawTz / tangentLen;

    const sign = k % 2 === 0 ? -1 : 1;
    const maxLateral = Math.max(0, point.halfWidthM - DEFAULT_RACING_LINE_PARAMS.edgeMarginM);
    const lateralOffset = sign * Math.min(gridParams.lateralM, maxLateral);
    // Right vector of the unit tangent (tx, tz) is (-tz, tx).
    const rightX = -tz;
    const rightZ = tx;

    poses.push(
      Object.freeze({
        x: point.centreX + lateralOffset * rightX,
        y: point.y + gridParams.spawnClearanceM,
        z: point.centreZ + lateralOffset * rightZ,
        headingRad: yawFromTravelDirection(tx, tz),
      }),
    );
  }
  return Object.freeze(poses);
}
