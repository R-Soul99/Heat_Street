/**
 * 07.1.3 D-08: scenery catalog. Kinds, variants, sizes, colours and solidity live HERE, in code.
 * Sidecar files store only variant ids.
 *
 * CATALOG IDS ARE A FILE FORMAT. Never rename or remove one: add a new id instead, otherwise
 * every map that references the old id stops loading.
 *
 * Pure data and lookups: no three, rapier or DOM.
 */

export const SCENERY_KINDS = ["tree", "bush", "hedge", "fence"] as const;
export type SceneryKind = (typeof SCENERY_KINDS)[number];
export type PointKind = "tree" | "bush";
export type LineKind = "hedge" | "fence";

export interface TreeVariant {
  readonly id: string;
  readonly trunkRadiusM: number;
  readonly trunkHeightM: number;
  readonly canopy: {
    readonly shape: "cone" | "sphere" | "none";
    readonly radiusM: number;
    readonly heightM: number;
  };
  readonly trunkColor: number;
  readonly canopyColor: number;
}

export interface BushVariant {
  readonly id: string;
  readonly radiusM: number;
  readonly heightM: number;
  readonly color: number;
}

export interface HedgeVariant {
  readonly id: string;
  readonly widthM: number;
  readonly defaultHeightM: number;
  readonly minHeightM: number;
  readonly color: number;
}

/**
 * A fence draws ONE rail/panel box per segment (picket and chainlink as a full-height thin panel,
 * post-rail as a 0.3 m rail at 70% of the height), plus one post at every segment start and one
 * closing post at the line's last point. Segments are at most 8 m, so posts are at most 8 m apart.
 */
export interface FenceVariant {
  readonly id: string;
  readonly thicknessM: number;
  readonly defaultHeightM: number;
  readonly minHeightM: number;
  readonly postSizeM: number;
  readonly color: number;
}

export interface BuildingStyle {
  readonly id: string;
  readonly defaultWidthM: number;
  readonly defaultDepthM: number;
  readonly defaultHeightM: number;
  readonly roof: "pitched" | "flat";
  readonly wallColor: number;
  readonly roofColor: number;
}

export const TREE_VARIANTS: readonly TreeVariant[] = Object.freeze([
  Object.freeze({
    id: "pine",
    trunkRadiusM: 0.25,
    trunkHeightM: 2.5,
    canopy: Object.freeze({ shape: "cone" as const, radiusM: 2.2, heightM: 6 }),
    trunkColor: 0x5a3d26,
    canopyColor: 0x2f5d34,
  }),
  Object.freeze({
    id: "oak",
    trunkRadiusM: 0.35,
    trunkHeightM: 3,
    canopy: Object.freeze({ shape: "sphere" as const, radiusM: 3, heightM: 6 }),
    trunkColor: 0x6b4a2e,
    canopyColor: 0x4f7a32,
  }),
  Object.freeze({
    id: "dead",
    trunkRadiusM: 0.3,
    trunkHeightM: 5,
    canopy: Object.freeze({ shape: "none" as const, radiusM: 0, heightM: 0 }),
    trunkColor: 0x7a6a58,
    canopyColor: 0x7a6a58,
  }),
]);

export const BUSH_VARIANTS: readonly BushVariant[] = Object.freeze([
  Object.freeze({ id: "round", radiusM: 1.0, heightM: 1.2, color: 0x3f6b30 }),
  Object.freeze({ id: "scrub", radiusM: 1.4, heightM: 0.8, color: 0x8a7a45 }),
]);

export const HEDGE_VARIANTS: readonly HedgeVariant[] = Object.freeze([
  Object.freeze({ id: "box", widthM: 1.0, defaultHeightM: 1.5, minHeightM: 1.0, color: 0x2e5a2c }),
]);

export const FENCE_VARIANTS: readonly FenceVariant[] = Object.freeze([
  Object.freeze({
    id: "post-rail",
    thicknessM: 0.12,
    defaultHeightM: 1.2,
    minHeightM: 1.0,
    postSizeM: 0.18,
    color: 0x8a6a42,
  }),
  Object.freeze({
    id: "picket",
    thicknessM: 0.12,
    defaultHeightM: 1.2,
    minHeightM: 1.0,
    postSizeM: 0.14,
    color: 0xd8d2c0,
  }),
  Object.freeze({
    id: "chainlink",
    thicknessM: 0.12,
    defaultHeightM: 1.8,
    minHeightM: 1.0,
    postSizeM: 0.12,
    color: 0x8c949a,
  }),
]);

