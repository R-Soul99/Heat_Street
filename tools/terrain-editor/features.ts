// Pure scenery edit operations (07.1.3 D-07, D-12, D-14, D-16). No DOM, no three.
// Every function returns NEW arrays and never mutates its inputs or the elements in
// them (undo snapshots share element objects). editor.ts only routes input to these.

import type { AuthoredCrest } from "../../src/core/crest-geometry.ts";
import type { SceneryKind } from "../../src/core/scenery-catalog.ts";
import { terrainGridExtent } from "../../src/core/terrain-drive-setup.ts";
import {
  MAX_FEATURE_SCALE,
  MAX_LINE_FEATURES,
  MAX_LINE_POINTS,
  MAX_POINT_FEATURES,
  MIN_FEATURE_SCALE,
  type TerrainBuilding,
  type TerrainFeature,
  type TerrainLineFeature,
  type TerrainObject,
  type TerrainPointFeature,
} from "../../src/core/terrain-format.ts";
import type { TerrainGrid } from "../../src/core/terrain-grid.ts";
import { isRoadAt, type PaintMap } from "../../src/core/terrain-paint.ts";

/** What the placement checks need from the live area. */
export interface PlaceArea {
  readonly grid: TerrainGrid;
  readonly paint: PaintMap;
}

export type HeightFn = (x: number, z: number) => number;

export type ScenerySelection =
  | { readonly kind: "feature"; readonly id: string }
  | { readonly kind: "building"; readonly index: number }
  | { readonly kind: "ramp"; readonly id: string };

export const OUTSIDE_AREA_REASON = "That spot is outside the map area";
export const ON_ROAD_REASON = "That spot is on a road. Place scenery beside it.";
export const BUILDING_TOO_SMALL = "Building too small, drag a larger footprint";
export const LINE_TOO_FEW_POINTS = "A line needs at least 2 points";
export const lineTooManyPoints = (max: number): string => `A line can have at most ${max} points`;

/** Line samples are at most this far apart when testing for road paint. */
export const LINE_SAMPLE_STEP_M = 0.5;
/** Buildings sink this far below their lowest corner so no corner floats (Pitfall 9). */
export const BUILDING_SINK_M = 0.3;
export const MIN_BUILDING_SIDE_M = 1;

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

const OK: PlaceCheck = { ok: true };

function insideExtent(area: PlaceArea, x: number, z: number): boolean {
  const e = terrainGridExtent(area.grid);
  return x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ;
}

/** True when (x, z) is inside the grid extent. */
export function insideArea(area: PlaceArea, x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z) && insideExtent(area, x, z);
}

/** D-12: scenery never goes on road paint or outside the area. */
export function canPlaceAt(area: PlaceArea, x: number, z: number): PlaceCheck {
  if (!insideArea(area, x, z)) return { ok: false, reason: OUTSIDE_AREA_REASON };
  if (isRoadAt(area.paint, x, z)) return { ok: false, reason: ON_ROAD_REASON };
  return OK;
}

/** D-12 for lines: every sample (at most 0.5 m apart) must be clear of road and inside the area. */
export function canPlaceLine(
  area: PlaceArea,
  points: readonly (readonly [number, number])[],
): PlaceCheck {
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as readonly [number, number];
    const first = canPlaceAt(area, a[0], a[1]);
    if (!first.ok) return first;
    const b = points[i + 1];
    if (b === undefined) continue;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(dist / LINE_SAMPLE_STEP_M));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const c = canPlaceAt(area, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (!c.ok) return c;
    }
  }
  return OK;
}

// ---------------------------------------------------------------- features

const FEATURE_ID = /^f-(\d+)$/;

