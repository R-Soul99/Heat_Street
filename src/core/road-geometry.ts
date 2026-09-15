/**
 * Offset-ribbon and angle-sorted junction-fan geometry: turns a `RoadGraph`'s
 * centrelines into positioned/indexed triangle geometry — a ribbon per edge,
 * a fan per junction node — sharing exact vertex positions so the seams SC1
 * forbids cannot exist by construction.
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
 * for the offset-ribbon + angle-sorted junction-fan approach.
 *
 * Layering: pure geometry. Imports only `./road-graph.ts` and
 * `./surface-types.ts`. Must not import three, RAPIER, any `@gltf-transform`
 * package, or any network/fs module — `tests/layering.test.ts` mechanically
 * enforces this for every file under `src/core/`. Shared deliberately
 * between the offline compiler and the browser runtime so collision and
 * visual geometry can never drift apart.
 */
// Explicit `.ts` extensions, matching `src/core/road-graph.ts`'s own
// convention: `tools/map-compiler/**` imports this module directly and is
// executed by Node's native type-stripping, whose ESM resolver requires
// fully-specified relative specifiers for every module in the import graph,
// not just the entry file. Do not "tidy" these back to extensionless.
import type { RoadGraph, RoadGraphEdge, RoadGraphNode } from "./road-graph.ts";
import type { SurfaceType } from "./surface-types.ts";

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

/** An edge incident to a junction node, carrying the exact ribbon corners `buildRibbon` produced AT this node. */
export interface IncidentEdgeAtNode {
  readonly edgeId: number;
  readonly surface: SurfaceType;
  readonly roadClass: string;
  /** This edge's ribbon corner nearest the node, on the +perpendicular side — reused verbatim, never recomputed. */
  readonly nearLeft: Vec3;
  /** This edge's ribbon corner nearest the node, on the -perpendicular side — reused verbatim, never recomputed. */
  readonly nearRight: Vec3;
  /**
   * The edge's first interior point moving AWAY from the node — retained as
   * per-incident-edge provenance/debugging metadata. NOT used by
   * `buildJunctionFan` to compute boundary-vertex sort order — see that
   * function's own doc comment for why a fixed offset from this direction is
   * ambiguous (it flips for `to`-end edges) and the corner's own position is
   * used instead.
   */
  readonly awayPoint: Vec3;
}

export interface FanGeometry {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly surface: SurfaceType;
}

