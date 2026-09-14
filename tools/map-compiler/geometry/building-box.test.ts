import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeProjector, type Projector } from "../graph/project.ts";
import type { ElevationSampler } from "../sources/dem.ts";
import {
  axisAlignedArea,
  type BuildingsEnvelopeLike,
  buildingBoxes,
  DEFAULT_HEIGHT_M,
  MIN_BUILDING_AREA_SQM,
  PER_LEVEL_HEIGHT_M,
} from "./building-box.ts";

const projector: Projector = makeProjector({ lat: 33.1, lon: -83.8 });

/** A ground sampler returning a fixed height everywhere, for tests that don't care about slope. */
const FLAT_GROUND: ElevationSampler = { sample: () => 42 };

/** Builds a synthetic Overpass "buildings" envelope from raw way payloads, matching the real shape. */
function makeEnvelope(
  ways: readonly {
    id: number;
    geometry: readonly { lat: number; lon: number }[];
    tags?: Record<string, string>;
  }[],
): BuildingsEnvelopeLike {
  return {
    response: {
      elements: ways.map((w) => ({
        type: "way" as const,
        id: w.id,
        geometry: w.geometry,
        tags: w.tags,
      })),
    },
  };
}

/** A closed square footprint (metres, in local ENU), centred at the origin, rotated by `degrees`. */
function squareFootprintLatLon(
  halfSizeM: number,
  degrees: number,
  center: { x: number; z: number } = { x: 0, z: 0 },
): { lat: number; lon: number }[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localCorners = [
    { x: -halfSizeM, z: -halfSizeM },
    { x: halfSizeM, z: -halfSizeM },
    { x: halfSizeM, z: halfSizeM },
    { x: -halfSizeM, z: halfSizeM },
  ];
  const rotated = localCorners.map((p) => ({
    x: p.x * cos - p.z * sin + center.x,
    z: p.x * sin + p.z * cos + center.z,
  }));
  const closed = [...rotated, rotated[0]];
  return closed.map((p) => projector.unproject(p.x, p.z));
}

