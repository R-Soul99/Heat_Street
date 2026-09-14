/**
 * OSM building footprints -> oriented-bounding-box (OBB) prisms with
 * ground-seated, inferred heights. Plan 04-07 Task 2 — the "cheap adaptation
 * of working code" 04-RESEARCH.md's Geomesh Investigation identified: real
 * OSM building extraction is already solved by Overpass (`sources/overpass.ts`'s
 * `buildingsQuery`, ported from Geomesh's `/api/buildings/structures` handler),
 * so this module's only new work is footprint -> OBB geometry and height
 * inference, not a from-scratch building pipeline.
 *
 * NETWORK-FETCH DEVIATION (documented per SUMMARY.md, Rule 3 territory but
 * NOT a package install): this plan's `<read_first>` asks for a direct read
 * of `github.com/R-Soul99/Geomesh`'s `server.ts` to transcribe its FULL
 * building height-inference table. This session's sandbox denied the
 * external network fetch needed to read that file directly (Claude Code's
 * auto-mode classifier blocked the raw GitHub content request). The only
 * two table values already independently verified and committed to this
 * repo are `commercial: 12.0` and `residential: 6.8`
 * [CITED: .planning/phases/04-map-pipeline-first-area/04-RESEARCH.md, its
 * own "Existing Solutions" table row for `/api/buildings/structures`, which
 * reports reading `server.ts` directly during the research session]. Every
 * OTHER building type below is a single documented `[ASSUMED]` default,
 * exactly as this plan's own `<action>` text prescribes for "a building type
 * absent from Geomesh's table". This is consistent with the plan's own
 * threat model (T-04-27, disposition "accept"): a wrong building height is a
 * cosmetic error, not a handling bug, so — unlike `surface-mapping.ts`,
 * which throws the BUILD on an unmapped OSM value — this module never
 * throws on an unrecognised building type; it falls back to
 * `DEFAULT_HEIGHT_M` and keeps building.
 *
 * Layering: pure geometry + math over an injected `Projector` (`graph/project.ts`)
 * and `ElevationSampler` (`sources/dem.ts`) — no `node:fs`, no network, no
 * `three`, no Rapier. Mirrors `graph/elevation.ts`'s own injected-dependency
 * discipline. NOT mechanically enforced — `tests/layering.test.ts` does not
 * scan `tools/**`; this file's own discipline is the only guard.
 */

import type { Projector } from "../graph/project.ts";
import type { ElevationSampler } from "../sources/dem.ts";

