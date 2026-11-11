/**
 * Pure helpers for the map editor's box Select and Eraser: which ways lie in a
 * box, and reversible road disabling. No DOM; tested in `select-box.test.ts`.
 *
 * Why roads can be disabled but buildings cannot: the compiler drops any road
 * way without a `highway` tag (build-graph.ts, reason `no-highway-tag`), so
 * renaming the key to `disused:highway` (the OSM lifecycle-prefix convention)
 * leaves the way in the file but out of the compiled map, and is reversible.
 * `building-box.ts` ignores tags and turns every way in the buildings file into
 * a building, so a building can only be deleted.
 */
import type { Projector, RawEnvelope, RawWay } from "./model.ts";

type XY = { x: number; y: number };
export interface Box {
  a: XY;
  b: XY;
}

const bounds = (box: Box) => ({
  minX: Math.min(box.a.x, box.b.x),
  maxX: Math.max(box.a.x, box.b.x),
  minY: Math.min(box.a.y, box.b.y),
  maxY: Math.max(box.a.y, box.b.y),
});

type Rect = ReturnType<typeof bounds>;
const inRect = (p: XY, r: Rect): boolean =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

function ccw(a: XY, b: XY, c: XY): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = ccw(a, b, c);
  const d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a);
  const d4 = ccw(c, d, b);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0);
}

/** Segment a-b touches the axis-aligned rect: an endpoint inside, or it crosses an edge. */
export function segmentHitsRect(a: XY, b: XY, r: Rect): boolean {
  if (inRect(a, r) || inRect(b, r)) return true;
  const c1 = { x: r.minX, y: r.minY };
  const c2 = { x: r.maxX, y: r.minY };
  const c3 = { x: r.maxX, y: r.maxY };
  const c4 = { x: r.minX, y: r.maxY };
  return (
    segmentsCross(a, b, c1, c2) ||
    segmentsCross(a, b, c2, c3) ||
    segmentsCross(a, b, c3, c4) ||
    segmentsCross(a, b, c4, c1)
  );
}

/** Road ways with any segment inside or crossing the box (corners in any order). */
export function waysInBox(roads: RawEnvelope, proj: Projector, box: Box): RawWay[] {
  const r = bounds(box);
  return roads.response.elements.filter((w) => {
    const pts = w.geometry.map((g) => proj.toLocal(g));
    if (pts.length === 1) return inRect(pts[0] as XY, r);
    for (let i = 0; i + 1 < pts.length; i++) {
      if (segmentHitsRect(pts[i] as XY, pts[i + 1] as XY, r)) return true;
    }
    return false;
  });
}

/** Buildings whose footprint centroid is inside the box. */
export function buildingsInBox(buildings: RawEnvelope, proj: Projector, box: Box): RawWay[] {
  const r = bounds(box);
  return buildings.response.elements.filter((w) => {
    const pts = w.geometry.map((g) => proj.toLocal(g));
    if (pts.length === 0) return false;
    // Closed rings repeat the first point; drop it so the centroid is not skewed.
    const first = pts[0] as XY;
    const last = pts[pts.length - 1] as XY;
    const ring =
      pts.length > 1 && first.x === last.x && first.y === last.y ? pts.slice(0, -1) : pts;
    const c = {
      x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
      y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
    };
    return inRect(c, r);
  });
}

/** Moves `highway` to `disused:highway`. Returns false if there was nothing to do. */
export function disableRoad(way: RawWay): boolean {
  const tags = { ...(way.tags ?? {}) };
  const hw = tags.highway;
  if (hw === undefined) return false;
  delete tags.highway;
  tags["disused:highway"] = hw;
  way.tags = tags;
  return true;
}

/** Reverses `disableRoad`. Returns false if the way was not disabled. */
export function enableRoad(way: RawWay): boolean {
  if (!isDisabledRoad(way)) return false;
  const tags = { ...(way.tags ?? {}) };
  tags.highway = tags["disused:highway"] as string;
  delete tags["disused:highway"];
  way.tags = tags;
  return true;
}

export function isDisabledRoad(way: RawWay): boolean {
  const t = way.tags;
  return t !== undefined && t["disused:highway"] !== undefined && t.highway === undefined;
}
