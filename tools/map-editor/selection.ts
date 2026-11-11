/**
 * Pure helpers for the map editor's box Select / Eraser / Clear all. No DOM.
 * Disabling a road renames `highway` to `disused:highway`; the map compiler
 * drops ways without a `highway` tag, so disabled roads are not compiled but
 * stay in the file and can be re-enabled.
 */
import type { Projector, RawEnvelope, RawWay } from "./world.ts";

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type XY = { x: number; y: number };

export function normaliseBox(a: XY, b: XY): Box {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function inside(p: XY, box: Box): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

/** Liang-Barsky clip: does the closed segment touch the closed rectangle? */
export function segmentIntersectsRect(a: XY, b: XY, box: Box): boolean {
  if (inside(a, box) || inside(b, box)) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.minX, box.maxX - a.x, a.y - box.minY, box.maxY - a.y];
  for (let i = 0; i < 4; i++) {
    const pi = p[i] as number;
    const qi = q[i] as number;
    if (pi === 0) {
      if (qi < 0) return false;
    } else {
      const t = qi / pi;
      if (pi < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

export function waysInBox(roads: readonly RawWay[], proj: Projector, box: Box): RawWay[] {
  return roads.filter((w) => {
    const pts = w.geometry.map((g) => proj.toLocal(g));
    if (pts.length === 1) return inside(pts[0] as XY, box);
    for (let i = 0; i + 1 < pts.length; i++) {
      if (segmentIntersectsRect(pts[i] as XY, pts[i + 1] as XY, box)) return true;
    }
    return false;
  });
}

export function buildingsInBox(buildings: readonly RawWay[], proj: Projector, box: Box): RawWay[] {
  return buildings.filter((w) => {
    let pts = w.geometry.map((g) => proj.toLocal(g));
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length > 1 && first && last && first.x === last.x && first.y === last.y) {
      pts = pts.slice(0, -1);
    }
    if (pts.length === 0) return false;
    const c = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    return inside(c, box);
  });
}

export function isRoadDisabled(way: RawWay): boolean {
  return way.tags?.highway === undefined && way.tags?.["disused:highway"] !== undefined;
}

export function setRoadDisabled(way: RawWay, disabled: boolean): void {
  const tags = { ...(way.tags ?? {}) };
  if (disabled) {
    if (tags.highway === undefined && tags["disused:highway"] !== undefined) return;
    tags["disused:highway"] = tags.highway ?? "unclassified";
    delete tags.highway;
  } else {
    if (tags["disused:highway"] === undefined) return;
    tags.highway = tags["disused:highway"];
    delete tags["disused:highway"];
  }
  way.tags = tags;
}

export interface BoxActionArgs {
  roads: RawEnvelope;
  buildings: RawEnvelope;
  proj: Projector;
  box: Box;
  types: { roads: boolean; buildings: boolean };
  action: "delete" | "disable" | "enable";
}

/** Mutates the envelopes in place (caller snapshots first); returns counts affected. */
export function applyBoxAction(args: BoxActionArgs): { roads: number; buildings: number } {
  const { roads, buildings, proj, box, types, action } = args;
  const out = { roads: 0, buildings: 0 };
  if (types.roads) {
    const hit = waysInBox(roads.response.elements, proj, box);
    if (action === "delete") {
      const set = new Set(hit);
      roads.response.elements = roads.response.elements.filter((w) => !set.has(w));
      out.roads = hit.length;
    } else {
      const disable = action === "disable";
      for (const w of hit) {
        if (isRoadDisabled(w) !== disable) {
          setRoadDisabled(w, disable);
          out.roads++;
        }
      }
    }
  }
  if (types.buildings && action === "delete") {
    const hit = buildingsInBox(buildings.response.elements, proj, box);
    const set = new Set(hit);
    buildings.response.elements = buildings.response.elements.filter((w) => !set.has(w));
    out.buildings = hit.length;
  }
  return out;
}
