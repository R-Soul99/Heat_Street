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
/**
 * Line colliders extend this far below the ground line between a segment's two ends, so a
 * small dip under the middle of a segment leaves no gap.
 */
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
      /** Tilt along the box's length so it follows the slope (see LineSegment.pitch). */
      readonly pitch: number;
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
  /** Tilt along the box's length so it follows the slope (see LineSegment.pitch); 0 = level. */
  readonly pitch: number;
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

/**
 * One straight piece of a line feature. It follows the ground: it runs from the ground height
 * at its start to the ground height at its end, so neither end floats or is buried on a slope.
 * `y` is the average of the two end ground heights (the middle of that ground line).
 */
export interface LineSegment {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Horizontal length. */
  readonly lengthM: number;
  /** Length along the ground line (never shorter than lengthM). */
  readonly slopeLengthM: number;
  readonly rotationY: number;
  /**
   * Tilt in radians about the box's own width axis, applied before rotationY: positive when
   * the end is higher than the start. 0 on level ground.
   */
  readonly pitch: number;
  readonly startX: number;
  readonly startZ: number;
  readonly startY: number;
  readonly endY: number;
  readonly heightM: number;
  readonly widthM: number;
}

/** Picket fences draw one slat roughly every PICKET_SPACING_M along each segment (gaps between them). */
export const PICKET_SPACING_M = 0.8;
/** Slat width along the fence, metres. */
const PICKET_SLAT_M = 0.28;

/**
 * Boxes (not counting posts) one fence segment of lengthM draws: post-rail 1 rail; picket one
 * backing rail plus the slats; chainlink a top, middle and bottom wire rail.
 */
export function fenceRailBoxCount(variant: string, lengthM: number): number {
  if (variant === "picket") return 1 + Math.max(1, Math.round(lengthM / PICKET_SPACING_M));
  if (variant === "chainlink") return 3;
  return 1;
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
      const len = dist / n;
      out.push({
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        z: (z0 + z1) / 2,
        lengthM: len,
        slopeLengthM: Math.hypot(len, y1 - y0),
        rotationY: Math.atan2(-dz, dx),
        pitch: Math.atan2(y1 - y0, len),
        startX: x0,
        startZ: z0,
        startY: y0,
        endY: y1,
        heightM,
        widthM,
      });
    }
  }
  return out;
}

/**
 * Rotation of a box that is turned rotationY about the world Y axis and tilted `pitch` along
 * its length (yaw applied after pitch). Physics and render both build their rotation from
 * these two angles, so the collider and the drawn box stay on top of each other.
 */
export function lineBoxQuat(
  rotationY: number,
  pitch: number,
): { x: number; y: number; z: number; w: number } {
  const a = Math.cos(rotationY / 2);
  const b = Math.sin(rotationY / 2);
  const c = Math.cos(pitch / 2);
  const d = Math.sin(pitch / 2);
  return { x: b * d, y: b * c, z: a * d, w: a * c };
}

/** The point `upM` above the middle of a segment's ground line, measured along its tilted up axis. */
function liftedCentre(s: LineSegment, upM: number): { x: number; y: number; z: number } {
  const sp = Math.sin(s.pitch);
  return {
    x: s.x - sp * Math.cos(s.rotationY) * upM,
    y: s.y + Math.cos(s.pitch) * upM,
    z: s.z + sp * Math.sin(s.rotationY) * upM,
  };
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
  const c = liftedCentre(s, hy - LINE_SINK_M);
  return {
    shape: "cuboid",
    x: c.x,
    y: c.y,
    z: c.z,
    hx: s.slopeLengthM / 2,
    hy,
    hz: Math.max(s.widthM, MIN_LINE_COLLIDER_THICKNESS_M) / 2,
    rotationY: s.rotationY,
    pitch: s.pitch,
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
          const c = liftedCentre(s, f.heightM / 2);
          hedges.push({
            x: c.x,
            y: c.y,
            z: c.z,
            lengthM: s.slopeLengthM,
            heightM: f.heightM,
            widthM: v.widthM,
            rotationY: s.rotationY,
            pitch: s.pitch,
            variant: f.variant,
          });
        }
      } else {
        const v = resolveVariant("fence", f.variant);
        if (v === undefined) continue;
        const segs = lineSegments(f.points, heightAt, f.heightM, v.thicknessM);
        for (const s of segs) {
          // Rails run post to post along the ground line, so they stay on the posts on a slope.
          const rail = (yFrac: number, h: number): SegmentBox => {
            const c = liftedCentre(s, f.heightM * yFrac);
            return {
              x: c.x,
              y: c.y,
              z: c.z,
              lengthM: s.slopeLengthM,
              heightM: h,
              widthM: v.thicknessM,
              rotationY: s.rotationY,
              pitch: s.pitch,
              variant: f.variant,
            };
          };
          if (f.variant === "picket") {
            // Spaced slats on a backing rail: reads as a picket fence, not a solid wall.
            fenceRails.push(rail(0.55, 0.1));
            const n = Math.max(1, Math.round(s.lengthM / PICKET_SPACING_M));
            const dirX = Math.cos(s.rotationY);
            const dirZ = -Math.sin(s.rotationY);
            const slatH = f.heightM * 0.9 + 0.1;
            for (let k = 0; k < n; k++) {
              const t = -s.lengthM / 2 + ((k + 0.5) * s.lengthM) / n;
              const px = s.x + dirX * t;
              const pz = s.z + dirZ * t;
              fenceRails.push({
                x: px,
                y: heightAt(px, pz) - 0.1 + slatH / 2,
                z: pz,
                lengthM: PICKET_SLAT_M,
                heightM: slatH,
                widthM: v.thicknessM,
                rotationY: s.rotationY,
                pitch: 0, // slats stand upright, each seated on the ground under it
                variant: f.variant,
              });
            }
          } else if (f.variant === "chainlink") {
            // Posts plus top, middle and bottom wire: see-through, not a solid panel.
            fenceRails.push(rail(1 - 0.04 / f.heightM, 0.08));
            fenceRails.push(rail(0.5, 0.05));
            fenceRails.push(rail(0.1, 0.05));
          } else {
            fenceRails.push(rail(0.7, 0.3));
          }
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
      let rails = 0;
      for (let i = 0; i + 1 < f.points.length; i++) {
        const a = f.points[i];
        const b = f.points[i + 1];
        if (a === undefined || b === undefined) continue;
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = splitCount(dist);
        segs += n;
        if (n > 0) rails += n * fenceRailBoxCount(f.variant, dist / n);
      }
      if (f.kind === "hedge") total += segs * T.unitBox;
      else if (segs > 0) total += (rails + segs + 1) * T.unitBox;
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
