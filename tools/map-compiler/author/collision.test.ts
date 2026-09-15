import { describe, expect, it } from "vitest";
import { MAP_COLLISION_VERSION, parseMapCollision } from "../../../src/core/map-collision.ts";
import { type BuildingsEnvelopeLike, buildingBoxes } from "../geometry/building-box.ts";
import { makeProjector, type Projector } from "../graph/project.ts";
import type { ElevationSampler } from "../sources/dem.ts";
import { buildMapCollision } from "./collision.ts";
import { buildHeightfield, type HeightfieldGrid } from "./heightfield.ts";

const projector: Projector = makeProjector({ lat: 33.1, lon: -83.8 });
const FLAT_GROUND: ElevationSampler = { sample: () => 100 };

/** A minimal, valid heightfield fixture — this file's own tests exercise `buildMapCollision`'s building half; the heightfield half has its own dedicated suite in `heightfield.test.ts`. */
const FLAT_HEIGHTFIELD: HeightfieldGrid = buildHeightfield(
  FLAT_GROUND,
  { minX: -50, minZ: -50, maxX: 50, maxZ: 50 },
  projector,
  2,
);

/** The same fixture, shaped as the plain-array JSON block `parseMapCollision` expects on the wire (see `MapCollisionHeightfield`'s doc comment on why `heights` is a plain array, not a `Float32Array`). */
function rawHeightfield() {
  return {
    rows: FLAT_HEIGHTFIELD.rows,
    cols: FLAT_HEIGHTFIELD.cols,
    heights: Array.from(FLAT_HEIGHTFIELD.heights),
    originX: FLAT_HEIGHTFIELD.originX,
    originZ: FLAT_HEIGHTFIELD.originZ,
    scaleX: FLAT_HEIGHTFIELD.scaleX,
    scaleZ: FLAT_HEIGHTFIELD.scaleZ,
    sinkM: FLAT_HEIGHTFIELD.sinkM,
  };
}

/** A closed square footprint (metres, local ENU), centred at `center`, rotated by `degrees`. */
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

/** Two real, non-degenerate buildings (one axis-aligned, one rotated 30deg) via the real buildingBoxes() pipeline. */
function realBoxes() {
  const envelope = makeEnvelope([
    { id: 101, geometry: squareFootprintLatLon(5, 0), tags: { building: "house" } },
    {
      id: 102,
      geometry: squareFootprintLatLon(4, 30, { x: 60, z: 20 }),
      tags: { building: "commercial" },
    },
  ]);
  const { boxes, report } = buildingBoxes(envelope, projector, FLAT_GROUND);
  expect(report.skipped.degenerate).toBe(0);
  expect(report.skipped.tinyArea).toBe(0);
  expect(boxes).toHaveLength(2);
  return boxes;
}

describe("buildMapCollision", () => {
  it("declares collisionVersion 2 and the same areaId as its companion .map.json", () => {
    const collision = buildMapCollision("juliette-ga", realBoxes(), FLAT_HEIGHTFIELD);
    expect(collision.collisionVersion).toBe(2);
    expect(collision.collisionVersion).toBe(MAP_COLLISION_VERSION);
    expect(collision.areaId).toBe("juliette-ga");
  });

  it("gives each building entry center {x,y,z}, halfExtents {x,y,z} and rotationY in radians", () => {
    const collision = buildMapCollision("juliette-ga", realBoxes(), FLAT_HEIGHTFIELD);
    expect(collision.buildings.length).toBeGreaterThan(0);
    for (const building of collision.buildings) {
      expect(typeof building.center.x).toBe("number");
      expect(typeof building.center.y).toBe("number");
      expect(typeof building.center.z).toBe("number");
      expect(typeof building.halfExtents.x).toBe("number");
      expect(typeof building.halfExtents.y).toBe("number");
      expect(typeof building.halfExtents.z).toBe("number");
      expect(typeof building.rotationY).toBe("number");
      expect(Number.isFinite(building.rotationY)).toBe(true);
    }
  });

  it("center.y is the box's vertical midpoint — a collider at center +/- halfExtents.y sits exactly on the sampled ground and exactly at the roof", () => {
    const boxes = realBoxes();
    const collision = buildMapCollision("juliette-ga", boxes, FLAT_HEIGHTFIELD);
    for (let i = 0; i < boxes.length; i++) {
      const groundY = boxes[i].positions[1]; // base corner 0's Y
      const roofY = groundY + boxes[i].heightM;
      const building = collision.buildings[i];
      expect(building.center.y - building.halfExtents.y).toBeCloseTo(groundY, 6);
      expect(building.center.y + building.halfExtents.y).toBeCloseTo(roofY, 6);
    }
  });

  it("halfExtents match the real footprint's own edge half-lengths (axis-aligned case, no rotation ambiguity)", () => {
    // A 10x10 square (halfSizeM=5) has two 10m edges -> both halfExtents = 5.
    const envelope = makeEnvelope([
      { id: 201, geometry: squareFootprintLatLon(5, 0), tags: { building: "house" } },
    ]);
    const { boxes } = buildingBoxes(envelope, projector, FLAT_GROUND);
    const collision = buildMapCollision("juliette-ga", boxes, FLAT_HEIGHTFIELD);
    expect(collision.buildings[0].halfExtents.x).toBeCloseTo(5, 3);
    expect(collision.buildings[0].halfExtents.z).toBeCloseTo(5, 3);
  });
});

