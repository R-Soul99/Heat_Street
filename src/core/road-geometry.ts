/**
 * Offset-ribbon geometry: turns a `RoadGraph` edge's centreline into a
 * positioned/indexed ribbon of triangles — the road-surface strip a vehicle
 * actually drives on. Junction-fan geometry (the piece that stitches ribbons
 * together seamlessly at intersections) is added in Task 2 of this same
 * plan; this file currently covers Task 1's scope only.
 *
 * This module lives in `src/core/`, not `tools/map-compiler/geometry/`
 * (deliberate deviation from 04-RESEARCH.md/04-PATTERNS.md, plan 04-03
 * decision D-P9): the browser runtime needs the IDENTICAL algorithm to build
 * colliders that line up with the shipped `.glb` to the vertex. Two
 * implementations of a miter-joined offset polyline WILL drift, and the
 * symptom is the car floating above or sinking into the road it visibly
 * touches. `tools/map-compiler/author/gltf.ts` (plan 04-07) and
 * `src/physics/map-scene.ts` (plan 04-08) both call this module directly.
 *
 * [CITED: 04-RESEARCH.md "Pattern 1", adapted from github.com/a-b-street/osm2streets]
 * for the offset-ribbon approach.
 *
 * Layering: pure geometry. Imports only `./road-graph.ts`. Must not import
 * three, RAPIER, any `@gltf-transform` package, or any network/fs module —
 * `tests/layering.test.ts` mechanically enforces this for every file under
 * `src/core/`. Shared deliberately between the offline compiler and the
 * browser runtime so collision and visual geometry can never drift apart.
 */
// Explicit `.ts` extension, matching `src/core/road-graph.ts`'s own
// convention: `tools/map-compiler/**` imports this module directly and is
// executed by Node's native type-stripping, whose ESM resolver requires
// fully-specified relative specifiers for every module in the import graph,
// not just the entry file. Do not "tidy" this back to extensionless.
import type { RoadGraphEdge } from "./road-graph.ts";

/** A point or offset in local ENU metres, Y-up — matches `RoadGraphEdge.points`'s tuple shape exactly. */
export type Vec3 = readonly [number, number, number];

export interface RibbonGeometry {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** The near-corner pair at each end of the ribbon: `[startCorner, endCorner]`. */
  readonly leftCorners: readonly Vec3[];
  /** The near-corner pair at each end of the ribbon: `[startCorner, endCorner]`. */
  readonly rightCorners: readonly Vec3[];
}

/** Consecutive centreline points closer than this (metres) collapse into one, per plan 04-03 Task 1. */
const COLLAPSE_EPS = 1e-4;

/**
 * The miter-length clamp, in multiples of half-width (plan decision D-P10).
 * [ASSUMED] a reasoned default with no external verification — past this
 * clamp a hairpin reads as a bevel rather than a spike-to-infinity, which is
 * visually correct for a road anyway. Flagged for the plan 04-10 feel session.
 */
const MITER_CLAMP = 3;

