// Placement guards for scenery edits (07.1.3 D-09, D-12): the triangle budget, the
// move-refusal rule and the sculpt-driven building re-seat. Pure, no DOM, no three.
// editor.ts only routes pointer events to these so every gesture shows the same copy.

import { MAX_SCENERY_TRIANGLES, sceneryTriangles } from "../../src/core/scenery-geometry.ts";
import type {
  TerrainBuilding,
  TerrainFeature,
  TerrainObject,
} from "../../src/core/terrain-format.ts";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import {
  canPlaceAt,
  canPlaceLine,
  footprintCorners,
  type HeightFn,
  insideArea,
  moveFeature,
  OUTSIDE_AREA_REASON,
  type PlaceArea,
  type ScenerySelection,
  seatBuilding,
} from "./features.ts";

export const BUDGET_REASON =
  "Scenery triangle limit reached (40,000). Delete some scenery to place more";
export const NOTHING_SELECTED = "Nothing selected";

/** The live area as the guards see it. */
export interface SceneryArea extends PlaceArea {
  readonly features?: readonly TerrainFeature[];
  readonly buildings?: readonly TerrainBuilding[];
  readonly objects?: readonly TerrainObject[];
  readonly legacyGlbBuildings?: boolean;
}

export type BudgetCheck =
  | { ok: true; triangles: number }
  | { ok: false; triangles: number; reason: string };

function countTriangles(
  area: SceneryArea,
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
): number {
  // The game's drawing rule: style-less buildings are drawn only when they are not legacy GLB ones.
  return sceneryTriangles(features, buildings, { includeStyleless: !area.legacyGlbBuildings });
}

/**
 * D-09: refuses an edit that would leave scenery over 40,000 triangles. An edit that does
 * not raise the count (delete, move) is never refused, even on a map that is already over.
 */
export function checkSceneryBudget(
  area: SceneryArea,
  next: { features?: readonly TerrainFeature[]; buildings?: readonly TerrainBuilding[] },
): BudgetCheck {
  const curF = area.features ?? [];
  const curB = area.buildings ?? [];
  const current = countTriangles(area, curF, curB);
  const triangles = countTriangles(area, next.features ?? curF, next.buildings ?? curB);
  if (triangles <= MAX_SCENERY_TRIANGLES || triangles <= current) return { ok: true, triangles };
  return { ok: false, triangles, reason: BUDGET_REASON };
}

/**
 * Accepts scatter candidates in order while the total stays within the budget; a candidate
 * that does not fit is skipped. Never refuses deletes: only adds are routed through here.
 */
export function fitScatterToBudget(
  area: SceneryArea,
  candidates: readonly TerrainFeature[],
): { accepted: TerrainFeature[]; skipped: number } {
  let total = countTriangles(area, area.features ?? [], area.buildings ?? []);
  const accepted: TerrainFeature[] = [];
  let skipped = 0;
  for (const c of candidates) {
    const t = countTriangles(area, [c], []);
    if (total + t <= MAX_SCENERY_TRIANGLES) {
      accepted.push(c);
      total += t;
    } else {
      skipped++;
    }
  }
  return { accepted, skipped };
}

/** A ramp may sit on road paint (D-14); it is refused only outside the map area. */
export function canPlaceRampAt(
  area: PlaceArea,
  x: number,
  z: number,
): { ok: true } | { ok: false; reason: string } {
  if (!insideArea(area, x, z)) return { ok: false, reason: OUTSIDE_AREA_REASON };
  return { ok: true };
}

function areaHeightFn(area: PlaceArea): HeightFn {
  return (x, z) => sampleTerrainHeight(area.grid, x, z);
}

function buildingSamples(b: TerrainBuilding, heightAt: HeightFn): number[] {
  const out = footprintCorners(
    b.center.x,
    b.center.z,
    b.halfExtents.x,
    b.halfExtents.z,
    b.rotationY,
  ).map(([x, z]) => heightAt(x, z));
  out.push(heightAt(b.center.x, b.center.z));
  return out;
}

/** Height of a seated building's top above the highest ground under it. */
export function visibleHeightOf(b: TerrainBuilding, heightAt: HeightFn): number {
  return b.center.y + b.halfExtents.y - Math.max(...buildingSamples(b, heightAt));
}

export type MoveResult =
  | {
      ok: true;
      features?: readonly TerrainFeature[];
      buildings?: readonly TerrainBuilding[];
      objects?: readonly TerrainObject[];
    }
  | { ok: false; reason: string };