export const BUILDING_STYLES: readonly BuildingStyle[] = Object.freeze([
  Object.freeze({
    id: "shed",
    defaultWidthM: 4,
    defaultDepthM: 3,
    defaultHeightM: 2.5,
    roof: "pitched" as const,
    wallColor: 0x9a7b55,
    roofColor: 0x5b4a3a,
  }),
  Object.freeze({
    id: "house",
    defaultWidthM: 9,
    defaultDepthM: 8,
    defaultHeightM: 6,
    roof: "pitched" as const,
    wallColor: 0xd9c9a8,
    roofColor: 0x9a4a3a,
  }),
  Object.freeze({
    id: "barn",
    defaultWidthM: 14,
    defaultDepthM: 10,
    defaultHeightM: 8,
    roof: "pitched" as const,
    wallColor: 0xa8432f,
    roofColor: 0x4a4a4e,
  }),
  Object.freeze({
    id: "shop",
    defaultWidthM: 12,
    defaultDepthM: 10,
    defaultHeightM: 4.5,
    roof: "flat" as const,
    wallColor: 0xc7b48a,
    roofColor: 0x6a6a6a,
  }),
  Object.freeze({
    id: "block",
    defaultWidthM: 16,
    defaultDepthM: 16,
    defaultHeightM: 14,
    roof: "flat" as const,
    wallColor: 0x8f949a,
    roofColor: 0x55585c,
  }),
]);

/**
 * D-09 contract: triangles per geometry part. Plan 06 counts budgets with these and plan 08's
 * render test asserts the built meshes match.
 * trunk: open-ended cylinder, 5 radial segments, 1 height segment.
 * coneCanopy: open-ended cone, 5 radial segments.
 * sphereCanopy and bush: IcosahedronGeometry detail 0.
 * unitBox: BoxGeometry 1x1x1, used for hedge segments, fence rails/panels and fence posts.
 * buildingWalls: box.
 * pitchedRoof: closed triangular prism.
 * flatRoof: slab box.
 */
export const SCENERY_TRIANGLES = Object.freeze({
  trunk: 10,
  coneCanopy: 5,
  sphereCanopy: 20,
  bush: 20,
  unitBox: 12,
  buildingWalls: 12,
  pitchedRoof: 8,
  flatRoof: 12,
});

/** D-10: what is solid and what blocks pursuit line of sight. Trunk only for trees. */
export const SCENERY_SOLIDITY: readonly {
  readonly kind: SceneryKind | "building";
  readonly solid: boolean;
  readonly blocksSight: boolean;
}[] = Object.freeze([
  Object.freeze({ kind: "tree" as const, solid: true, blocksSight: false }),
  Object.freeze({ kind: "bush" as const, solid: false, blocksSight: false }),
  Object.freeze({ kind: "hedge" as const, solid: true, blocksSight: true }),
  Object.freeze({ kind: "fence" as const, solid: true, blocksSight: false }),
  Object.freeze({ kind: "building" as const, solid: true, blocksSight: true }),
]);

export function solidityOf(kind: SceneryKind | "building") {
  return SCENERY_SOLIDITY.find((s) => s.kind === kind);
}

export function resolveVariant(kind: "tree", id: string): TreeVariant | undefined;
export function resolveVariant(kind: "bush", id: string): BushVariant | undefined;
export function resolveVariant(kind: "hedge", id: string): HedgeVariant | undefined;
export function resolveVariant(kind: "fence", id: string): FenceVariant | undefined;
export function resolveVariant(
  kind: SceneryKind,
  id: string,
): TreeVariant | BushVariant | HedgeVariant | FenceVariant | undefined;
export function resolveVariant(
  kind: SceneryKind,
  id: string,
): TreeVariant | BushVariant | HedgeVariant | FenceVariant | undefined {
  switch (kind) {
    case "tree":
      return TREE_VARIANTS.find((v) => v.id === id);
    case "bush":
      return BUSH_VARIANTS.find((v) => v.id === id);
    case "hedge":
      return HEDGE_VARIANTS.find((v) => v.id === id);
    case "fence":
      return FENCE_VARIANTS.find((v) => v.id === id);
    default:
      return undefined;
  }
}

export function resolveBuildingStyle(id: string): BuildingStyle | undefined {
  return BUILDING_STYLES.find((s) => s.id === id);
}