export interface EdgeGeometryEntry {
  readonly edgeId: number;
  readonly surface: SurfaceType;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface JunctionGeometryEntry {
  readonly nodeId: number;
  readonly surface: SurfaceType;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface RoadGeometry {
  readonly edges: readonly EdgeGeometryEntry[];
  readonly junctions: readonly JunctionGeometryEntry[];
}

/**
 * Queries the off-road heightfield at world-space `(x, z)` — the compiler's
 * `src/core/heightfield-sample.ts` bilinear sampler bound to a concrete grid,
 * a plain function so this module never needs to import that grid's TYPE
 * (compiler-side `HeightfieldGrid` and runtime-side `MapCollisionHeightfield`
 * are different types with the same shape; a function value sidesteps having
 * to pick one, keeping this file's own "imports only road-graph/surface-types"
 * layering rule intact).
 */
export type HeightSampler = (x: number, z: number) => number;

export interface ShoulderGeometryEntry {
  readonly edgeId: number;
  readonly surface: SurfaceType;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** Consecutive centreline points closer than this (metres) collapse into one, per plan 04-03 Task 1. */
const COLLAPSE_EPS = 1e-4;

/**
 * The miter-length clamp, in multiples of half-width (plan decision D-P10).
 * [ASSUMED] a reasoned default with no external verification — past this
 * clamp a hairpin reads as a bevel rather than a spike-to-infinity, which is
 * visually correct for a road anyway. Flagged for the plan 04-10 feel session.
 *
 * [confirmed unchanged in plan 04-11's session] Investigated as a candidate
 * cause of this session's "gravel juts through tarmac at an oblique
 * tarmac/gravel junction" finding — a real hypothesis, since endpoints
 * DON'T get a miter (see `tangentAndFactor`'s `i === 0`/`i === n - 1` early
 * returns, both `factor: 1`), ruling out an inflated corner offset at the
 * junction itself as the mechanism. The real compiled map does have acute
 * (<45deg) mixed-width junctions (e.g. node 45: a 3.5m-wide dirt road
 * meeting a 7m-wide tarmac road at ~28-41deg) that are a real geometric
 * edge case for the bearing-sort fan algorithm, but the exact rendering
 * defect could not be conclusively isolated and safely fixed without a
 * direct visual re-check — deferred, see this plan's SUMMARY.
 */
const MITER_CLAMP = 3;

/**
 * How far, in metres, `buildRoadShoulders` extends a ramp beyond each edge's
 * paved rail before it meets the off-road heightfield's own (bilinearly
 * sampled) height at that point. [ASSUMED] first-pass value for the plan
 * 04-11 feel session: the compiler's own worst-case measured road-vs-terrain
 * disagreement is ~3.95m (`tools/map-compiler/author/heightfield.ts`'s own
 * `HEIGHTFIELD_SINK_M` doc comment) — 6m of run keeps even that worst case
 * under a ~35 degree grade (steep, but a continuous slope a car can scrub
 * down and climb back up, never a vertical drop it can be wedged under),
 * while the common case (a much smaller disagreement) reads as a gentle curb
 * rather than a ramp. Flagged for re-verification by driving, same as every
 * other constant on this plan's own tuning-surface table.
 */
const SHOULDER_WIDTH_M = 6;

/**
 * Road-class paving-apron ranking for junction-fan surface assignment
 * (highest-ranked incident class wins; lower number = higher rank).
 * [ASSUMED, MEDIUM confidence — 04-RESEARCH.md "Pattern 2"]: real-world
 * intersection paving practice is that a paved road's junction apron stays
 * paved where a dirt side road joins, but this has not been verified against
 * any source and is a per-junction grip discontinuity at the place players
 * cross most often — flagged for the plan 04-10 feel session, exactly as
 * Phase 3's surface grip values were.
 *
 * [confirmed unchanged in plan 04-11's session] Driven and evaluated: an
 * oblique tarmac/gravel junction's apron reads wrong (gravel visible where
 * the fan should read as paved) at the SAME junctions flagged on
 * `MITER_CLAMP`'s own note above. The rule itself (highest class wins) is
 * not implicated by that finding — the fan surface pick is correct, single-
 * valued, and applied to the whole fan; the defect is in the fan/ribbon
 * BOUNDARY geometry at acute, width-mismatched junctions, not in which
 * surface wins. Left unchanged pending the same follow-up.
 */
const ROAD_CLASS_RANK: Record<string, number> = {
  motorway: 0,
  trunk: 1,
  primary: 2,
  secondary: 3,
  tertiary: 4,
  unclassified: 5,
  residential: 6,
  service: 7,
  living_street: 8,
  track: 9,
};

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
interface EdgeRails {
  /** Collapsed centreline points, one per rail sample. */
  readonly points: readonly Vec3[];
  /** `points[i] + perp[i] * halfWidth * factor[i]` — the ribbon's own paved edge, +perpendicular side. */
  readonly left: readonly Vec3[];
  /** `points[i] - perp[i] * halfWidth * factor[i]` — the ribbon's own paved edge, -perpendicular side. */
  readonly right: readonly Vec3[];
  /** The per-point outward unit perpendicular used for `left`/`right` above, reused verbatim by `buildRoadShoulders` so a shoulder vertex lies on the exact same radial line as its paved-edge counterpart. */
  readonly perp: readonly XZ[];
}

/**
 * Computes the per-point rail geometry `buildRibbon` turns into triangles —
 * factored out so `buildRoadShoulders` can extend the SAME left/right rails
 * outward with no separately-recomputed tangent/miter math to drift from the
 * paved ribbon it must butt against exactly (the same "one source of truth"
 * reasoning this module's header applies to the compiler/runtime split).
 */
function computeEdgeRails(edge: RoadGraphEdge): EdgeRails {
  const points = collapsePoints(edge.points);
  if (points.length < 2) {
    throw new Error(
      `computeEdgeRails: edge id=${edge.id} has fewer than two distinct points after collapsing near-duplicates`,
    );
  }

  const halfWidth = edge.widthM / 2;
  const n = points.length;
  const left: Vec3[] = new Array(n);
  const right: Vec3[] = new Array(n);
  const perp: XZ[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const { tangent, factor } = tangentAndFactor(points, i);
    // tangent is only null when every surrounding segment is zero-length,
    // which collapsePoints already prevents for any surviving interior
    // point; guard anyway with a zero perpendicular rather than throwing
    // mid-loop, so a genuinely pathological input degrades to a
    // zero-width point rather than crashing the whole build.
    const p2 = tangent === null ? { x: 0, z: 0 } : { x: -tangent.z, z: tangent.x };
    const dist = halfWidth * factor;
    const p = points[i];
    left[i] = [p[0] + p2.x * dist, p[1], p[2] + p2.z * dist];
    right[i] = [p[0] - p2.x * dist, p[1], p[2] - p2.z * dist];
    perp[i] = p2;
  }

  return { points, left, right, perp };
}

/**
 * Builds the two triangles for strip segment `i -> i+1` between rail arrays
 * `a`/`b` (`a` plays the same CCW-from-+Y role `buildRibbon`'s original
 * inline loop gave its `left` array, `b` the role it gave `right` — see this
 * function's callers for which physical rail each argument is on a given
 * side). Shared by `buildRibbon` and `buildRoadShoulders` so the winding
 * convention that keeps a strip's face pointing up can never diverge between
 * the paved ribbon and its shoulder.
 */
function stripIndices(n: number): Uint32Array {
  const indices = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const base = i * 6;
    const ai = 2 * i;
    const bi = 2 * i + 1;
    const ai1 = 2 * i + 2;
    const bi1 = 2 * i + 3;
    indices[base] = ai;
    indices[base + 1] = ai1;
    indices[base + 2] = bi;
    indices[base + 3] = bi;
    indices[base + 4] = ai1;
    indices[base + 5] = bi1;
  }
  return indices;
}

function stripPositions(a: readonly Vec3[], b: readonly Vec3[]): Float32Array {
  const n = a.length;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    positions.set(a[i], i * 6);
    positions.set(b[i], i * 6 + 3);
  }
  return positions;
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
  const { left, right } = computeEdgeRails(edge);
  const n = left.length;

  return {
    positions: stripPositions(left, right),
    indices: stripIndices(n),
    leftCorners: [left[0], left[n - 1]],
    rightCorners: [right[0], right[n - 1]],
  };
}

/**
 * Builds one edge's shoulder: two ramp strips (left and right) running the
 * edge's own rail-point sequence, each strip's INNER rail sitting exactly on
 * the paved ribbon's own left/right rail (shared vertex positions with
 * `buildRibbon`'s output at every point, not just the two end corners — the
 * same watertightness-by-shared-vertices discipline this module's header
 * applies to ribbon/fan seams), and each strip's OUTER rail offset a further
 * `SHOULDER_WIDTH_M` along the SAME per-point perpendicular, at whatever
 * height `heightSampler` reports for that outer point — never a fixed drop,
 * so the ramp always reaches the real (however coarse) off-road ground
 * directly below it instead of leaving a residual gap.
 *
 * Winding follows `buildRibbon`'s own `(a, a+1, b)`/`(b, a+1, b+1)` rule via
 * the shared `stripIndices` helper. On the left side the OUTER rail is
 * further in the same `+perp` direction the paved ribbon's own `left` rail
 * uses, so it plays the "a" role `left` plays in `buildRibbon`'s ribbon
 * strip; the inner (paved-edge) rail plays "b". The right side is the mirror
 * image — its outer rail is further in `-perp`, so the INNER (paved-edge)
 * rail plays "a" and the outer rail plays "b". Getting either side backwards
 * reproduces the exact "invisible from above" failure `buildRibbon`'s own
 * doc comment warns about, just on the shoulder instead of the road.
 */
function buildEdgeShoulder(
  edge: RoadGraphEdge,
  heightSampler: HeightSampler,
): ShoulderGeometryEntry {
  const { left, right, perp } = computeEdgeRails(edge);
  const n = left.length;

  const outerLeft: Vec3[] = new Array(n);
  const outerRight: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const outerLeftX = l[0] + perp[i].x * SHOULDER_WIDTH_M;
    const outerLeftZ = l[2] + perp[i].z * SHOULDER_WIDTH_M;
    outerLeft[i] = [outerLeftX, Math.min(l[1], heightSampler(outerLeftX, outerLeftZ)), outerLeftZ];

    const r = right[i];
    const outerRightX = r[0] - perp[i].x * SHOULDER_WIDTH_M;
    const outerRightZ = r[2] - perp[i].z * SHOULDER_WIDTH_M;
    outerRight[i] = [
      outerRightX,
      Math.min(r[1], heightSampler(outerRightX, outerRightZ)),
      outerRightZ,
    ];
  }