/**
 * Moves one selected item by (dx, dz) after the same D-12 checks placement uses, so a drag
 * cannot put scenery on road paint. Returns only the changed array. Inputs are untouched.
 */
export function moveSceneryItem(
  area: SceneryArea,
  selection: ScenerySelection,
  dx: number,
  dz: number,
): MoveResult {
  if (selection.kind === "feature") {
    const features = area.features ?? [];
    const f = features.find((x) => x.id === selection.id);
    if (f === undefined) return { ok: false, reason: NOTHING_SELECTED };
    const check =
      "points" in f
        ? canPlaceLine(
            area,
            f.points.map((p) => [p[0] + dx, p[1] + dz] as const),
          )
        : canPlaceAt(area, f.x + dx, f.z + dz);
    if (!check.ok) return check;
    return { ok: true, features: moveFeature(features, selection.id, dx, dz) };
  }
  if (selection.kind === "building") {
    const buildings = area.buildings ?? [];
    const b = buildings[selection.index];
    if (b === undefined) return { ok: false, reason: NOTHING_SELECTED };
    const x = b.center.x + dx;
    const z = b.center.z + dz;
    const spots: [number, number][] = [
      [x, z],
      ...footprintCorners(x, z, b.halfExtents.x, b.halfExtents.z, b.rotationY),
    ];
    for (const [px, pz] of spots) {
      const c = canPlaceAt(area, px, pz);
      if (!c.ok) return c;
    }
    let moved: TerrainBuilding;
    if (b.style !== undefined) {
      const heightAt = areaHeightFn(area);
      const seated = seatBuilding(heightAt, {
        x,
        z,
        widthM: b.halfExtents.x * 2,
        depthM: b.halfExtents.z * 2,
        heightM: visibleHeightOf(b, heightAt),
        rotationY: b.rotationY,
        style: b.style,
      });
      if (seated.building === undefined) return { ok: false, reason: seated.error };
      moved = seated.building;
    } else {
      moved = { ...b, center: { x, y: b.center.y, z } };
    }
    return { ok: true, buildings: buildings.map((o, i) => (i === selection.index ? moved : o)) };
  }
  const objects = area.objects ?? [];
  const o = objects.find((v) => v.crest.id === selection.id && v.crest.ramp !== undefined);
  if (o === undefined) return { ok: false, reason: NOTHING_SELECTED };
  const nx = o.crest.centerX + dx;
  const nz = o.crest.centerZ + dz;
  const c = canPlaceRampAt(area, nx, nz);
  if (!c.ok) return c;
  return {
    ok: true,
    objects: objects.map((v) =>
      v === o ? { kind: "crest", crest: { ...v.crest, centerX: nx, centerZ: nz } } : v,
    ),
  };
}

/** World-space rectangle a sculpt stroke touched. */
export interface WorldWindow {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const SAME_EPS_M = 1e-9;

/**
 * Re-seats styled buildings whose footprint touches the sculpted window. The visible height
 * (top above the highest ground, measured on the BEFORE terrain) is kept; the box is seated
 * again on the AFTER terrain. Style-less (legacy) buildings never move. Returns the same
 * array reference when nothing changed.
 */
export function reseatBuildingsAfterSculpt(
  buildings: readonly TerrainBuilding[],
  beforeHeightAt: HeightFn,
  afterHeightAt: HeightFn,
  window: WorldWindow,
): readonly TerrainBuilding[] {
  let changed = false;
  const out = buildings.map((b) => {
    if (b.style === undefined) return b;
    const corners = footprintCorners(
      b.center.x,
      b.center.z,
      b.halfExtents.x,
      b.halfExtents.z,
      b.rotationY,
    );
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    if (
      Math.max(...xs) < window.minX ||
      Math.min(...xs) > window.maxX ||
      Math.max(...zs) < window.minZ ||
      Math.min(...zs) > window.maxZ
    ) {
      return b;
    }
    const seated = seatBuilding(afterHeightAt, {
      x: b.center.x,
      z: b.center.z,
      widthM: b.halfExtents.x * 2,
      depthM: b.halfExtents.z * 2,
      heightM: visibleHeightOf(b, beforeHeightAt),
      rotationY: b.rotationY,
      style: b.style,
    });
    const next = seated.building;
    if (next === undefined) return b;
    if (
      Math.abs(next.center.y - b.center.y) < SAME_EPS_M &&
      Math.abs(next.halfExtents.y - b.halfExtents.y) < SAME_EPS_M
    ) {
      return b;
    }
    changed = true;
    return next;
  });
  return changed ? out : buildings;
}