describe("parseMapCollision", () => {
  it("accepts the real emitted sidecar and returns a typed object", () => {
    const collision = buildMapCollision("juliette-ga", realBoxes(), FLAT_HEIGHTFIELD);
    const raw = JSON.stringify(collision);
    const parsed = parseMapCollision(raw, "juliette-ga", "test-fixture");
    expect(parsed.collisionVersion).toBe(2);
    expect(parsed.areaId).toBe("juliette-ga");
    expect(parsed.buildings).toHaveLength(collision.buildings.length);
    expect(parsed.buildings[0].center.x).toBeCloseTo(collision.buildings[0].center.x, 6);
  });

  it("throws naming both versions on a version mismatch", () => {
    const raw = JSON.stringify({
      collisionVersion: 1,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: rawHeightfield(),
    });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(
      /collisionVersion.*\b1\b.*\b2\b|collisionVersion.*\b2\b.*\b1\b/,
    );
  });

  it("throws naming the index on a malformed building entry", () => {
    const raw = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [
        { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 }, rotationY: 0 },
        { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }, // missing rotationY
      ],
      heightfield: rawHeightfield(),
    });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(
      /buildings\[1\]/,
    );
  });

  it("throws naming the artifact on invalid JSON", () => {
    expect(() =>
      parseMapCollision("not json {{{", "juliette-ga", "test-fixture.json"),
    ).toThrowError(/test-fixture\.json/);
  });

  it("throws when the sidecar's areaId does not match the caller's expected area id, naming both", () => {
    const raw = JSON.stringify({
      collisionVersion: 2,
      areaId: "wrong-town",
      buildings: [],
      heightfield: rawHeightfield(),
    });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(
      /expected "juliette-ga".*found "wrong-town"|juliette-ga[\s\S]*wrong-town/,
    );
  });

  it("throws naming both versions when the heightfield's heights array length is wrong", () => {
    const bad = rawHeightfield();
    const raw = JSON.stringify({
      collisionVersion: 2,
      areaId: "juliette-ga",
      buildings: [],
      heightfield: { ...bad, heights: bad.heights.slice(0, -1) },
    });
    expect(() => parseMapCollision(raw, "juliette-ga", "test-fixture")).toThrowError(
      new RegExp(`${bad.heights.length}.*${bad.heights.length - 1}`),
    );
  });

  it("reconstructs every field explicitly and never spreads the parsed value (prototype-pollution guard, T-04-01)", () => {
    // `__proto__` as a JS object-literal key sets the prototype rather than an
    // own property, so this fixture is built as a raw JSON STRING (matching
    // the original test's approach) — `JSON.parse` treats `"__proto__"` as an
    // ordinary data key, which is exactly the attack this test guards against.
    const raw = `{"collisionVersion":2,"areaId":"juliette-ga","buildings":[],"heightfield":${JSON.stringify(rawHeightfield())},"__proto__":{"polluted":true}}`;
    const parsed = parseMapCollision(raw, "juliette-ga", "test-fixture");
    expect((parsed as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Only the four named top-level keys survive reconstruction.
    expect(Object.keys(parsed).sort()).toEqual([
      "areaId",
      "buildings",
      "collisionVersion",
      "heightfield",
    ]);
  });
});

describe("byte-identical re-emit", () => {
  it("emitting twice from the same inputs produces a byte-identical sidecar", () => {
    const boxes = realBoxes();
    const first = JSON.stringify(
      buildMapCollision("juliette-ga", boxes, FLAT_HEIGHTFIELD),
      null,
      2,
    );
    const second = JSON.stringify(
      buildMapCollision("juliette-ga", boxes, FLAT_HEIGHTFIELD),
      null,
      2,
    );
    expect(first).toBe(second);
  });
});
