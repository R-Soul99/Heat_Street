// Pure scenery edit operations (07.1.3 D-07, D-12, D-14, D-16). No DOM, no three.
// Every function returns NEW arrays and never mutates its inputs or the elements in
// them (undo snapshots share element objects). editor.ts only routes input to these.

import { type AuthoredCrest, rampBaseY, rampLengthM } from "../../src/core/crest-geometry.ts";
import { resolveVariant, type SceneryKind } from "../../src/core/scenery-catalog.ts";
import { lineSegments } from "../../src/core/scenery-geometry.ts";
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
import { MAX_AREA_SIZE_M } from "../../src/core/terrain-limits.ts";
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

/** Footprint samples are never closer than this, whatever the paint resolution. */
const FOOTPRINT_MIN_STEP_M = 0.25;

/**
 * D-12 for a building footprint: the whole rectangle must be inside the area and clear of
 * road paint. The corners and centre are tested first, then the edges and interior on a grid
 * no coarser than one paint pixel, so a road passing between the corners is still seen.
 * Place, move and rotate all use this one check.
 */
export function canPlaceFootprint(
  area: PlaceArea,
  x: number,
  z: number,
  hx: number,
  hz: number,
  rotationY: number,
): PlaceCheck {
  const centre = canPlaceAt(area, x, z);
  if (!centre.ok) return centre;
  for (const [px, pz] of footprintCorners(x, z, hx, hz, rotationY)) {
    const corner = canPlaceAt(area, px, pz);
    if (!corner.ok) return corner;
  }
  const step = Math.max(FOOTPRINT_MIN_STEP_M, area.paint.metresPerPixel);
  const nx = Math.max(1, Math.ceil((2 * hx) / step));
  const nz = Math.max(1, Math.ceil((2 * hz) / step));
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  for (let i = 0; i <= nx; i++) {
    const lx = -hx + (2 * hx * i) / nx;
    for (let k = 0; k <= nz; k++) {
      const lz = -hz + (2 * hz * k) / nz;
      // Same local-to-world transform as footprintCorners.
      if (isRoadAt(area.paint, x + lx * c + lz * s, z - lx * s + lz * c)) {
        return { ok: false, reason: ON_ROAD_REASON };
      }
    }
  }
  return OK;
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

// ---------------------------------------------------------------- keyboard rotation

/** Left/Right turn a selected item by this much; Shift+Left/Right by the fine step. */
export const ROTATE_STEP_DEG = 15;
export const ROTATE_FINE_STEP_DEG = 1;

/**
 * Signed turn in degrees for an arrow key: Left is positive (counter-clockwise seen from
 * above), Right is negative, Shift selects the 1 degree step. Any other key is undefined.
 */
export function arrowRotateDeg(code: string, shiftKey: boolean): number | undefined {
  if (code !== "ArrowLeft" && code !== "ArrowRight") return undefined;
  const step = shiftKey ? ROTATE_FINE_STEP_DEG : ROTATE_STEP_DEG;
  return code === "ArrowLeft" ? step : -step;
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

/** The ramp values the sidebar and arrow keys can change after placement. */
export interface RampPatch {
  readonly heightM?: number;
  readonly angleDeg?: number;
  readonly widthM?: number;
  readonly headingRad?: number;
}

export const RAMP_TOO_LONG = "That ramp would be longer than the map area allows";

export type RampEdit =
  | { ok: true; objects: readonly TerrainObject[] }
  | { ok: false; reason: string };

export const RAMP_OUTSIDE_REASON = "That ramp would reach outside the map area";

/**
 * A ramp may sit on road paint (D-14) but its whole body must be inside the map area: the
 * start of the foot and all four corners of its footprint (it runs rampLengthM along its
 * heading). Place, move, rotate and the sidebar values all use this one check.
 */
export function canPlaceRamp(area: PlaceArea, crest: AuthoredCrest): PlaceCheck {
  if (!insideArea(area, crest.centerX, crest.centerZ)) {
    return { ok: false, reason: OUTSIDE_AREA_REASON };
  }
  const fp = rampFootprint(crest);
  for (const [x, z] of footprintCorners(fp.cx, fp.cz, fp.hx, fp.hz, fp.rotationY)) {
    if (!insideArea(area, x, z)) return { ok: false, reason: RAMP_OUTSIDE_REASON };
  }
  return OK;
}

/**
 * Changes one ramp's height, angle, width or heading. The foot radius and position are kept.
 * With `area`, a change that would push the ramp outside the map is refused. A ramp that
 * already reaches outside (an older map) can still be made shorter or narrower on the same
 * heading, so it can be brought back in step by step.
 */
export function updateRamp(
  objects: readonly TerrainObject[],
  id: string,
  patch: RampPatch,
  area?: PlaceArea,
): RampEdit {
  const o = objects.find((v) => v.crest.id === id && v.crest.ramp !== undefined);
  if (o === undefined || o.crest.ramp === undefined)
    return { ok: false, reason: "Nothing selected" };
  const ramp = {
    ...o.crest.ramp,
    ...(patch.widthM !== undefined ? { widthM: patch.widthM } : {}),
    ...(patch.angleDeg !== undefined ? { angleDeg: patch.angleDeg } : {}),
    ...(patch.headingRad !== undefined ? { headingRad: patch.headingRad } : {}),
  };
  const heightM = patch.heightM ?? o.crest.heightM;
  if (rampLengthM(heightM, ramp) > MAX_AREA_SIZE_M) return { ok: false, reason: RAMP_TOO_LONG };
  const crest: AuthoredCrest = { ...o.crest, heightM, ramp };
  if (area !== undefined) {
    const check = canPlaceRamp(area, crest);
    if (!check.ok) {
      const old = o.crest.ramp;
      const noWorse =
        !canPlaceRamp(area, o.crest).ok &&
        ramp.headingRad === old.headingRad &&
        ramp.widthM <= old.widthM &&
        rampLengthM(heightM, ramp) <= rampLengthM(o.crest.heightM, old);
      if (!noWorse) return check;
    }
  }
  return { ok: true, objects: objects.map((v) => (v === o ? { kind: "crest", crest } : v)) };
}

export function deleteRamp(
  objects: readonly TerrainObject[],
  id: string,
): readonly TerrainObject[] {
  const i = objects.findIndex((o) => o.crest.id === id);
  if (i < 0) return objects;
  return objects.filter((_, k) => k !== i);
}

export const LEGACY_BUILDING_REASON =
  "That building comes from the map model and cannot be changed here";

/**
 * False for a style-less building on a legacy GLB map: it is the collision box of a mesh
 * baked into the map model, which the game draws from the GLB. Moving, turning or removing
 * the box would leave the car hitting nothing it can see, so every edit path skips it.
 * Styled (palette-placed) buildings are editable on every map.
 */
export function isEditableBuilding(b: TerrainBuilding, legacyGlbBuildings: boolean): boolean {
  return !(legacyGlbBuildings && b.style === undefined);
}

/** Removes one building. A read-only legacy box (see isEditableBuilding) is kept. */
export function deleteBuilding(
  buildings: readonly TerrainBuilding[],
  index: number,
  legacyGlbBuildings = false,
): readonly TerrainBuilding[] {
  const b = buildings[index];
  if (b === undefined || !isEditableBuilding(b, legacyGlbBuildings)) return buildings;
  return buildings.filter((_, k) => k !== index);
}

/**
 * Buildings have no id in the map format, so a building selection is an array index plus the
 * building object it was made on. This finds where that building is NOW, or -1 when it is
 * gone, so a selection can never silently move to a different building after undo, redo or
 * a delete shifts the array:
 *  - the same object still at the index: unchanged;
 *  - the same object at another index (undo put an earlier building back): the new index;
 *  - a new object at the index with the same footprint, turn and style (a sculpt re-seated
 *    it, only its height changed): still that building;
 *  - anything else: -1.
 */
export function resolveBuildingIndex(
  buildings: readonly TerrainBuilding[],
  index: number,
  ref: TerrainBuilding,
): number {
  if (buildings[index] === ref) return index;
  const at = buildings.indexOf(ref);
  if (at >= 0) return at;
  const b = buildings[index];
  if (
    b !== undefined &&
    b.center.x === ref.center.x &&
    b.center.z === ref.center.z &&
    b.halfExtents.x === ref.halfExtents.x &&
    b.halfExtents.z === ref.halfExtents.z &&
    b.rotationY === ref.rotationY &&
    b.style === ref.style
  ) {
    return index;
  }
  return -1;
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
 * whose centre is inside. Read-only legacy boxes (see isEditableBuilding) are always kept.
 * Unchanged arrays keep their reference.
 */
export function removeInMask(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  inMask: (x: number, z: number) => boolean,
  legacyGlbBuildings = false,
): RemoveResult {
  const keepF = features.filter((f) =>
    "points" in f ? !f.points.some((p) => inMask(p[0], p[1])) : !inMask(f.x, f.z),
  );
  const keepB = buildings.filter(
    (b) => !isEditableBuilding(b, legacyGlbBuildings) || !inMask(b.center.x, b.center.z),
  );
  return {
    features: keepF.length === features.length ? features : keepF,
    buildings: keepB.length === buildings.length ? buildings : keepB,
    removedFeatures: features.length - keepF.length,
    removedBuildings: buildings.length - keepB.length,
  };
}

// ---------------------------------------------------------------- picking

/**
 * Ground footprint of a ramp as an oriented rectangle in the box frame used by the pick tests.
 * A ramp's (centerX, centerZ) is the START of its foot; it runs rampLengthM along its heading
 * (0 = +x, +pi/2 = +z), so the box centre is half a length along and the box yaw is -heading.
 */
export function rampFootprint(crest: AuthoredCrest): {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rotationY: number;
} {
  const ramp = crest.ramp;
  if (ramp === undefined) {
    return { cx: crest.centerX, cz: crest.centerZ, hx: 0, hz: 0, rotationY: 0 };
  }
  const len = rampLengthM(crest.heightM, ramp);
  return {
    cx: crest.centerX + (Math.cos(ramp.headingRad) * len) / 2,
    cz: crest.centerZ + (Math.sin(ramp.headingRad) * len) / 2,
    hx: len / 2,
    hz: ramp.widthM / 2,
    rotationY: -ramp.headingRad,
  };
}

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

/**
 * Nearest hit within radiusM (buildings: inside the rotated footprint, distance 0).
 * Read-only legacy boxes (see isEditableBuilding) are never picked.
 */
export function pickFeatureAt(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  objects: readonly TerrainObject[],
  x: number,
  z: number,
  radiusM: number,
  legacyGlbBuildings = false,
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
    if (!isEditableBuilding(b, legacyGlbBuildings)) return;
    if (insideRotatedBox(b, x, z)) consider(0, { kind: "building", index });
  });
  for (const o of objects) {
    if (o.crest.ramp === undefined) continue;
    // The whole ramp footprint is clickable, not just its start point.
    const { cx, cz, hx, hz, rotationY } = rampFootprint(o.crest);
    const c = Math.cos(rotationY);
    const s = Math.sin(rotationY);
    const ox = x - cx;
    const oz = z - cz;
    const lx = ox * c - oz * s;
    const lz = ox * s + oz * c;
    const dx = Math.max(Math.abs(lx) - hx, 0);
    const dz = Math.max(Math.abs(lz) - hz, 0);
    const d = Math.hypot(dx, dz);
    if (d <= radiusM) consider(d, { kind: "ramp", id: o.crest.id });
  }
  return best;
}

// ---------------------------------------------------------------- ray picking

/** A world-space ray (direction need not be unit length). */
export interface PickRay {
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
}

interface PickBox {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  readonly rotationY: number;
}

/** Ray against a Y-rotated box (slab test in the box frame). Returns the entry t, or undefined. */
function rayHitsBox(r: PickRay, b: PickBox): number | undefined {
  const c = Math.cos(b.rotationY);
  const s = Math.sin(b.rotationY);
  const ox = r.ox - b.cx;
  const oz = r.oz - b.cz;
  const o = [ox * c - oz * s, r.oy - b.cy, ox * s + oz * c];
  const d = [r.dx * c - r.dz * s, r.dy, r.dx * s + r.dz * c];
  const h = [b.hx, b.hy, b.hz];
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const oi = o[i] as number;
    const di = d[i] as number;
    const hi = h[i] as number;
    if (Math.abs(di) < 1e-9) {
      if (Math.abs(oi) > hi) return undefined;
      continue;
    }
    let t0 = (-hi - oi) / di;
    let t1 = (hi - oi) / di;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return undefined;
  }
  return tMin;
}