  const leftPositions = stripPositions(outerLeft, left);
  const leftIndices = stripIndices(n);
  const rightPositions = stripPositions(right, outerRight);
  const rightIndices = stripIndices(n);

  const vertexOffset = leftPositions.length / 3;
  const positions = new Float32Array(leftPositions.length + rightPositions.length);
  positions.set(leftPositions, 0);
  positions.set(rightPositions, leftPositions.length);

  const indices = new Uint32Array(leftIndices.length + rightIndices.length);
  indices.set(leftIndices, 0);
  for (let i = 0; i < rightIndices.length; i++) {
    indices[leftIndices.length + i] = rightIndices[i] + vertexOffset;
  }

  return { edgeId: edge.id, surface: edge.surface, positions, indices };
}

/**
 * Builds every edge's shoulder ramp (see `buildEdgeShoulder`). No junction
 * shoulders: a junction fan is already wider than any single incident road's
 * paved width and reads as a paved apron, so the floating-edge problem
 * `buildEdgeShoulder` fixes is concentrated along a road's run, not at the
 * node — filling the fan's own irregular boundary with a matching ramp is a
 * materially harder variable-radius-polygon problem for comparatively little
 * benefit, and is deliberately left for a follow-up rather than guessed at
 * here.
 */
export function buildRoadShoulders(
  graph: RoadGraph,
  heightSampler: HeightSampler,
): readonly ShoulderGeometryEntry[] {
  return graph.edges.map((edge) => buildEdgeShoulder(edge, heightSampler));
}

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** Highest-ranked incident road class wins; ties broken by lowest edge id, per the table above. */
function pickJunctionSurface(incident: readonly IncidentEdgeAtNode[]): SurfaceType {
  let bestRank = Number.POSITIVE_INFINITY;
  for (const inc of incident) {
    const rank = ROAD_CLASS_RANK[inc.roadClass] ?? Number.POSITIVE_INFINITY;
    if (rank < bestRank) bestRank = rank;
  }
  let winner: IncidentEdgeAtNode | null = null;
  for (const inc of incident) {
    const rank = ROAD_CLASS_RANK[inc.roadClass] ?? Number.POSITIVE_INFINITY;
    if (rank === bestRank && (winner === null || inc.edgeId < winner.edgeId)) {
      winner = inc;
    }
  }
  if (winner === null) {
    throw new Error("buildJunctionFan: pickJunctionSurface called with no incident edges");
  }
  return winner.surface;
}