/** Next id counter: max numeric suffix + 1. In-session ids are never reused after a delete. */
export function featureIdSeed(features: readonly TerrainFeature[]): number {
  let max = 0;
  for (const f of features) {
    const m = FEATURE_ID.exec(f.id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

const PLURAL: Record<SceneryKind, string> = {
  tree: "trees",
  bush: "bushes",
  hedge: "hedges",
  fence: "fences",
};

export const limitReached = (kind: SceneryKind, max: number): string =>
  `Limit reached: ${max} ${PLURAL[kind]} per map. Delete some to place more`;

export type FeatureAdd =
  | { features: TerrainFeature[]; nextSeed: number; error?: undefined }
  | { error: string; features?: undefined; nextSeed?: undefined };

export interface PointFeatureSpec {
  kind: "tree" | "bush";
  variant: string;
  x: number;
  z: number;
  rotationY?: number;
  scale?: number;
}

function clampScale(s: number): number {
  return Math.min(MAX_FEATURE_SCALE, Math.max(MIN_FEATURE_SCALE, s));
}

export function addPointFeature(
  features: readonly TerrainFeature[],
  seed: number,
  spec: PointFeatureSpec,
): FeatureAdd {
  let count = 0;
  for (const f of features) if (!("points" in f)) count++;
  if (count >= MAX_POINT_FEATURES) {
    return { error: limitReached(spec.kind, MAX_POINT_FEATURES) };
  }
  const entry: TerrainPointFeature = {
    id: `f-${seed}`,
    kind: spec.kind,
    variant: spec.variant,
    x: spec.x,
    z: spec.z,
    rotationY: spec.rotationY ?? 0,
    scale: clampScale(spec.scale ?? 1),
  };
  return { features: [...features, entry], nextSeed: seed + 1 };
}

export interface LineFeatureSpec {
  kind: "hedge" | "fence";
  variant: string;
  points: readonly (readonly [number, number])[];
  heightM: number;
}

export function addLineFeature(
  features: readonly TerrainFeature[],
  seed: number,
  spec: LineFeatureSpec,
): FeatureAdd {
  if (spec.points.length < 2) return { error: LINE_TOO_FEW_POINTS };
  if (spec.points.length > MAX_LINE_POINTS) return { error: lineTooManyPoints(MAX_LINE_POINTS) };
  let count = 0;
  for (const f of features) if ("points" in f) count++;
  if (count >= MAX_LINE_FEATURES) return { error: limitReached(spec.kind, MAX_LINE_FEATURES) };
  const entry: TerrainLineFeature = {
    id: `f-${seed}`,
    kind: spec.kind,
    variant: spec.variant,
    points: spec.points.map((p) => [p[0], p[1]] as const),
    heightM: spec.heightM,
  };
  return { features: [...features, entry], nextSeed: seed + 1 };
}

function mapFeature(
  features: readonly TerrainFeature[],
  id: string,
  fn: (f: TerrainFeature) => TerrainFeature,
): readonly TerrainFeature[] {
  const i = features.findIndex((f) => f.id === id);
  if (i < 0) return features;
  return features.map((f, k) => (k === i ? fn(f) : f));
}

/** Shifts a point feature, or every point of a line. Unknown id returns the same reference. */
export function moveFeature(
  features: readonly TerrainFeature[],
  id: string,
  dx: number,
  dz: number,
): readonly TerrainFeature[] {
  return mapFeature(features, id, (f) =>
    "points" in f
      ? { ...f, points: f.points.map((p) => [p[0] + dx, p[1] + dz] as const) }
      : { ...f, x: f.x + dx, z: f.z + dz },
  );
}

/** Sets a point feature's rotation. Lines and unknown ids return the same reference. */
export function rotateFeature(
  features: readonly TerrainFeature[],
  id: string,
  rotationY: number,
): readonly TerrainFeature[] {
  const f = features.find((x) => x.id === id);
  if (f === undefined || "points" in f) return features;
  return mapFeature(features, id, (p) => ({ ...p, rotationY }) as TerrainFeature);
}

/** Sets a point feature's scale, clamped to 0.5..2. Lines and unknown ids return the same reference. */
export function scaleFeature(
  features: readonly TerrainFeature[],
  id: string,
  scale: number,
): readonly TerrainFeature[] {
  const f = features.find((x) => x.id === id);
  if (f === undefined || "points" in f) return features;
  return mapFeature(features, id, (p) => ({ ...p, scale: clampScale(scale) }) as TerrainFeature);
}

export function deleteFeature(
  features: readonly TerrainFeature[],
  id: string,
): readonly TerrainFeature[] {
  const i = features.findIndex((f) => f.id === id);
  if (i < 0) return features;
  return features.filter((_, k) => k !== i);
}

// ---------------------------------------------------------------- buildings

/** Footprint corners (world x, z) of a box rotated by rotationY (three.js Y rotation). */
export function footprintCorners(
  x: number,
  z: number,
  hx: number,
  hz: number,
  rotationY: number,
): [number, number][] {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const out: [number, number][] = [];
  for (const [lx, lz] of [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ] as const) {
    out.push([x + lx * c + lz * s, z - lx * s + lz * c]);
  }
  return out;
}

export interface BuildingSpec {
  x: number;
  z: number;
  widthM: number;
  depthM: number;
  heightM: number;
  rotationY: number;
  style?: string;
}

export type SeatResult =
  | { building: TerrainBuilding; error?: undefined }
  | { error: string; building?: undefined };

/**
 * Seats a building on the terrain: samples the four corners and the centre, then
 * top = highest + heightM and bottom = lowest - 0.3. No corner floats and the
 * high side shows the full height (brief 02 stage 6 step 3, research Pitfall 9).
 */
export function seatBuilding(heightAt: HeightFn, spec: BuildingSpec): SeatResult {
  if (!(spec.widthM >= MIN_BUILDING_SIDE_M) || !(spec.depthM >= MIN_BUILDING_SIDE_M)) {
    return { error: BUILDING_TOO_SMALL };
  }
  const hx = spec.widthM / 2;
  const hz = spec.depthM / 2;
  const samples = footprintCorners(spec.x, spec.z, hx, hz, spec.rotationY).map(([x, z]) =>
    heightAt(x, z),
  );
  samples.push(heightAt(spec.x, spec.z));
  const top = Math.max(...samples) + spec.heightM;
  const bottom = Math.min(...samples) - BUILDING_SINK_M;
  const building: TerrainBuilding = {
    center: { x: spec.x, y: (top + bottom) / 2, z: spec.z },
    halfExtents: { x: hx, y: (top - bottom) / 2, z: hz },
    rotationY: spec.rotationY,
    ...(spec.style !== undefined ? { style: spec.style } : {}),
  };
  return { building };
}

// ---------------------------------------------------------------- ramps

/** Foot radius of palette ramps; the same value the authored feel-test ramps use (D-14). */
export const RAMP_FOOT_RADIUS_M = 150;

export interface RampParams {
  heightM: number;
  angleDeg: number;
  widthM: number;
  footRadiusM?: number;
}

const RAMP_ID = /^ramp-(\d+)$/;

/** Next free "ramp-<n>": above every existing numeric ramp id, and never equal to any crest id. */
export function nextRampId(objects: readonly TerrainObject[]): string {
  const taken = new Set(objects.map((o) => o.crest.id));
  let n = 1;
  for (const o of objects) {
    const m = RAMP_ID.exec(o.crest.id);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  while (taken.has(`ramp-${n}`)) n++;
  return `ramp-${n}`;
}

/** Appends one ordinary crest object with a ramp spec. (x, z) is the START of the foot. */
export function addRampObject(
  objects: readonly TerrainObject[],
  x: number,
  z: number,
  headingRad: number,
  params: RampParams,
): TerrainObject[] {
  const crest: AuthoredCrest = {
    id: nextRampId(objects),
    centerX: x,
    centerZ: z,
    radiusM: 0,
    heightM: params.heightM,
    ramp: {
      headingRad,
      widthM: params.widthM,
      angleDeg: params.angleDeg,
      footRadiusM: params.footRadiusM ?? RAMP_FOOT_RADIUS_M,
    },
  };
  return [...objects, { kind: "crest", crest }];
}

export function deleteRamp(
  objects: readonly TerrainObject[],
  id: string,
): readonly TerrainObject[] {
  const i = objects.findIndex((o) => o.crest.id === id);
  if (i < 0) return objects;
  return objects.filter((_, k) => k !== i);
}

export function deleteBuilding(
  buildings: readonly TerrainBuilding[],
  index: number,
): readonly TerrainBuilding[] {
  if (index < 0 || index >= buildings.length) return buildings;
  return buildings.filter((_, k) => k !== index);
}

// ---------------------------------------------------------------- scatter

export interface ScatterSpec {
  cx: number;
  cz: number;
  radiusM: number;
  densityPer100m2: number;
  seed: number;
}

/** Points inside the circle; same seed gives the same points, so preview equals commit. */
export function scatterPoints(spec: ScatterSpec): { x: number; z: number }[] {
  const area = Math.PI * spec.radiusM * spec.radiusM;
  const count = Math.max(0, Math.round((area / 100) * spec.densityPer100m2));
  let state = spec.seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = spec.radiusM * Math.sqrt(next());
    const a = next() * Math.PI * 2;
    out.push({ x: spec.cx + r * Math.cos(a), z: spec.cz + r * Math.sin(a) });
  }
  return out;
}

// ---------------------------------------------------------------- box delete

export interface RemoveResult {
  features: readonly TerrainFeature[];
  buildings: readonly TerrainBuilding[];
  removedFeatures: number;
  removedBuildings: number;
}

/**
 * Removes point features inside the mask, lines with any vertex inside, and buildings
 * whose centre is inside. Unchanged arrays keep their reference.
 */
export function removeInMask(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  inMask: (x: number, z: number) => boolean,
): RemoveResult {
  const keepF = features.filter((f) =>
    "points" in f ? !f.points.some((p) => inMask(p[0], p[1])) : !inMask(f.x, f.z),
  );
  const keepB = buildings.filter((b) => !inMask(b.center.x, b.center.z));
  return {
    features: keepF.length === features.length ? features : keepF,
    buildings: keepB.length === buildings.length ? buildings : keepB,
    removedFeatures: features.length - keepF.length,
    removedBuildings: buildings.length - keepB.length,
  };
}

// ---------------------------------------------------------------- picking

function distToSegment(
  px: number,
  pz: number,
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

function insideRotatedBox(b: TerrainBuilding, x: number, z: number): boolean {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  const ox = x - b.center.x;
  const oz = z - b.center.z;
  const lx = ox * c - oz * s;
  const lz = ox * s + oz * c;
  return Math.abs(lx) <= b.halfExtents.x && Math.abs(lz) <= b.halfExtents.z;
}

/** Nearest hit within radiusM (buildings: inside the rotated footprint, distance 0). */
export function pickFeatureAt(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  objects: readonly TerrainObject[],
  x: number,
  z: number,
  radiusM: number,
): ScenerySelection | undefined {
  let best: ScenerySelection | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  const consider = (d: number, sel: ScenerySelection): void => {
    if (d < bestD) {
      bestD = d;
      best = sel;
    }
  };
  for (const f of features) {
    if ("points" in f) {
      for (let i = 0; i + 1 < f.points.length; i++) {
        const a = f.points[i] as readonly [number, number];
        const b = f.points[i + 1] as readonly [number, number];
        const d = distToSegment(x, z, a, b);
        if (d <= radiusM) consider(d, { kind: "feature", id: f.id });
      }
    } else {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d <= radiusM) consider(d, { kind: "feature", id: f.id });
    }
  }
  buildings.forEach((b, index) => {
    if (insideRotatedBox(b, x, z)) consider(0, { kind: "building", index });
  });
  for (const o of objects) {
    if (o.crest.ramp === undefined) continue;
    const d = Math.hypot(x - o.crest.centerX, z - o.crest.centerZ);
    if (d <= radiusM) consider(d, { kind: "ramp", id: o.crest.id });
  }
  return best;
}