describe("buildingBoxes", () => {
  it("produces an OBB matching a square footprint's own edges (zero rotation error, equal area)", () => {
    const geometry = squareFootprintLatLon(5, 0);
    const envelope = makeEnvelope([{ id: 1, geometry, tags: { building: "yes" } }]);

    const { boxes, report } = buildingBoxes(envelope, projector, FLAT_GROUND);

    expect(boxes).toHaveLength(1);
    expect(report.skipped.degenerate).toBe(0);
    expect(report.skipped.tinyArea).toBe(0);
    // A 10m x 10m square has area 100 sq m; the OBB over its own corners must match exactly.
    expect(boxes[0].areaSqM).toBeCloseTo(100, 6);
  });

  it("produces an OBB rotated with a 30-degree-rotated footprint, area within 1% and strictly smaller than the AABB", () => {
    const geometry = squareFootprintLatLon(5, 30);
    const envelope = makeEnvelope([{ id: 2, geometry, tags: { building: "yes" } }]);

    const { boxes } = buildingBoxes(envelope, projector, FLAT_GROUND);

    expect(boxes).toHaveLength(1);
    const trueAreaSqM = 100;
    expect(Math.abs(boxes[0].areaSqM - trueAreaSqM) / trueAreaSqM).toBeLessThan(0.01);

    // Recompute the same footprint's plain axis-aligned bounding box area
    // independently, to prove the OBB (not an AABB wearing its name) is
    // actually the smaller of the two for a rotated shape.
    const footprintLocal = geometry.slice(0, -1).map((ll) => projector.project(ll.lat, ll.lon));
    const aabbArea = axisAlignedArea(footprintLocal);
    expect(boxes[0].areaSqM).toBeLessThan(aabbArea);
  });

  it('parses height "8" and "8 m" as 8.0m; an unparseable value falls through', () => {
    const geometry = squareFootprintLatLon(5, 0);
    const envelope = makeEnvelope([
      { id: 10, geometry, tags: { building: "yes", height: "8" } },
      { id: 11, geometry, tags: { building: "yes", height: "8 m" } },
      { id: 12, geometry, tags: { building: "yes", height: "not-a-number" } },
    ]);

    const { boxes } = buildingBoxes(envelope, projector, FLAT_GROUND);

    expect(boxes[0].heightM).toBeCloseTo(8.0, 6);
    expect(boxes[0].heightSource).toBe("explicit");
    expect(boxes[1].heightM).toBeCloseTo(8.0, 6);
    expect(boxes[1].heightSource).toBe("explicit");
    // Unparseable height falls through to the type-default rule (no levels tag either).
    expect(boxes[2].heightSource).toBe("type-default");
    expect(boxes[2].heightM).toBeCloseTo(DEFAULT_HEIGHT_M, 6);
  });

  it("building:levels of 3 yields 3x the per-level height", () => {
    const geometry = squareFootprintLatLon(5, 0);
    const envelope = makeEnvelope([
      { id: 20, geometry, tags: { building: "yes", "building:levels": "3" } },
    ]);

    const { boxes } = buildingBoxes(envelope, projector, FLAT_GROUND);

    expect(boxes[0].heightSource).toBe("levels");
    expect(boxes[0].heightM).toBeCloseTo(3 * PER_LEVEL_HEIGHT_M, 6);
  });

  it("building=commercial with no height tags yields the commercial default; building=house yields the residential default", () => {
    const geometry = squareFootprintLatLon(5, 0);
    const envelope = makeEnvelope([
      { id: 30, geometry, tags: { building: "commercial" } },
      { id: 31, geometry, tags: { building: "house" } },
      { id: 32, geometry, tags: { building: "residential" } },
    ]);

    const { boxes } = buildingBoxes(envelope, projector, FLAT_GROUND);

    expect(boxes[0].heightSource).toBe("type-default");
    expect(boxes[0].heightM).toBeCloseTo(12.0, 6);
    expect(boxes[1].heightM).toBeCloseTo(6.8, 6);
    expect(boxes[2].heightM).toBeCloseTo(6.8, 6);
  });

  it("emits 8 vertices and 10 triangles per prism (4 walls + roof; floor omitted), all outward-facing", () => {
    const geometry = squareFootprintLatLon(5, 0);
    const envelope = makeEnvelope([{ id: 40, geometry, tags: { building: "yes", height: "5" } }]);

    const { boxes } = buildingBoxes(envelope, projector, FLAT_GROUND);
    const box = boxes[0];

    expect(box.positions).toHaveLength(8 * 3);
    expect(box.indices).toHaveLength(10 * 3);

    // Every triangle's face normal, dotted with the direction from the box
    // centre to that triangle's own centroid, must be non-negative -- i.e.
    // every face points away from the box's interior (outward).
    const cx = 0;
    const cz = 0;
    const cy = 42 + 2.5; // ground(42) + half of height(5)
    for (let t = 0; t < box.indices.length; t += 3) {
      const ia = box.indices[t];
      const ib = box.indices[t + 1];
      const ic = box.indices[t + 2];
      const a = [box.positions[ia * 3], box.positions[ia * 3 + 1], box.positions[ia * 3 + 2]];
      const b = [box.positions[ib * 3], box.positions[ib * 3 + 1], box.positions[ib * 3 + 2]];
      const c = [box.positions[ic * 3], box.positions[ic * 3 + 1], box.positions[ic * 3 + 2]];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const triCenter = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      const outward = [triCenter[0] - cx, triCenter[1] - cy, triCenter[2] - cz];
      const dot = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2];
      expect(dot).toBeGreaterThanOrEqual(0);
    }

    // Floor omitted: no triangle uses only the four base-vertex indices (0-3).
    for (let t = 0; t < box.indices.length; t += 3) {
      const tri = [box.indices[t], box.indices[t + 1], box.indices[t + 2]];
      const allBase = tri.every((i) => i < 4);
      expect(allBase).toBe(false);
    }
  });

  it("seats a prism's base Y at the DEM ground height sampled at the footprint centroid", () => {
    const geometry = squareFootprintLatLon(5, 0);
    const envelope = makeEnvelope([{ id: 50, geometry, tags: { building: "yes", height: "4" } }]);
    const slopedGround: ElevationSampler = { sample: () => 123.5 };

    const { boxes } = buildingBoxes(envelope, projector, slopedGround);
    const box = boxes[0];

    // Base vertices are indices 0-3; every one must sit at the sampled ground height.
    for (let i = 0; i < 4; i++) {
      expect(box.positions[i * 3 + 1]).toBeCloseTo(123.5, 6);
    }
    // Top vertices (4-7) must sit exactly heightM above the base.
    for (let i = 4; i < 8; i++) {
      expect(box.positions[i * 3 + 1]).toBeCloseTo(123.5 + 4, 6);
    }
  });

  it("skips and counts a footprint with fewer than 3 distinct points, rather than throwing", () => {
    // A "footprint" that collapses to 2 distinct points once the closing
    // duplicate is removed: A, B, A(closing) -> only {A, B} survive.
    const geometry = [
      { lat: 33.1, lon: -83.8 },
      { lat: 33.10005, lon: -83.8 },
      { lat: 33.1, lon: -83.8 }, // closing duplicate
    ];
    const envelope = makeEnvelope([{ id: 60, geometry, tags: { building: "yes" } }]);

    expect(() => buildingBoxes(envelope, projector, FLAT_GROUND)).not.toThrow();
    const { boxes, report } = buildingBoxes(envelope, projector, FLAT_GROUND);
    expect(boxes).toHaveLength(0);
    expect(report.skipped.degenerate).toBe(1);
  });

  it("skips and counts a footprint whose OBB area is below the noise threshold", () => {
    // A 2m x 2m square: 4 sq m, well under MIN_BUILDING_AREA_SQM (12).
    const geometry = squareFootprintLatLon(1, 0);
    const envelope = makeEnvelope([{ id: 70, geometry, tags: { building: "shed" } }]);

    const { boxes, report } = buildingBoxes(envelope, projector, FLAT_GROUND);

    expect(boxes).toHaveLength(0);
    expect(report.skipped.tinyArea).toBe(1);
    // Sanity: the synthetic footprint really is below the threshold.
    expect(4).toBeLessThan(MIN_BUILDING_AREA_SQM);
  });

  it("reports the height-source breakdown across explicit/levels/type-default", () => {
    const geometry = squareFootprintLatLon(5, 0);
    const envelope = makeEnvelope([
      { id: 80, geometry, tags: { building: "yes", height: "9" } },
      { id: 81, geometry, tags: { building: "yes", "building:levels": "2" } },
      { id: 82, geometry, tags: { building: "yes" } },
    ]);

    const { report } = buildingBoxes(envelope, projector, FLAT_GROUND);

    expect(report.boxCount).toBe(3);
    expect(report.heightSource.explicit).toBe(1);
    expect(report.heightSource.levels).toBe(1);
    expect(report.heightSource.typeDefault).toBe(1);
  });

  it("produces at least 10 boxes against the real committed juliette-ga.raw-buildings.json, with a height-source breakdown", async () => {
    const filePath = path.join(
      import.meta.dirname,
      "..",
      "areas",
      "juliette-ga.raw-buildings.json",
    );
    const raw = JSON.parse(await readFile(filePath, "utf8")) as BuildingsEnvelopeLike;
    const realProjector = makeProjector({ lat: 33.1093, lon: -83.8095 });

    const { boxes, report } = buildingBoxes(raw, realProjector, FLAT_GROUND);

    expect(boxes.length).toBeGreaterThanOrEqual(10);
    // Recorded in SUMMARY.md: actual count and height-source breakdown.
    expect(report.boxCount).toBe(boxes.length);
    expect(
      report.heightSource.explicit + report.heightSource.levels + report.heightSource.typeDefault,
    ).toBe(boxes.length);
  });
});
