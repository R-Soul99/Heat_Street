/**
 * Raise/Lower diagnosis regression guards (phase 07.1, D-08).
 *
 * Ported from the parallel overnight 07.1 run (plan 06 there, commit 7db4154), which
 * characterised why Raise/Lower "didn't work". Its finding: the raise op itself works
 * headless; the user-visible failure was
 *   C1 one default click lifted only ~0.44 m (strength 0.5) - invisible at the default
 *      ~370 m camera distance, with only "Edited." as feedback;
 *   C2 clicking with no area loaded silently did nothing;
 *   C3 strokes over road-held vertices silently did nothing;
 *   C4 Alt inverted Raise (and Alt on Windows can steal focus);
 *   C5 the slope limiter could clamp a raise without saying so.
 * Each test below pins the fixed behaviour so none of these regress.
 */
import { describe, expect, it } from "vitest";
import { sampleTerrainHeight } from "../../src/core/terrain-grid.ts";
import { createEmptyTerrainArea } from "./new-area.ts";
import {
  createToolDispatcher,
  type EditArea,
  heldStatus,
  type Modifiers,
  SLOPE_CLAMP_HINT,
} from "./tool-dispatch.ts";

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
  it("C1 a default single click lifts visibly and reports how far", () => {
    const area = makeArea(1000);
    const d = createToolDispatcher(() => area);
    d.setTool("raise");
    const r = d.pointerDown(0, 0, {});
    const up = d.pointerUp(0, 0);
    const max = maxHeight(area);
    // Was ~0.44 m at strength 0.5; local default strength 1 gives ~0.89 m.
    expect(max, `measured centre lift ${max} m`).toBeGreaterThan(0.6);
    const delta = up.heightDeltaM ?? r.heightDeltaM;
    expect(delta).toBeGreaterThan(0);
  });

  it("C2 no area loaded: the dispatcher throws, so the page must guard and say so", () => {
    const d = createToolDispatcher(() => {
      throw new Error("no area loaded");
    });
    expect(() => d.pointerDown(0, 0, {})).toThrow("no area loaded");
  });

  it("C3 raising on a road changes nothing and says why", () => {
    const area = makeArea(240);
    const d = createToolDispatcher(() => area);
    d.setTool("road");
    d.pointerDown(-80, 0, {});
    for (const x of [-40, 0, 40, 80]) d.pointerMove(x, 0, {});
    d.pointerUp(80, 0);
    d.clearHistory();
    d.setTool("raise");
    d.setOptions({ radiusM: 4 });
    const before = Float32Array.from(area.grid.heights);
    const r = d.pointerDown(0, 0, {});
    d.pointerUp(0, 0);
    expect(r.dirtyHeights).toBeUndefined();
    expect(r.heldVertices).toBeGreaterThan(0);
    expect(r.status).toBe(heldStatus(r.heldVertices ?? 0));
    expect(Array.from(area.grid.heights)).toEqual(Array.from(before));
  });

  it("C4 Alt is ignored by Raise (it used to invert it)", () => {
    const area = makeArea(240);
    const d = createToolDispatcher(() => area);
    d.setTool("raise");
    // Modifiers no longer has an alt field; force one through to prove it is ignored.
    d.pointerDown(0, 0, { alt: true } as unknown as Modifiers);
    d.pointerUp(0, 0);
    expect(sampleTerrainHeight(area.grid, 0, 0)).toBeGreaterThan(0);
  });

  it("C5 slope limiter clamps a raise next to a steep neighbour and says so", () => {
    const area = makeArea(240);
    const g = area.grid;
    const stride = g.rows + 1;
    const col = Math.round((0 - g.originX) / g.cellSizeM) + 1;
    const row = Math.round((0 - g.originZ) / g.cellSizeM);
    g.heights[row + col * stride] = 20;
    const d = createToolDispatcher(() => area);
    d.setTool("raise");
    d.setOptions({ strength: 1, radiusM: 3 });
    const r = d.pointerDown(0, 0, {});
    d.pointerUp(0, 0);
    expect(r.slopeClamped).toBe(true);
    expect(r.status).toBe(SLOPE_CLAMP_HINT);
  });
});
