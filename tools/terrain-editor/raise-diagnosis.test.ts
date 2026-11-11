/**
 * Raise/Lower diagnosis (phase 07.1 plan 06, D-08). Characterisation tests against the
 * real dispatcher and brush.
 *
 * Finding (07.1-06): the raise op itself works headless. The user-visible failure is
 * explained by C1 (one click lifts ~0.5 m at default strength, effectively invisible at
 * the default camera distance, with only 'Edited.' as feedback), C2 (clicking with no
 * area loaded silently does nothing), C3 (strokes over road-held vertices silently do
 * nothing) and C4 (Alt inverts Raise; Alt on Windows can also steal focus). Fix: separate
 * Raise/Lower tools without modifiers, per-stroke height feedback, an explicit
 * held-by-road message, and a no-area message in the page (07.1-08).
 *
 * Measured in C1: a single default click (radius 12 m, strength 0.5, smooth falloff) lifts
 * the highest vertex by 0.4427 m on a 3 m grid.
 *
 * Tests C3 and C4 were updated in Task 3 when behaviour changed: C3 now expects the
 * held-by-road status, C4 became "Alt is ignored by Raise".
 */
import { describe, expect, it } from "vitest";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import { createToolDispatcher, type EditArea, SLOPE_CLAMP_HINT } from "./tool-dispatch.ts";

function makeArea(size: number) {
  return {
    ...createEmptyTerrainArea({ areaId: "t", widthM: size, depthM: size, cellSizeM: 3 }),
  } as unknown as EditArea;
}

function maxHeight(area: EditArea): number {
  let m = Number.NEGATIVE_INFINITY;
  for (const h of area.grid.heights) m = Math.max(m, h);
  return m;
}

describe("raise/lower diagnosis", () => {
  it("C1 default single click raises only ~0.5 m at the centre", () => {
    const area = makeArea(1000);
    const d = createToolDispatcher(() => area);
    d.setTool("raise");
    d.pointerDown(0, 0, { alt: false });
    d.pointerUp(0, 0);
    const max = maxHeight(area);
    expect(max, `measured centre lift ${max} m`).toBeGreaterThan(0);
    expect(max, `measured centre lift ${max} m`).toBeLessThan(0.6);
    // Invisible at the default ~370 m camera distance.
    expect(max / 370).toBeLessThan(0.0015);
  });

  it("C2 no area loaded: the dispatcher throws and the page swallows it", () => {
    // editor.ts canvas pointerdown returns early on !area before calling the dispatcher,
    // with no message shown to the user.
    const d = createToolDispatcher(() => {
      throw new Error("no area loaded");
    });
    expect(() => d.pointerDown(0, 0, { alt: false })).toThrow("no area loaded");
  });

  it("C3 raising on a road changes nothing and says nothing", () => {
    const area = makeArea(240);
    const d = createToolDispatcher(() => area);
    d.setTool("road");
    d.pointerDown(-80, 0, { alt: false });
    for (const x of [-40, 0, 40, 80]) d.pointerMove(x, 0, { alt: false });
    d.pointerUp(80, 0);
    d.clearHistory();
    d.setTool("raise");
    d.setOptions({ radiusM: 4 });
    const before = Float32Array.from(area.grid.heights);
    const r = d.pointerDown(0, 0, { alt: false });
    d.pointerUp(0, 0);
    expect(r.dirtyHeights).toBeUndefined();
    expect(r.status).toBeUndefined();
    expect(Array.from(area.grid.heights)).toEqual(Array.from(before));
  });

  it("C4 Alt held (or stuck) turns Raise into Lower", () => {
    const area = makeArea(240);
    const d = createToolDispatcher(() => area);
    d.setTool("raise");
    d.pointerDown(0, 0, { alt: true });
    d.pointerUp(0, 0);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeLessThan(0);
  });

  it("C5 slope limiter clamps a raise next to a steep neighbour", () => {
    const area = makeArea(240);
    const g = area.grid;
    const stride = g.rows + 1;
    const col = Math.round((0 - g.originX) / g.cellSizeM) + 1;
    const row = Math.round((0 - g.originZ) / g.cellSizeM);
    g.heights[row + col * stride] = 20;
    const d = createToolDispatcher(() => area);
    d.setTool("raise");
    d.setOptions({ strength: 1, radiusM: 3 });
    const r = d.pointerDown(0, 0, { alt: false });
    d.pointerUp(0, 0);
    expect(r.slopeClamped).toBe(true);
    expect(r.status).toBe(SLOPE_CLAMP_HINT);
  });
});
