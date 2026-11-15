/**
 * 07.1.3 stages 2-3: pure scenery geometry. Turns sidecar features plus a ground-height sampler into
 * collider specs (physics) and instance transforms (render), so both read the same numbers.
 *
 * Plain data only: no three, rapier or DOM (tests/layering.test.ts enforces this).
 */
import {
  resolveBuildingStyle,
  resolveVariant,
  SCENERY_TRIANGLES,
  type SceneryKind,
  solidityOf,
} from "./scenery-catalog";
import type { TerrainBuilding, TerrainFeature } from "./terrain-format";

/** Longest single hedge/fence segment (metres). */
export const MAX_SEGMENT_M = 8;
/** Line colliders extend this far below the average ground height so no end floats on a slope. */
export const LINE_SINK_M = 0.3;
/** Thin fences get a collider at least this thick so a fast car cannot tunnel through a tick. */
export const MIN_LINE_COLLIDER_THICKNESS_M = 0.4;
/** D-09: the single scenery triangle budget the editor enforces. */
export const MAX_SCENERY_TRIANGLES = 40000;

const EPS_M = 1e-6;

export type HeightSampler = (x: number, z: number) => number;

export type ColliderSpec =
  | {
      readonly shape: "cylinder";
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly halfHeight: number;
      readonly radius: number;
      readonly blocksSight: boolean;
      readonly kind: SceneryKind;
    }
  | {
      readonly shape: "cuboid";
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly hx: number;
      readonly hy: number;
      readonly hz: number;
      readonly rotationY: number;
      readonly blocksSight: boolean;
      readonly kind: SceneryKind;
    };

export interface InstanceTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotationY: number;
  readonly scale: number;
}

export interface SegmentBox {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lengthM: number;
  readonly heightM: number;
  readonly widthM: number;
  readonly rotationY: number;
  readonly variant: string;
}

export interface SceneryInstances {
  readonly trees: { readonly variant: string; readonly transforms: InstanceTransform[] }[];
  readonly bushes: { readonly variant: string; readonly transforms: InstanceTransform[] }[];
  readonly hedges: SegmentBox[];
  readonly fenceRails: SegmentBox[];
  readonly fencePosts: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly heightM: number;
    readonly sizeM: number;
    readonly variant: string;
  }[];
}

export interface BuildingBox {
  readonly style: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  readonly rotationY: number;
  readonly roof: "pitched" | "flat";
}

/** One straight piece of a line feature. `y` is the average of the two end ground heights. */
export interface LineSegment {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lengthM: number;
  readonly rotationY: number;
  readonly startX: number;
  readonly startZ: number;
  readonly startY: number;
  readonly heightM: number;
  readonly widthM: number;
}

function splitCount(distM: number): number {
  if (distM < EPS_M) return 0;
  return Math.ceil(distM / MAX_SEGMENT_M - 1e-9);
}

/** Splits a polyline into equal pieces of at most MAX_SEGMENT_M; zero-length pieces are dropped. */
export function lineSegments(
  points: readonly (readonly [number, number])[],
  heightAt: HeightSampler,
  heightM: number,
  widthM: number,
): LineSegment[] {
  const out: LineSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const dist = Math.hypot(dx, dz);
    const n = splitCount(dist);
    for (let k = 0; k < n; k++) {
      const x0 = a[0] + (dx * k) / n;
      const z0 = a[1] + (dz * k) / n;
      const x1 = a[0] + (dx * (k + 1)) / n;
      const z1 = a[1] + (dz * (k + 1)) / n;
      const y0 = heightAt(x0, z0);
      const y1 = heightAt(x1, z1);
      out.push({
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        z: (z0 + z1) / 2,
        lengthM: dist / n,
        rotationY: Math.atan2(-dz, dx),
        startX: x0,
        startZ: z0,
        startY: y0,
        heightM,
        widthM,
      });
    }
  }
  return out;
}

export function featureColliders(
  features: readonly TerrainFeature[],
  heightAt: HeightSampler,
): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  for (const f of features) {
    const solid = solidityOf(f.kind);
    if (solid === undefined || !solid.solid) continue;
    if ("points" in f) {
      if (f.kind === "hedge") {
        const v = resolveVariant("hedge", f.variant);
        if (v === undefined) continue;
        for (const s of lineSegments(f.points, heightAt, f.heightM, v.widthM)) {
          out.push(lineCollider(s, "hedge", solid.blocksSight));
        }
      } else {
        const v = resolveVariant("fence", f.variant);
        if (v === undefined) continue;
        for (const s of lineSegments(f.points, heightAt, f.heightM, v.thicknessM)) {
          out.push(lineCollider(s, "fence", solid.blocksSight));
        }
      }
    } else if (f.kind === "tree") {
      const v = resolveVariant("tree", f.variant);
      if (v === undefined) continue;
      const h = v.trunkHeightM * f.scale;
      out.push({
        shape: "cylinder",
        x: f.x,
        y: heightAt(f.x, f.z) + h / 2,
        z: f.z,
        halfHeight: h / 2,
        radius: v.trunkRadiusM * f.scale,
        blocksSight: solid.blocksSight,
        kind: "tree",
      });
    }
  }
  return out;
}

