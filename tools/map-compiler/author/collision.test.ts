import { describe, expect, it } from "vitest";
import { MAP_COLLISION_VERSION, parseMapCollision } from "../../../src/core/map-collision.ts";
import { type BuildingsEnvelopeLike, buildingBoxes } from "../geometry/building-box.ts";
import { makeProjector, type Projector } from "../graph/project.ts";
import type { ElevationSampler } from "../sources/dem.ts";
import { buildMapCollision } from "./collision.ts";
import { HEIGHTFIELD_SINK_M, type HeightfieldGrid } from "./heightfield.ts";

const projector: Projector = makeProjector({ lat: 33.1, lon: -83.8 });
const FLAT_GROUND: ElevationSampler = { sample: () => 100 };

/**
 * Constructs a perfectly flat `HeightfieldGrid` fixture directly, without
 * going through `./heightfield.ts`'s `buildOffRoadRelief` (phase 04.1 —
 * that function now varies with seeded procedural noise, which would break
 * this file's exact-value grounding-math assertions below; the relief
 * generator has its own dedicated coverage in `heightfield.test.ts`). Plain
 * data construction, matching `HeightfieldGrid`'s own field-for-field shape.
 */
function makeFlatHeightfield(
  valueM: number,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  resolution: number,
): HeightfieldGrid {
  const samplesPerAxis = resolution + 1;
  const heights = new Float32Array(samplesPerAxis * samplesPerAxis).fill(
    valueM - HEIGHTFIELD_SINK_M,
  );
  return {
    rows: resolution,
    cols: resolution,
    heights,
    originX: bounds.minX,
    originZ: bounds.minZ,
    scaleX: bounds.maxX - bounds.minX,
    scaleZ: bounds.maxZ - bounds.minZ,
    sinkM: HEIGHTFIELD_SINK_M,
  };
}

/** A minimal, valid heightfield fixture — this file's own tests exercise `buildMapCollision`'s building half; the heightfield half has its own dedicated suite in `heightfield.test.ts`. */
const FLAT_HEIGHTFIELD: HeightfieldGrid = makeFlatHeightfield(
  100,
  { minX: -50, minZ: -50, maxX: 50, maxZ: 50 },
  2,
);

/**
 * A heightfield sampled well ABOVE every `realBoxes()`/`FLAT_GROUND` building
 * (which all sit at groundY=100) — used by tests that want to verify the
 * building collider's plain, unextended midpoint math (plan 04-11's
 * `Math.min(groundY, localTerrainY)` extension never triggers when the local
 * terrain reads higher than the building's own ground level).
 */
const HIGH_FLAT_HEIGHTFIELD: HeightfieldGrid = makeFlatHeightfield(
  1000,
  { minX: -50, minZ: -50, maxX: 50, maxZ: 50 },
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

  it("center.y is the box's vertical midpoint — a collider at center +/- halfExtents.y sits exactly on the sampled ground and exactly at the roof, when the local terrain is not lower than the ground", () => {
    const boxes = realBoxes();
    // HIGH_FLAT_HEIGHTFIELD, not FLAT_HEIGHTFIELD: this test is about the
    // plain midpoint math with no grounding extension in play (see the
    // dedicated extension test below for that behaviour).
    const collision = buildMapCollision("juliette-ga", boxes, HIGH_FLAT_HEIGHTFIELD);
    for (let i = 0; i < boxes.length; i++) {
      const groundY = boxes[i].positions[1]; // base corner 0's Y
      const roofY = groundY + boxes[i].heightM;
      const building = collision.buildings[i];
      expect(building.center.y - building.halfExtents.y).toBeCloseTo(groundY, 6);
      expect(building.center.y + building.halfExtents.y).toBeCloseTo(roofY, 6);
    }
  });

  // Plan 04-11: a car driving on the (sunk) off-road heightfield near a
  // building sat at true ground level could pass clean underneath the
  // building's collider -- "I can still pass through buildings, not sure if
  // it's under or through". Fails against the pre-fix code, which always
  // bottomed the collider at the building's own groundY regardless of how
  // far below it the local terrain sat.
  it("extends the collider's bottom down to the local (sunk) heightfield height, closing the pass-under gap", () => {
    const boxes = realBoxes();
    const collision = buildMapCollision("juliette-ga", boxes, FLAT_HEIGHTFIELD);
    for (let i = 0; i < boxes.length; i++) {
      const groundY = boxes[i].positions[1];
      const roofY = groundY + boxes[i].heightM;
      const building = collision.buildings[i];
      const bottomY = building.center.y - building.halfExtents.y;
      // FLAT_HEIGHTFIELD samples 100 everywhere, sunk by HEIGHTFIELD_SINK_M
      // -> local terrain reads (100 - HEIGHTFIELD_SINK_M), strictly below
      // groundY (100).
      // Precision 4, not 6 (phase 04.1 lowered HEIGHTFIELD_SINK_M 4.5 -> 0.1,
      // shifting this expected value from 95.5, exactly representable in
      // Float32Array, to 99.9, which is not): `heights` is a Float32Array
      // (this module's own header comment), and f32's ~7-digit relative
      // precision only guarantees ~4-5 decimal places of ABSOLUTE precision
      // for a value in the hundreds -- same rounding note heightfield.test.ts
      // and tests/map-scene.test.ts already document for this reason.
      expect(bottomY).toBeCloseTo(100 - HEIGHTFIELD_SINK_M, 4);
      expect(bottomY).toBeLessThan(groundY);
      // The roof never moves -- only the bottom extends downward.
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
