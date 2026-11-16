import { describe, expect, it } from "vitest";
import { rampLengthM } from "../../src/core/crest-geometry.ts";
import type { TerrainObject } from "../../src/core/terrain-format.ts";
import { createTerrainGrid } from "../../src/core/terrain-grid.ts";
import { createPaintMap } from "../../src/core/terrain-paint.ts";
import { addRampObject, RAMP_OUTSIDE_REASON } from "./features.ts";
import {
  ALIGN_ALREADY_FACING,
  ALIGN_ALREADY_IN_LINE,
  ALIGN_COINCIDENT,
  ALIGN_NOT_A_RAMP,
  ALIGN_SAME_HEADING,
  ALIGN_SAME_RAMP,
  alignRamp,
  centreLineEnds,
  headingToward,
  slideOntoLine,
  wrapHeading,
} from "./ramp-align.ts";

/** 400 m square, no road paint. */
function area() {
  const grid = createTerrainGrid({ rows: 80, cols: 80, cellSizeM: 5, originX: 0, originZ: 0 });
  const paint = createPaintMap({
    originX: 0,
    originZ: 0,
    widthM: 400,
    depthM: 400,
    metresPerPixel: 1,
    fill: "grass",
  });
  return { grid, paint };
}

const PARAMS = { heightM: 2, angleDeg: 20, widthM: 10 };

function two(a: [number, number, number], b: [number, number, number]): TerrainObject[] {
  let o: TerrainObject[] = [];
  o = addRampObject(o, a[0], a[1], a[2], PARAMS);
  o = addRampObject(o, b[0], b[1], b[2], PARAMS);
  return o;
}

const crestOf = (objs: readonly TerrainObject[], id: string) => {
  const c = objs.find((o) => o.crest.id === id)?.crest;
  if (!c?.ramp) throw new Error("missing");
  return c;
};