function lineCollider(s: LineSegment, kind: "hedge" | "fence", blocksSight: boolean): ColliderSpec {
  const hy = (s.heightM + LINE_SINK_M) / 2;
  return {
    shape: "cuboid",
    x: s.x,
    y: s.y - LINE_SINK_M + hy,
    z: s.z,
    hx: s.lengthM / 2,
    hy,
    hz: Math.max(s.widthM, MIN_LINE_COLLIDER_THICKNESS_M) / 2,
    rotationY: s.rotationY,
    blocksSight,
    kind,
  };
}

export function featureInstances(
  features: readonly TerrainFeature[],
  heightAt: HeightSampler,
): SceneryInstances {
  const trees = new Map<string, InstanceTransform[]>();
  const bushes = new Map<string, InstanceTransform[]>();
  const hedges: SegmentBox[] = [];
  const fenceRails: SegmentBox[] = [];
  const fencePosts: SceneryInstances["fencePosts"] = [];

  for (const f of features) {
    if ("points" in f) {
      if (f.kind === "hedge") {
        const v = resolveVariant("hedge", f.variant);
        if (v === undefined) continue;
        for (const s of lineSegments(f.points, heightAt, f.heightM, v.widthM)) {
          hedges.push({
            x: s.x,
            y: s.y + f.heightM / 2,
            z: s.z,
            lengthM: s.lengthM,
            heightM: f.heightM,
            widthM: v.widthM,
            rotationY: s.rotationY,
            variant: f.variant,
          });
        }
      } else {
        const v = resolveVariant("fence", f.variant);
        if (v === undefined) continue;
        const segs = lineSegments(f.points, heightAt, f.heightM, v.thicknessM);
        const rail = f.variant === "post-rail";
        for (const s of segs) {
          fenceRails.push({
            x: s.x,
            y: rail ? s.y + f.heightM * 0.7 : s.y + f.heightM / 2,
            z: s.z,
            lengthM: s.lengthM,
            heightM: rail ? 0.3 : f.heightM,
            widthM: v.thicknessM,
            rotationY: s.rotationY,
            variant: f.variant,
          });
          fencePosts.push({
            x: s.startX,
            y: s.startY,
            z: s.startZ,
            heightM: f.heightM,
            sizeM: v.postSizeM,
            variant: f.variant,
          });
        }
        const last = f.points[f.points.length - 1];
        if (segs.length > 0 && last !== undefined) {
          fencePosts.push({
            x: last[0],
            y: heightAt(last[0], last[1]),
            z: last[1],
            heightM: f.heightM,
            sizeM: v.postSizeM,
            variant: f.variant,
          });
        }
      }
    } else {
      const target = f.kind === "tree" ? trees : bushes;
      if (resolveVariant(f.kind, f.variant) === undefined) continue;
      let list = target.get(f.variant);
      if (list === undefined) {
        list = [];
        target.set(f.variant, list);
      }
      list.push({
        x: f.x,
        y: heightAt(f.x, f.z),
        z: f.z,
        rotationY: f.rotationY,
        scale: f.scale,
      });
    }
  }

  const group = (m: Map<string, InstanceTransform[]>) =>
    [...m.entries()].map(([variant, transforms]) => ({ variant, transforms }));
  return { trees: group(trees), bushes: group(bushes), hedges, fenceRails, fencePosts };
}

/** Buildings grouped by style id. Style-less buildings sit under "" only when includeStyleless. */
export function buildingBoxes(
  buildings: readonly TerrainBuilding[],
  opts: { includeStyleless: boolean },
): Record<string, BuildingBox[]> {
  const out: Record<string, BuildingBox[]> = {};
  for (const b of buildings) {
    let key = "";
    let roof: "pitched" | "flat" = "flat";
    if (b.style !== undefined) {
      const style = resolveBuildingStyle(b.style);
      if (style === undefined) continue;
      key = style.id;
      roof = style.roof;
    } else if (!opts.includeStyleless) {
      continue;
    }
    const list = out[key] ?? [];
    out[key] = list;
    list.push({
      style: key,
      x: b.center.x,
      y: b.center.y,
      z: b.center.z,
      hx: b.halfExtents.x,
      hy: b.halfExtents.y,
      hz: b.halfExtents.z,
      rotationY: b.rotationY,
      roof,
    });
  }
  return out;
}

/** D-09: scenery triangle count from the catalog table only. Scale and height never matter. */
export function sceneryTriangles(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  opts: { includeStyleless: boolean },
): number {
  const T = SCENERY_TRIANGLES;
  let total = 0;
  for (const f of features) {
    if ("points" in f) {
      let segs = 0;
      for (let i = 0; i + 1 < f.points.length; i++) {
        const a = f.points[i];
        const b = f.points[i + 1];
        if (a === undefined || b === undefined) continue;
        segs += splitCount(Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      if (f.kind === "hedge") total += segs * T.unitBox;
      else if (segs > 0) total += segs * 2 * T.unitBox + T.unitBox;
    } else if (f.kind === "bush") {
      total += T.bush;
    } else {
      const v = resolveVariant("tree", f.variant);
      if (v === undefined) continue;
      total += T.trunk;
      if (v.canopy.shape === "cone") total += T.coneCanopy;
      else if (v.canopy.shape === "sphere") total += T.sphereCanopy;
    }
  }
  for (const b of buildings) {
    if (b.style === undefined) {
      if (opts.includeStyleless) total += T.buildingWalls;
      continue;
    }
    const style = resolveBuildingStyle(b.style);
    if (style === undefined) continue;
    total += T.buildingWalls + (style.roof === "pitched" ? T.pitchedRoof : T.flatRoof);
  }
  return total;
}