/**
 * Builds the triangle fan filling a junction node, from `incident`'s exact
 * ribbon corners (never recomputed — that reuse is the whole watertightness
 * mechanism; see module header).
 *
 * Each incident edge contributes its two near corners, `nearLeft` and
 * `nearRight`, offset PERPENDICULAR to the edge's own direction rather than
 * along it. Each corner's bearing is computed directly from ITS OWN position
 * relative to the node (`atan2` of the corner's XZ offset from the node) —
 * deliberately NOT derived as a fixed +/-90deg offset from the edge's own
 * approach bearing (`awayPoint`'s direction): `buildRibbon`'s tangent at a
 * node always points in the edge's "forward" (increasing-point-index)
 * direction, which is the away-from-node direction when this node is the
 * edge's `from` end but the ARRIVING (toward-node) direction when this node
 * is the edge's `to` end — a fixed-offset-from-away-bearing formula would
 * silently swap `nearLeft`/`nearRight`'s effective bearings for every `to`-end
 * edge, producing an inverted, self-crossing fan. Reading each corner's own
 * position sidesteps that direction ambiguity entirely and is exactly
 * correct regardless of which end of the edge this node is.
 *
 * All `2 * incident.length` corners are sorted by this per-corner bearing,
 * which is what "ordered by the approach bearing of their edge" means in
 * practice (each corner's bearing tracks its own edge's approach bearing
 * closely, since it is offset only slightly off that edge's axis) and
 * produces a convex-ordered ring with no extra bookkeeping. The fan then
 * triangulates `(centre, ring[i], ring[i+1])` for each consecutive pair
 * (wrapping around), which is CCW-from-+Y for an ascending-bearing ring
 * using the same `atan2(x, z)` convention as `buildRibbon`'s left/right
 * assignment.
 */