/** A 2D point in local ENU metres (X east, Z south), matching `graph/project.ts`'s `ProjectedPoint`. */
interface Point2 {
  readonly x: number;
  readonly z: number;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Per-level height used when a building carries a `building:levels`/`levels`
 * tag but no explicit `height`. [ASSUMED] — a common architectural
 * approximation (one storey ~= 3m including floor/ceiling assembly); no
 * external source confirms Geomesh's own exact per-level constant, since the
 * network fetch needed to read it was blocked this session (see module
 * header). Flagged for the plan 04-11 feel session alongside the other
 * `[ASSUMED]` values in this table.
 */
export const PER_LEVEL_HEIGHT_M = 3.0;

/**
 * Per-type default building height (metres), used when neither `height` nor
 * `building:levels`/`levels` is present or parseable.
 *
 * `commercial` and `residential` are
 * [CITED: .planning/phases/04-map-pipeline-first-area/04-RESEARCH.md
 * "Existing Solutions" table, `/api/buildings/structures` row — read
 * directly from github.com/R-Soul99/Geomesh's `server.ts` during the
 * research session]. `house` (OSM's own common synonym for a residential
 * building, and the majority tag in the real committed Juliette, GA
 * building payload) is mapped to the SAME cited residential value.
 *
 * Every other entry is a single documented `[ASSUMED]` default — this
 * session's sandbox denied the external fetch needed to read Geomesh's full
 * table (see module header); these values are reasoned architectural
 * approximations, not transcribed from the source, and are flagged for the
 * plan 04-11 feel session exactly as the road-surface grip values were in
 * Phase 3.
 */
const HEIGHT_BY_TYPE: Readonly<Record<string, number>> = {
  // [CITED: 04-RESEARCH.md "Existing Solutions" table]
  commercial: 12.0,
  // [CITED: 04-RESEARCH.md "Existing Solutions" table]
  residential: 6.8,
  // [ASSUMED] alias of the cited residential value — OSM's most common
  // single-family-home tag, 56/85 elements in the real committed payload.
  house: 6.8,
  // [ASSUMED] typical single/double-storey shopfront.
  retail: 7.0,
  // [ASSUMED] typical single-storey light-industrial shed.
  industrial: 8.0,
  // [ASSUMED] detached single-vehicle garage.
  garage: 3.0,
  // [ASSUMED] small outbuilding (tool shed, etc.).
  shed: 3.0,
  // [ASSUMED] agricultural barn — often tall for hay/equipment storage.
  barn: 7.0,
  // [ASSUMED] typical rural single-nave church, no steeple.
  church: 10.0,
  // [ASSUMED] typical single-storey rural school building.
  school: 8.0,
  // [ASSUMED] typical single-storey warehouse with clearance for stacking.
  warehouse: 9.0,
  // [ASSUMED] a mobile/manufactured home.
  static_caravan: 3.5,
  // [ASSUMED] an open-sided roofed structure (picnic pavilion, market stall).
  pavilion: 4.0,
  // [ASSUMED] OSM's generic "a building exists here, type unknown" tag.
  yes: 6.0,
};

/**
 * Fallback for any building/`man_made`/`amenity` type not present in
 * `HEIGHT_BY_TYPE` at all (e.g. `amenity=fuel` canopies, `man_made=silo`).
 * [ASSUMED] a generic small-structure default — deliberately the SAME value
 * as `yes`, since both represent "no useful type signal".
 */
export const DEFAULT_HEIGHT_M = 6.0;

/**
 * Footprints whose minimum-area rectangle is smaller than this (square
 * metres) are skipped as noise — sheds, bin stores, utility cabinets that
 * would otherwise clutter Main Street with sub-visible boxes. [ASSUMED],
 * per this plan's own `<behavior>` bullet (the literal "12 square metres"
 * value is plan-specified, not independently derived).
 */
export const MIN_BUILDING_AREA_SQM = 12;

export type HeightSource = "explicit" | "levels" | "type-default";

/** One compiled building prism, ready for `author/gltf.ts` to consume. */
export interface BuildingBox {
  readonly osmWayId: number;
  readonly buildingType: string;
  /** 8 vertices (4 base, 4 top), stride 3, local ENU metres. */
  readonly positions: Float32Array;
  /** 10 triangles (4 walls + roof; floor omitted) — 30 indices into `positions`. */
  readonly indices: Uint32Array;
  readonly heightM: number;
  readonly heightSource: HeightSource;
  readonly areaSqM: number;
}

export interface BuildingReport {
  readonly boxCount: number;
  readonly skipped: {
    /** Fewer than 3 distinct footprint points, or a degenerate (colinear) hull. */
    readonly degenerate: number;
    /** OBB area below `MIN_BUILDING_AREA_SQM`. */
    readonly tinyArea: number;
  };
  readonly heightSource: {
    readonly explicit: number;
    readonly levels: number;
    readonly typeDefault: number;
  };
}

export interface BuildingBoxesConfig {
  /** Overrides `MIN_BUILDING_AREA_SQM`. */
  readonly minAreaSqM?: number;
}

/** The minimal shape this module needs from an Overpass "buildings" envelope's `response.elements`. */
interface BuildingWayElement {
  readonly type: "way";
  readonly id: number;
  readonly geometry?: readonly { readonly lat: number; readonly lon: number }[];
  readonly tags?: Readonly<Record<string, string>>;
}

/** The minimal shape this module needs from `sources/overpass.ts`'s `OverpassEnvelope`. */
export interface BuildingsEnvelopeLike {
  readonly response: { readonly elements: readonly unknown[] };
}

function isBuildingWayElement(element: unknown): element is BuildingWayElement {
  return (
    typeof element === "object" &&
    element !== null &&
    (element as { type?: unknown }).type === "way" &&
    Array.isArray((element as { geometry?: unknown }).geometry)
  );
}

/** Distinct-point tolerance for collapsing near-duplicate footprint vertices, metres. */
const COLLAPSE_EPS = 1e-4;

function dist2D(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Projects an OSM `geometry` ring to local metres and collapses near-duplicate
 * consecutive points AND the closing duplicate (OSM way rings repeat their
 * first node as the last), leaving only distinct footprint vertices.
 */
function projectRing(
  geometry: readonly { readonly lat: number; readonly lon: number }[],
  projector: Projector,
): Point2[] {
  const projected = geometry.map((pt) => projector.project(pt.lat, pt.lon));
  const out: Point2[] = [];
  for (const p of projected) {
    const prev = out[out.length - 1];
    if (prev === undefined || dist2D(prev, p) > COLLAPSE_EPS) {
      out.push(p);
    }
  }
  // Drop the closing duplicate (ring start === ring end for a real OSM way).
  if (out.length > 1 && dist2D(out[0], out[out.length - 1]) <= COLLAPSE_EPS) {
    out.pop();
  }
  return out;
}

/**
 * Monotone-chain convex hull, ascending x then z, CCW result. Collinear
 * points on the hull boundary are dropped (the `<= 0` cross-product test),
 * which is also what makes a fewer-than-3-points or fully-degenerate
 * (colinear) input collapse naturally to a too-small hull for the caller to
 * detect and skip.
 */
function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return sorted;

  const cross = (o: Point2, a: Point2, b: Point2): number =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const lower: Point2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

interface MinRect {
  /** Four corners, in order around the rectangle (winding not guaranteed either direction). */
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  readonly area: number;
}

/** Plain axis-aligned bounding-box area over `points` — used only by tests, to prove the OBB beats it. */
export function axisAlignedArea(points: readonly Point2[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return (maxX - minX) * (maxZ - minZ);
}

/**
 * Minimum-area enclosing rectangle over a convex hull via rotating calipers:
 * for each hull edge, rotate the hull into that edge's own frame and take
 * the axis-aligned extent there; keep the rotation with the smallest area.
 * This is the standard, exact construction (the true minimum-area rectangle
 * always has one side flush with a hull edge) — not an approximation.
 */
function minAreaRect(hull: readonly Point2[]): MinRect {
  let best: MinRect | null = null;

  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const edgeLen = dist2D(p1, p2);
    if (edgeLen < 1e-9) continue;

    const ux = (p2.x - p1.x) / edgeLen;
    const uz = (p2.z - p1.z) / edgeLen;
    // Perpendicular to (ux, uz) in the XZ plane.
    const vx = -uz;
    const vz = ux;

    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const p of hull) {
      const u = p.x * ux + p.z * uz;
      const v = p.x * vx + p.z * vz;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (best === null || area < best.area) {
      const corners: [Point2, Point2, Point2, Point2] = [
        { u: minU, v: minV },
        { u: maxU, v: minV },
        { u: maxU, v: maxV },
        { u: minU, v: maxV },
      ].map(({ u, v }) => ({ x: u * ux + v * vx, z: u * uz + v * vz })) as [
        Point2,
        Point2,
        Point2,
        Point2,
      ];
      best = { corners, area };
    }
  }

  if (best === null) {
    throw new Error("minAreaRect: hull has no edge of nonzero length — fully degenerate input");
  }
  return best;
}

/** Simple vertex-average centroid of `points` — matches this plan's "footprint centroid" wording. */
function centroid2D(points: readonly Point2[]): Point2 {
  let sx = 0;
  let sz = 0;
  for (const p of points) {
    sx += p.x;
    sz += p.z;
  }
  return { x: sx / points.length, z: sz / points.length };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function getVec3(positions: Float32Array, index: number): Vec3 {
  return { x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] };
}

/**
 * Emits the two triangles for quad `a -> b -> c -> d -> a`, choosing whichever
 * of the two possible windings makes the face normal point toward `outward`
 * (dot product >= 0). This makes winding correct regardless of which
 * rotational direction the quad's own corner order happens to be in — the
 * caller never needs to reason about CW vs CCW itself, only about which way
 * the face should visibly face.
 */
function quadTriangles(
  a: number,
  b: number,
  c: number,
  d: number,
  positions: Float32Array,
  outward: Vec3,
): [number, number, number, number, number, number] {
  const pa = getVec3(positions, a);
  const pb = getVec3(positions, b);
  const pc = getVec3(positions, c);
  const normal = cross3(subtract(pb, pa), subtract(pc, pa));
  if (dot3(normal, outward) >= 0) {
    return [a, b, c, a, c, d];
  }
  return [a, c, b, a, d, c];
}

/**
 * Builds one prism's 8 vertices and 10 triangles (4 wall quads + 1 roof
 * quad; the floor quad is DELIBERATELY OMITTED — it is never visible from
 * the permanent high-angle helicopter camera this project uses throughout,
 * and omitting it halves nothing structurally important while cutting
 * real triangle count).
 *
 * [Rule 1 fix vs. this plan's own prose]: 04-07-PLAN.md's `<action>`/`<behavior>`
 * text states "12 triangles" for this shape, but also explicitly enumerates
 * exactly five visible faces (four walls + roof) with the floor omitted. Five
 * quad faces built from 8 shared corner vertices is unambiguously 4*2 + 2 =
 * 10 triangles, not 12 — a plain arithmetic reconciliation, not a design
 * choice, and the floor-omission requirement (the behaviourally load-bearing
 * part, verified by triangle count + winding below) is honoured exactly.
 */
function buildPrism(
  corners: readonly [Point2, Point2, Point2, Point2],
  groundY: number,
  heightM: number,
): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(8 * 3);
  for (let i = 0; i < 4; i++) {
    positions[i * 3] = corners[i].x;
    positions[i * 3 + 1] = groundY;
    positions[i * 3 + 2] = corners[i].z;
  }
  for (let i = 0; i < 4; i++) {
    positions[(i + 4) * 3] = corners[i].x;
    positions[(i + 4) * 3 + 1] = groundY + heightM;
    positions[(i + 4) * 3 + 2] = corners[i].z;
  }

  const boxCenterX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const boxCenterZ = (corners[0].z + corners[1].z + corners[2].z + corners[3].z) / 4;

  const triangleIndices: number[] = [];

  // Roof: top0,top1,top2,top3 (indices 4-7), outward = up.
  triangleIndices.push(...quadTriangles(4, 5, 6, 7, positions, { x: 0, y: 1, z: 0 }));

  // Four walls: edge i (base i -> base i+1), quad order base_i, base_i+1, top_i+1, top_i.
  for (let i = 0; i < 4; i++) {
    const i1 = (i + 1) % 4;
    const bi = i;
    const bi1 = i1;
    const ti = i + 4;
    const ti1 = i1 + 4;
    const midX = (corners[i].x + corners[i1].x) / 2;
    const midZ = (corners[i].z + corners[i1].z) / 2;
    const outward: Vec3 = { x: midX - boxCenterX, y: 0, z: midZ - boxCenterZ };
    triangleIndices.push(...quadTriangles(bi, bi1, ti1, ti, positions, outward));
  }

  return { positions, indices: new Uint32Array(triangleIndices) };
}

function parseHeightMeters(raw: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)\s*m?$/i.exec(raw.trim());
  if (match === null) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Resolves a building's height + provenance from its OSM tags, per this file's header comment. */
function inferHeight(
  tags: Readonly<Record<string, string>> | undefined,
  buildingType: string,
): { heightM: number; source: HeightSource } {
  const heightTag = tags?.height;
  if (heightTag !== undefined) {
    const parsed = parseHeightMeters(heightTag);
    if (parsed !== null) {
      return { heightM: parsed, source: "explicit" };
    }
    // Unparseable — fall through to the next rule (this file's header comment).
  }

  const levelsTag = tags?.["building:levels"] ?? tags?.levels;
  if (levelsTag !== undefined) {
    const levels = Number.parseFloat(levelsTag);
    if (Number.isFinite(levels) && levels > 0) {
      return { heightM: levels * PER_LEVEL_HEIGHT_M, source: "levels" };
    }
    // Unparseable — fall through to the type-default rule.
  }

  const typeDefault = HEIGHT_BY_TYPE[buildingType];
  return { heightM: typeDefault ?? DEFAULT_HEIGHT_M, source: "type-default" };
}

/** Picks the tag that determines a way's building "type" for height-table lookup. */
function resolveBuildingType(tags: Readonly<Record<string, string>> | undefined): string {
  return tags?.building ?? tags?.man_made ?? tags?.amenity ?? "yes";
}

/**
 * Turns every real building/`man_made`/`amenity` way in `buildingsEnvelope`
 * into a ground-seated, correctly-oriented, correctly-heighted prism.
 * Degenerate and tiny footprints are skipped and counted, never thrown on —
 * see this file's header comment for why building geometry tolerates bad
 * input where `surface-mapping.ts` deliberately does not.
 */
export function buildingBoxes(
  buildingsEnvelope: BuildingsEnvelopeLike,
  projector: Projector,
  groundSampler: ElevationSampler,
  config: BuildingBoxesConfig = {},
): { boxes: BuildingBox[]; report: BuildingReport } {
  const minAreaSqM = config.minAreaSqM ?? MIN_BUILDING_AREA_SQM;

  const boxes: BuildingBox[] = [];
  let degenerate = 0;
  let tinyArea = 0;
  let explicitCount = 0;
  let levelsCount = 0;
  let typeDefaultCount = 0;

  for (const element of buildingsEnvelope.response.elements) {
    if (!isBuildingWayElement(element)) continue;

    const footprint = projectRing(element.geometry ?? [], projector);
    if (footprint.length < 3) {
      degenerate++;
      continue;
    }

    const hull = convexHull(footprint);
    if (hull.length < 3) {
      degenerate++;
      continue;
    }

    const rect = minAreaRect(hull);
    if (rect.area < minAreaSqM) {
      tinyArea++;
      continue;
    }

    const centroid = centroid2D(footprint);
    const { lat, lon } = projector.unproject(centroid.x, centroid.z);
    const groundY = groundSampler.sample(lat, lon);

    const buildingType = resolveBuildingType(element.tags);
    const { heightM, source } = inferHeight(element.tags, buildingType);

    const { positions, indices } = buildPrism(rect.corners, groundY, heightM);

    boxes.push({
      osmWayId: element.id,
      buildingType,
      positions,
      indices,
      heightM,
      heightSource: source,
      areaSqM: rect.area,
    });

    if (source === "explicit") explicitCount++;
    else if (source === "levels") levelsCount++;
    else typeDefaultCount++;
  }

  return {
    boxes,
    report: {
      boxCount: boxes.length,
      skipped: { degenerate, tinyArea },
      heightSource: {
        explicit: explicitCount,
        levels: levelsCount,
        typeDefault: typeDefaultCount,
      },
    },
  };
}