describe("wrapHeading / headingToward", () => {
  it("wraps to (-pi, pi]", () => {
    expect(wrapHeading(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapHeading(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapHeading(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 12);
    expect(wrapHeading(-0.5)).toBeCloseTo(-0.5, 12);
  });
  it("points along the convention 0 = +x, pi/2 = +z", () => {
    expect(headingToward({ x: 0, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(0, 12);
    expect(headingToward({ x: 0, z: 0 }, { x: 0, z: 10 })).toBeCloseTo(Math.PI / 2, 12);
    expect(headingToward({ x: 0, z: 0 }, { x: -10, z: 0 })).toBeCloseTo(Math.PI, 12);
  });
  it("refuses coincident points", () => {
    expect(headingToward({ x: 3, z: 3 }, { x: 3, z: 3 })).toBeNull();
    expect(headingToward({ x: 3, z: 3 }, { x: 3.01, z: 3 })).toBeNull();
  });
});

describe("slideOntoLine", () => {
  it("keeps the distance along the line and removes the sideways offset", () => {
    const p = slideOntoLine({ x: 50, z: 30 }, { x: 0, z: 0 }, 0);
    expect(p?.x).toBeCloseTo(50, 9);
    expect(p?.z).toBeCloseTo(0, 9);
  });
  it("works for a diagonal line", () => {
    const h = Math.PI / 4;
    const p = slideOntoLine({ x: 10, z: 0 }, { x: 0, z: 0 }, h);
    // Projection of (10,0) on (cos45, sin45) is 7.07 along.
    const along = 10 * Math.cos(h);
    expect(p?.x).toBeCloseTo(along * Math.cos(h), 9);
    expect(p?.z).toBeCloseTo(along * Math.sin(h), 9);
  });
  it("returns null when already on the line", () => {
    expect(slideOntoLine({ x: 40, z: 0 }, { x: 0, z: 0 }, 0)).toBeNull();
  });
});

describe("centreLineEnds", () => {
  it("runs through the ramp start along its heading", () => {
    const o = two([100, 100, Math.PI / 2], [0, 0, 0]);
    const ends = centreLineEnds(crestOf(o, "ramp-1"), 50);
    expect(ends?.[0].x).toBeCloseTo(100, 9);
    expect(ends?.[0].z).toBeCloseTo(50, 9);
    expect(ends?.[1].z).toBeCloseTo(150, 9);
  });
});

describe("alignRamp face", () => {
  it("turns only the selected ramp toward the other", () => {
    const a = area();
    const o = two([100, 100, 1], [200, 100, 2]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "face", a);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(crestOf(r.objects, "ramp-1").ramp?.headingRad).toBeCloseTo(0, 9);
    expect(crestOf(r.objects, "ramp-2").ramp?.headingRad).toBe(2);
    expect(r.changed).toEqual(["ramp-1"]);
  });

  it("keeps the selected ramp's size and position", () => {
    const a = area();
    const o = two([100, 100, 1], [200, 160, 2]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "face", a);
    if (!r.ok) throw new Error(r.reason);
    const before = crestOf(o, "ramp-1");
    const after = crestOf(r.objects, "ramp-1");
    expect(after.centerX).toBe(before.centerX);
    expect(after.centerZ).toBe(before.centerZ);
    expect(after.heightM).toBe(before.heightM);
    expect(after.ramp?.widthM).toBe(before.ramp?.widthM);
    expect(after.ramp?.angleDeg).toBe(before.ramp?.angleDeg);
    expect(rampLengthM(after.heightM, after.ramp as never)).toBe(
      rampLengthM(before.heightM, before.ramp as never),
    );
  });

  it("face each other turns both, the target pointing straight back", () => {
    const a = area();
    const o = two([100, 100, 1], [200, 160, 2]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "faceEach", a);
    if (!r.ok) throw new Error(r.reason);
    const h1 = crestOf(r.objects, "ramp-1").ramp?.headingRad ?? 0;
    const h2 = crestOf(r.objects, "ramp-2").ramp?.headingRad ?? 0;
    expect(h1).toBeCloseTo(Math.atan2(60, 100), 9);
    expect(wrapHeading(h2 - h1)).toBeCloseTo(Math.PI, 9);
    expect(r.changed).toEqual(["ramp-1", "ramp-2"]);
  });

  it("refuses coincident ramps and the same ramp", () => {
    const a = area();
    const o = two([100, 100, 1], [100, 100, 2]);
    expect(alignRamp(o, "ramp-1", "ramp-2", "face", a)).toEqual({
      ok: false,
      reason: ALIGN_COINCIDENT,
    });
    expect(alignRamp(o, "ramp-1", "ramp-1", "face", a)).toEqual({
      ok: false,
      reason: ALIGN_SAME_RAMP,
    });
    expect(alignRamp(o, "ramp-1", "ramp-9", "face", a)).toEqual({
      ok: false,
      reason: ALIGN_NOT_A_RAMP,
    });
  });

  it("reports an already-facing ramp instead of making an empty edit", () => {
    const a = area();
    const o = two([100, 100, 0], [200, 100, 5]);
    expect(alignRamp(o, "ramp-1", "ramp-2", "face", a)).toEqual({
      ok: false,
      reason: ALIGN_ALREADY_FACING,
    });
  });

  it("wraps across the pi boundary", () => {
    const a = area();
    const o = two([200, 100, 0.3], [100, 100, 0]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "face", a);
    if (!r.ok) throw new Error(r.reason);
    expect(Math.abs(crestOf(r.objects, "ramp-1").ramp?.headingRad ?? 0)).toBeCloseTo(Math.PI, 9);
  });

  it("goes through the ramp guards: a turn that reaches outside the area is refused", () => {
    const a = area();
    // Ramp 1 starts 8 m from the west edge; facing a ramp to the west would run it outside.
    const o = two([8, 200, 0], [3, 200, 0]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "face", a);
    expect(r).toEqual({ ok: false, reason: RAMP_OUTSIDE_REASON });
  });
});

describe("alignRamp match", () => {
  it("copies the other heading and nothing else", () => {
    const a = area();
    const o = two([100, 100, 1], [200, 160, -2]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "match", a);
    if (!r.ok) throw new Error(r.reason);
    expect(crestOf(r.objects, "ramp-1").ramp?.headingRad).toBeCloseTo(-2, 9);
    expect(crestOf(r.objects, "ramp-1").centerX).toBe(100);
    expect(crestOf(r.objects, "ramp-2")).toEqual(crestOf(o, "ramp-2"));
  });
  it("is refused when the headings already match, even by a full turn", () => {
    const a = area();
    const o = two([100, 100, 1], [200, 160, 1 + 2 * Math.PI]);
    expect(alignRamp(o, "ramp-1", "ramp-2", "match", a)).toEqual({
      ok: false,
      reason: ALIGN_SAME_HEADING,
    });
  });
});

describe("alignRamp lineUp", () => {
  it("slides sideways onto the other ramp's centre line, distance along it unchanged", () => {
    const a = area();
    const o = two([100, 140, 0.4], [250, 100, 0]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "lineUp", a);
    if (!r.ok) throw new Error(r.reason);
    const moved = crestOf(r.objects, "ramp-1");
    expect(moved.centerX).toBeCloseTo(100, 9);
    expect(moved.centerZ).toBeCloseTo(100, 9);
    expect(moved.ramp?.headingRad).toBe(0.4); // heading untouched
    expect(moved.ramp?.widthM).toBe(10);
    expect(crestOf(r.objects, "ramp-2")).toEqual(crestOf(o, "ramp-2"));
  });
  it("is refused when already on the line or coincident", () => {
    const a = area();
    const inLine = two([100, 100, 0], [250, 100, 0]);
    expect(alignRamp(inLine, "ramp-1", "ramp-2", "lineUp", a)).toEqual({
      ok: false,
      reason: ALIGN_ALREADY_IN_LINE,
    });
    const same = two([100, 100, 0], [100, 100, 0]);
    expect(alignRamp(same, "ramp-1", "ramp-2", "lineUp", a)).toEqual({
      ok: false,
      reason: ALIGN_COINCIDENT,
    });
  });
  it("refuses a slide that would leave the area", () => {
    const a = area();
    // Target line is z = 4 (inside), but a 10 m wide ramp needs 5 m of margin.
    const o = two([100, 100, 0], [250, 4, 0]);
    const r = alignRamp(o, "ramp-1", "ramp-2", "lineUp", a);
    expect(r).toEqual({ ok: false, reason: RAMP_OUTSIDE_REASON });
  });
});