/** Visible bounds of one feature as boxes (display-size, a little generous for easy clicking). */
function featurePickBoxes(f: TerrainFeature, heightAt: HeightFn): PickBox[] {
  if ("points" in f) {
    const out: PickBox[] = [];
    for (const s of lineSegments(f.points, heightAt, f.heightM, 0.6)) {
      out.push({
        cx: s.x,
        cy: s.y + f.heightM / 2,
        cz: s.z,
        hx: s.lengthM / 2,
        hy: f.heightM / 2 + 0.1,
        hz: 0.4,
        rotationY: s.rotationY,
      });
    }
    return out;
  }
  const y = heightAt(f.x, f.z);
  if (f.kind === "bush") {
    const v = resolveVariant("bush", f.variant);
    if (v === undefined) return [];
    const r = v.radiusM * f.scale;
    const h = v.heightM * f.scale;
    return [{ cx: f.x, cy: y + h / 2, cz: f.z, hx: r, hy: h / 2, hz: r, rotationY: 0 }];
  }
  const v = resolveVariant("tree", f.variant);
  if (v === undefined) return [];
  const s = f.scale;
  const trunkH = v.trunkHeightM * s;
  const tr = Math.max(v.trunkRadiusM * s, 0.4);
  const boxes: PickBox[] = [
    { cx: f.x, cy: y + trunkH / 2, cz: f.z, hx: tr, hy: trunkH / 2, hz: tr, rotationY: 0 },
  ];
  if (v.canopy.shape !== "none") {
    const h = v.canopy.heightM * s;
    const r = v.canopy.radiusM * s;
    boxes.push({ cx: f.x, cy: y + trunkH + h / 2, cz: f.z, hx: r, hy: h / 2, hz: r, rotationY: 0 });
  }
  return boxes;
}