export function buildJunctionFan(
  node: RoadGraphNode,
  incident: readonly IncidentEdgeAtNode[],
): FanGeometry {
  if (incident.length < 3) {
    throw new Error(
      `buildJunctionFan: node id=${node.id} has only ${incident.length} incident edge(s); a fan requires at least 3`,
    );
  }

  interface Corner {
    readonly pos: Vec3;
    readonly bearing: number;
  }
  const bearingOf = (pos: Vec3): number =>
    normalizeAngle(Math.atan2(pos[0] - node.x, pos[2] - node.z));
  const corners: Corner[] = [];
  for (const inc of incident) {
    corners.push({ pos: inc.nearLeft, bearing: bearingOf(inc.nearLeft) });
    corners.push({ pos: inc.nearRight, bearing: bearingOf(inc.nearRight) });
  }
  corners.sort((a, b) => a.bearing - b.bearing);

  const center: Vec3 = [node.x, node.y, node.z];
  const positions = new Float32Array((1 + corners.length) * 3);
  positions.set(center, 0);
  corners.forEach((c, i) => {
    positions.set(c.pos, (i + 1) * 3);
  });

  const indices = new Uint32Array(corners.length * 3);
  for (let i = 0; i < corners.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % corners.length);
    indices[i * 3] = 0;
    indices[i * 3 + 1] = a;
    indices[i * 3 + 2] = b;
  }

  return { positions, indices, surface: pickJunctionSurface(incident) };
}

interface IncidentRaw {
  readonly edge: RoadGraphEdge;
  readonly atFrom: boolean;
}

function pushIncident(
  map: Map<number, IncidentRaw[]>,
  nodeId: number,
  edge: RoadGraphEdge,
  atFrom: boolean,
): void {
  const list = map.get(nodeId);
  if (list) {
    list.push({ edge, atFrom });
  } else {
    map.set(nodeId, [{ edge, atFrom }]);
  }
}

/**
 * Builds geometry for the whole graph: one ribbon per edge, one fan per
 * junction node (degree >= 3). Degree-1 (dead end) and degree-2 (a
 * `junction: false` node where a way was simply split, e.g. at a
 * surface-type change) nodes get no fan — a degree-2 node's two ribbons
 * already share exact corner positions at that node, so butting them is
 * seamless with no extra geometry [CITED: 04-RESEARCH.md "Pattern 1"].
 *
 * Degree is derived directly from the actual incident-edge count, not from
 * `node.junction` — the schema defines `junction` as exactly this condition
 * ("three or more edges meet"), so deriving it independently here keeps this
 * pure-geometry module self-consistent rather than trusting an external flag.
 */
export function buildRoadGeometry(graph: RoadGraph): RoadGeometry {
  const ribbons = new Map<number, RibbonGeometry>();
  for (const edge of graph.edges) {
    ribbons.set(edge.id, buildRibbon(edge));
  }

  const incidentByNode = new Map<number, IncidentRaw[]>();
  for (const edge of graph.edges) {
    pushIncident(incidentByNode, edge.from, edge, true);
    pushIncident(incidentByNode, edge.to, edge, false);
  }

  const edges: EdgeGeometryEntry[] = graph.edges.map((edge) => {
    // biome-ignore lint/style/noNonNullAssertion: populated unconditionally, once per edge, just above.
    const ribbon = ribbons.get(edge.id)!;
    return {
      edgeId: edge.id,
      surface: edge.surface,
      positions: ribbon.positions,
      indices: ribbon.indices,
    };
  });

  const junctions: JunctionGeometryEntry[] = [];
  for (const node of graph.nodes) {
    const incidentList = incidentByNode.get(node.id) ?? [];
    if (incidentList.length < 3) continue;

    const incident: IncidentEdgeAtNode[] = incidentList.map(({ edge, atFrom }) => {
      // biome-ignore lint/style/noNonNullAssertion: populated unconditionally for every graph.edges entry above.
      const ribbon = ribbons.get(edge.id)!;
      return {
        edgeId: edge.id,
        surface: edge.surface,
        roadClass: edge.roadClass,
        nearLeft: atFrom ? ribbon.leftCorners[0] : ribbon.leftCorners[1],
        nearRight: atFrom ? ribbon.rightCorners[0] : ribbon.rightCorners[1],
        awayPoint: atFrom ? edge.points[1] : edge.points[edge.points.length - 2],
      };
    });

    const fan = buildJunctionFan(node, incident);
    junctions.push({
      nodeId: node.id,
      surface: fan.surface,
      positions: fan.positions,
      indices: fan.indices,
    });
  }

  return { edges, junctions };
}
