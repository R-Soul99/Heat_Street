// 07.1.2-04: terrain surface fill on a selection mask (D-11, D-13).
import { describe, expect, it } from "vitest";
import { createStrokeRecorder, paintMask } from "../src/core/terrain-brush.ts";
import { createCellMask } from "../src/core/terrain-cell-mask.ts";
import { createTerrainGrid } from "../src/core/terrain-grid.ts";
import { createPaintMap, encodePaintValue, PAINT_ROAD_FLAG } from "../src/core/terrain-paint.ts";

function setup() {
  const g = createTerrainGrid({ rows: 10, cols: 10, cellSizeM: 2, originX: 0, originZ: 0 });
  const p = createPaintMap({
    originX: 0,
    originZ: 0,
    widthM: 20,
    depthM: 20,
    metresPerPixel: 0.5,
    fill: "grass",
  });
  const m = createCellMask(10, 10);
  // cells rows 2..3, cols 2..4 => x 4..10, z 4..8
  m.apply({ minRow: 2, minCol: 2, maxRow: 4, maxCol: 5 }, "add");
  return { g, p, m };
}
const mud = encodePaintValue("mud", false);

describe("paintMask", () => {
  it("fills pixels whose centre is in a selected cell and nothing else", () => {
    const { g, p, m } = setup();
    const before = p.data.slice();
    const r = paintMask(p, g, m, "mud");
    expect(r.pixelsChanged).toBe(12 * 8);
    for (let pz = 0; pz < p.height; pz++) {
      for (let px = 0; px < p.width; px++) {
        const cx = (px + 0.5) * 0.5;
        const cz = (pz + 0.5) * 0.5;
        const inside = cx >= 4 && cx < 10 && cz >= 4 && cz < 8;
        expect(p.data[pz * p.width + px]).toBe(inside ? mud : before[pz * p.width + px]);
      }
    }
  });

  it("keeps road-flagged pixels", () => {
    const { g, p, m } = setup();
    const i = 9 * p.width + 10; // centre (5.25, 4.75): inside the mask
    const road = encodePaintValue("tarmac", true);
    p.data[i] = road;
    paintMask(p, g, m, "mud");
    expect(p.data[i] & PAINT_ROAD_FLAG).toBe(PAINT_ROAD_FLAG);
    expect(p.data[i]).toBe(road);
  });

  it("is one undoable diff", () => {
    const { g, p, m } = setup();
    const before = p.data.slice();
    const rec = createStrokeRecorder(g, p);
    paintMask(p, g, m, "mud", rec);
    const d = rec.commit()?.paint;
    expect(d).toBeDefined();
    if (!d) return;
    for (let k = 0; k < d.indices.length; k++) p.data[d.indices[k]] = d.before[k];
    expect(Array.from(p.data)).toEqual(Array.from(before));
  });

  it("empty mask is a no-op with no rect", () => {
    const { g, p } = setup();
    const r = paintMask(p, g, createCellMask(10, 10), "mud");
    expect(r.rect).toBeUndefined();
    expect(r.pixelsChanged).toBe(0);
  });

  it("rejects an unknown surface", () => {
    const { g, p, m } = setup();
    expect(paintMask(p, g, m, "lava" as never).pixelsChanged).toBe(0);
  });
});