function dist3D(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Collapses consecutive near-duplicate points, but never drops the true
 * first/last input point — those are the edge's authored endpoints and must
 * survive verbatim so the ribbon starts/ends exactly at the edge's nodes.
 */
function collapsePoints(points: readonly Vec3[]): Vec3[] {
  if (points.length === 0) return [];
  const out: Vec3[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    if (dist3D(prev, points[i]) > COLLAPSE_EPS) {
      out.push(points[i]);
    }
  }
  if (points.length > 1) {
    const last = points[points.length - 1];
    const prevOut = out[out.length - 1];
    if (dist3D(prevOut, last) > COLLAPSE_EPS) {
      out.push(last);
    }
  }
  return out;
}

interface XZ {
  readonly x: number;
  readonly z: number;
}

/** Normalises `v` within the XZ plane; returns `null` if `v` is (numerically) zero-length. */
function normalizeXZ(v: XZ): XZ | null {
  const len = Math.hypot(v.x, v.z);
  if (len < 1e-9) return null;
  return { x: v.x / len, z: v.z / len };
}

function segmentDirXZ(a: Vec3, b: Vec3): XZ {
  return { x: b[0] - a[0], z: b[2] - a[2] };
}

interface TangentAndFactor {
  /** `null` only for a fully degenerate (zero-length in every direction) segment; callers must guard. */
  readonly tangent: XZ | null;
  readonly factor: number;
}

/**
 * Tangent + miter factor at collapsed-point index `i`. Endpoints (`i === 0`
 * or `i === n - 1`) use a plain forward/backward difference with no miter
 * (`factor = 1`) — schema design decision 1 and the "no extension or inset"
 * requirement both depend on endpoints never being scaled. Interior points
 * use the normalised average of the incoming/outgoing segment directions for
 * the tangent, and `1 / sin(theta / 2)` (clamped at `MITER_CLAMP`) for the
 * offset factor, where `theta` is the interior angle between the two
 * segments [CITED: 04-RESEARCH.md "Pattern 1"].
 */
function tangentAndFactor(points: readonly Vec3[], i: number): TangentAndFactor {
  const n = points.length;
  if (i === 0) {
    return { tangent: normalizeXZ(segmentDirXZ(points[0], points[1])), factor: 1 };
  }
  if (i === n - 1) {
    return { tangent: normalizeXZ(segmentDirXZ(points[n - 2], points[n - 1])), factor: 1 };
  }

  const din = normalizeXZ(segmentDirXZ(points[i - 1], points[i]));
  const dout = normalizeXZ(segmentDirXZ(points[i], points[i + 1]));
  if (din === null && dout === null) {
    return { tangent: null, factor: 1 };
  }
  if (din === null) return { tangent: dout, factor: 1 };
  if (dout === null) return { tangent: din, factor: 1 };

  // Unsigned angle between din/dout via atan2(|cross|, dot) — robust near 0
  // and pi, unlike acos(dot) which is ill-conditioned there.
  const cross = din.x * dout.z - din.z * dout.x;
  const dot = din.x * dout.x + din.z * dout.z;
  const delta = Math.atan2(Math.abs(cross), dot);
  const theta = Math.PI - delta;
  // sin(theta / 2) is in (0, 1] for theta in (0, pi], so this is always >= 1
  // and never divides by a negative number; only the upper clamp is load-bearing.
  const factor = Math.min(1 / Math.sin(theta / 2), MITER_CLAMP);

  // din + dout cancels only when the two segments are exactly opposite
  // (theta === 0, the exact-reversal hairpin) — fall back to din's own
  // direction; the miter factor is already clamped to MITER_CLAMP above.
  const tangent = normalizeXZ({ x: din.x + dout.x, z: din.z + dout.z }) ?? din;
  return { tangent, factor };
}

/**
 * Builds the offset-ribbon geometry for a single edge: a quad strip whose
 * left/right rails are offset `widthM / 2` from the centreline (miter-joined
 * at interior points, clamped per D-P10), with Y copied through from the
 * source centreline point untouched at every vertex.
 *
 * Winding: for centreline segment `i -> i+1` with vertices
 * `L_i=2i, R_i=2i+1, L_{i+1}=2i+2, R_{i+1}=2i+3`, the two triangles are
 * `(L_i, L_{i+1}, R_i)` and `(R_i, L_{i+1}, R_{i+1})` — this specific vertex
 * order is what produces a counter-clockwise-from-+Y winding for a `left =
 * point + rotate90CCW(tangent) * halfWidth` convention; getting it wrong
 * produces a road whose faces are culled from above, which reads as "the
 * road is invisible" and is a genuinely confusing bug to diagnose.
 */
export function buildRibbon(edge: RoadGraphEdge): RibbonGeometry {
  const points = collapsePoints(edge.points);
  if (points.length < 2) {
    throw new Error(
      `buildRibbon: edge id=${edge.id} has fewer than two distinct points after collapsing near-duplicates`,
    );
  }

  const halfWidth = edge.widthM / 2;
  const n = points.length;
  const left: Vec3[] = new Array(n);
  const right: Vec3[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const { tangent, factor } = tangentAndFactor(points, i);
    // tangent is only null when every surrounding segment is zero-length,
    // which collapsePoints already prevents for any surviving interior
    // point; guard anyway with a zero perpendicular rather than throwing
    // mid-loop, so a genuinely pathological input degrades to a
    // zero-width point rather than crashing the whole build.
    const perp = tangent === null ? { x: 0, z: 0 } : { x: -tangent.z, z: tangent.x };
    const dist = halfWidth * factor;
    const p = points[i];
    left[i] = [p[0] + perp.x * dist, p[1], p[2] + perp.z * dist];
    right[i] = [p[0] - perp.x * dist, p[1], p[2] - perp.z * dist];
  }

  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    positions.set(left[i], i * 6);
    positions.set(right[i], i * 6 + 3);
  }

  const indices = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const base = i * 6;
    const li = 2 * i;
    const ri = 2 * i + 1;
    const li1 = 2 * i + 2;
    const ri1 = 2 * i + 3;
    indices[base] = li;
    indices[base + 1] = li1;
    indices[base + 2] = ri;
    indices[base + 3] = ri;
    indices[base + 4] = li1;
    indices[base + 5] = ri1;
  }

  return {
    positions,
    indices,
    leftCorners: [left[0], left[n - 1]],
    rightCorners: [right[0], right[n - 1]],
  };
}