/**
 * Picks the placed item the ray hits first: trees by trunk and canopy, bushes by body, lines by
 * their full height, buildings by their box, ramps by their footprint box. Anything the ray
 * misses falls back to the ground-distance test at `ground` (the terrain hit under the cursor).
 * Read-only legacy boxes (see isEditableBuilding) are never picked.
 */
export function pickFeatureByRay(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  objects: readonly TerrainObject[],
  heightAt: HeightFn,
  ray: PickRay,
  ground: { readonly x: number; readonly z: number } | null,
  radiusM: number,
  legacyGlbBuildings = false,
): ScenerySelection | undefined {
  let best: ScenerySelection | undefined;
  let bestT = Number.POSITIVE_INFINITY;
  const consider = (t: number | undefined, sel: ScenerySelection): void => {
    if (t !== undefined && t < bestT) {
      bestT = t;
      best = sel;
    }
  };
  for (const f of features) {
    for (const b of featurePickBoxes(f, heightAt))
      consider(rayHitsBox(ray, b), { kind: "feature", id: f.id });
  }
  buildings.forEach((b, index) => {
    if (!isEditableBuilding(b, legacyGlbBuildings)) return;
    consider(
      rayHitsBox(ray, {
        cx: b.center.x,
        cy: b.center.y,
        cz: b.center.z,
        hx: b.halfExtents.x,
        hy: b.halfExtents.y,
        hz: b.halfExtents.z,
        rotationY: b.rotationY,
      }),
      { kind: "building", index },
    );
  });
  for (const o of objects) {
    if (o.crest.ramp === undefined) continue;
    const fp = rampFootprint(o.crest);
    const len = rampLengthM(o.crest.heightM, o.crest.ramp);
    const hd = o.crest.ramp.headingRad;
    const lipY = heightAt(
      o.crest.centerX + Math.cos(hd) * len,
      o.crest.centerZ + Math.sin(hd) * len,
    );
    const bottom =
      Math.min(heightAt(o.crest.centerX, o.crest.centerZ), heightAt(fp.cx, fp.cz), lipY) - 0.2;
    const top = rampBaseY(o.crest, heightAt) + o.crest.heightM + 0.2;
    const h = Math.max(0.2, top - bottom);
    consider(
      rayHitsBox(ray, {
        cx: fp.cx,
        cy: bottom + h / 2,
        cz: fp.cz,
        hx: fp.hx,
        hy: h / 2,
        hz: fp.hz,
        rotationY: fp.rotationY,
      }),
      { kind: "ramp", id: o.crest.id },
    );
  }
  if (best !== undefined) return best;
  if (ground === null) return undefined;
  return pickFeatureAt(
    features,
    buildings,
    objects,
    ground.x,
    ground.z,
    radiusM,
    legacyGlbBuildings,
  );
}
