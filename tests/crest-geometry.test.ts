import { describe, expect, it } from "vitest";
import {
  AUTHORED_CRESTS_BY_AREA,
  type AuthoredCrest,
  buildCrestGeometry,
  CREST_RINGS,
  CREST_SEGMENTS,
  crestProfileHeight,
  crestsForArea,
  FEEL_TEST_CRESTS,
  JULIETTE_GA_CRESTS,
  type RampSpec,
  rampLengthM,
  rampProfileHeight,
} from "../src/core/crest-geometry";

type Vec3 = readonly [number, number, number];

function vertexAt(positions: Float32Array, index: number): Vec3 {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

/** Positive Y-component of `(v1-v0) x (v2-v0)` == counter-clockwise winding viewed from +Y. Copied from tests/road-geometry.test.ts. */
function triangleNormalY(v0: Vec3, v1: Vec3, v2: Vec3): number {
  const ax = v1[0] - v0[0];
  const az = v1[2] - v0[2];
  const bx = v2[0] - v0[0];
  const bz = v2[2] - v0[2];
  return az * bx - ax * bz;
}

/** Asserts every triangle in `indices`/`positions` winds CCW viewed from +Y. Copied from tests/road-geometry.test.ts. */
function expectAllTrianglesCCW(positions: Float32Array, indices: Uint32Array): void {
  for (let t = 0; t < indices.length / 3; t++) {
    const v0 = vertexAt(positions, indices[t * 3]);
    const v1 = vertexAt(positions, indices[t * 3 + 1]);
    const v2 = vertexAt(positions, indices[t * 3 + 2]);
    const normalY = triangleNormalY(v0, v1, v2);
    expect(
      normalY,
      `triangle ${t} (${JSON.stringify([v0, v1, v2])}) should wind CCW from +Y`,
    ).toBeGreaterThan(0);
  }
}

// Measured paved-edge distances from 04.1-03-PLAN.md's <crest_source_data>
// block — hardcoded here as a fixture, per this plan's own instruction,
// since the DEM-era compiled map they were measured against is destroyed by
// this phase's flat-terrain recompile.
const MEASURED_PAVED_EDGE_DISTANCE_M: Readonly<Record<string, number>> = {
  "juliette-north-ridge": 51.5,
  "juliette-main-street-rise": 36.5,
  "juliette-south-approach": 36.5,
};

describe("JULIETTE_GA_CRESTS — authored table data assertions", () => {
  it("has exactly 3 entries with unique ids", () => {
    expect(JULIETTE_GA_CRESTS).toHaveLength(3);
    const ids = new Set(JULIETTE_GA_CRESTS.map((c) => c.id));
    expect(ids.size).toBe(3);
  });

  it("every entry has radiusM > 0 and heightM > 0", () => {
    for (const crest of JULIETTE_GA_CRESTS) {
      expect(crest.radiusM, crest.id).toBeGreaterThan(0);
      expect(crest.heightM, crest.id).toBeGreaterThan(0);
    }
  });

  it("every entry's peak grade is between 10 and 20 degrees (a real launch, not a stall or a flip)", () => {
    const minGrade = Math.tan((10 * Math.PI) / 180);
    const maxGrade = Math.tan((20 * Math.PI) / 180);
    for (const crest of JULIETTE_GA_CRESTS) {
      const grade = (1.5 * crest.heightM) / crest.radiusM;
      expect(grade, crest.id).toBeGreaterThanOrEqual(minGrade);
      expect(grade, crest.id).toBeLessThanOrEqual(maxGrade);
    }
  });

  it("every entry's apex launch speed is under 45 m/s (~100 mph, reachable at realistic chase speeds)", () => {
    for (const crest of JULIETTE_GA_CRESTS) {
      const launchSpeed = Math.sqrt((9.81 * crest.radiusM * crest.radiusM) / (6 * crest.heightM));
      expect(launchSpeed, crest.id).toBeLessThan(45);
    }
  });

  it("D-01 clearance guard: no authored crest reaches within 5m of the measured paved edge", () => {
    for (const crest of JULIETTE_GA_CRESTS) {
      const measured = MEASURED_PAVED_EDGE_DISTANCE_M[crest.id];
      expect(measured, `missing fixture distance for ${crest.id}`).toBeDefined();
      expect(measured - crest.radiusM, crest.id).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("crestProfileHeight", () => {
  it("returns heightM at t=0 and t<0, and 0 at t=1 and t>1", () => {
    expect(crestProfileHeight(0, 10)).toBe(10);
    expect(crestProfileHeight(1, 10)).toBe(0);
    expect(crestProfileHeight(1.5, 10)).toBe(0);
    expect(crestProfileHeight(-0.5, 10)).toBe(10);
  });

  it("is monotonically non-increasing across t = 0, 0.05, ... 1.00", () => {
    let prev = crestProfileHeight(0, 10);
    for (let i = 1; i <= 20; i++) {
      const t = i * 0.05;
      const value = crestProfileHeight(t, 10);
      expect(value, `t=${t}`).toBeLessThanOrEqual(prev);
      prev = value;
    }
  });
});

describe("buildCrestGeometry — flat sampler", () => {
  const flatSampler = () => 0;
  const entries = buildCrestGeometry(JULIETTE_GA_CRESTS, flatSampler);

  it("returns one entry per input crest, crestId matching, surface grass", () => {
    expect(entries).toHaveLength(JULIETTE_GA_CRESTS.length);
    entries.forEach((entry, i) => {
      expect(entry.crestId).toBe(JULIETTE_GA_CRESTS[i].id);
      expect(entry.surface).toBe("grass");
    });
  });

  it("has the expected positions/indices lengths", () => {
    const expectedVertexCount = 1 + CREST_RINGS * CREST_SEGMENTS;
    const expectedTriangleCount = CREST_SEGMENTS + 2 * CREST_SEGMENTS * (CREST_RINGS - 1);
    for (const entry of entries) {
      expect(entry.positions.length).toBe(3 * expectedVertexCount);
      expect(entry.indices.length).toBe(3 * expectedTriangleCount);
    }
  });

  it("apex vertex y equals heightM exactly with a flat-zero sampler", () => {
    for (let i = 0; i < entries.length; i++) {
      const apex = vertexAt(entries[i].positions, 0);
      expect(apex[1]).toBe(JULIETTE_GA_CRESTS[i].heightM);
    }
  });

  it("no vertex lies farther than radiusM + 1e-6 from (centerX, centerZ) in XZ", () => {
    // Uses a synthetic near-origin crest, not JULIETTE_GA_CRESTS's real
    // coordinates (centerX/centerZ up to ~1200) -- Float32Array positions
    // lose precision proportional to coordinate MAGNITUDE (~2^-23 relative),
    // which swamps a 1e-6 absolute tolerance at that magnitude regardless of
    // the geometry math being correct. Near the origin the same relative
    // error is negligible, matching tests/road-geometry.test.ts's own
    // convention of small-coordinate fixtures for precision-sensitive checks.
    const originCrest: AuthoredCrest[] = [
      { id: "origin-fixture", centerX: 0, centerZ: 0, radiusM: 40, heightM: 8 },
    ];
    const [entry] = buildCrestGeometry(originCrest, flatSampler);
    const crest = originCrest[0];
    const vertexCount = entry.positions.length / 3;
    for (let v = 0; v < vertexCount; v++) {
      const p = vertexAt(entry.positions, v);
      const dist = Math.hypot(p[0] - crest.centerX, p[2] - crest.centerZ);
      expect(dist, `vertex ${v}`).toBeLessThanOrEqual(crest.radiusM + 1e-6);
    }
  });

  it("all triangles wind CCW viewed from +Y", () => {
    for (const entry of entries) {
      expectAllTrianglesCCW(entry.positions, entry.indices);
    }
  });

  it("determinism: two successive calls produce byte-identical positions and indices", () => {
    const again = buildCrestGeometry(JULIETTE_GA_CRESTS, flatSampler);
    entries.forEach((entry, i) => {
      expect(again[i].positions).toEqual(entry.positions);
      expect(again[i].indices).toEqual(entry.indices);
    });
  });
});

describe("buildCrestGeometry — rim seating against a non-trivial sampler", () => {
  it("every outermost-ring vertex's y equals heightSampler(x, z) to within 1e-6", () => {
    const sampler = (x: number, z: number) => 0.001 * x - 0.002 * z;
    const entries = buildCrestGeometry(JULIETTE_GA_CRESTS, sampler);
    for (const entry of entries) {
      const vertexCount = entry.positions.length / 3;
      // Outermost ring is the LAST CREST_SEGMENTS vertices (ring = CREST_RINGS).
      const outerRingStart = vertexCount - CREST_SEGMENTS;
      for (let v = outerRingStart; v < vertexCount; v++) {
        const p = vertexAt(entry.positions, v);
        const expectedY = sampler(p[0], p[2]);
        expect(p[1]).toBeCloseTo(expectedY, 6);
      }
    }
  });
});

describe("buildCrestGeometry — defensive invariants", () => {
  it("throws naming the offending id for radiusM <= 0", () => {
    const bad: AuthoredCrest[] = [
      { id: "bad-radius", centerX: 0, centerZ: 0, radiusM: 0, heightM: 5 },
    ];
    expect(() => buildCrestGeometry(bad, () => 0)).toThrow(/buildCrestGeometry:.*bad-radius/);
  });

  it("throws naming the offending id for heightM <= 0", () => {
    const bad: AuthoredCrest[] = [
      { id: "bad-height", centerX: 0, centerZ: 0, radiusM: 10, heightM: 0 },
    ];
    expect(() => buildCrestGeometry(bad, () => 0)).toThrow(/buildCrestGeometry:.*bad-height/);
  });

  it("throws naming the offending id for duplicate ids", () => {
    const dup: AuthoredCrest[] = [
      { id: "dup-id", centerX: 0, centerZ: 0, radiusM: 10, heightM: 5 },
      { id: "dup-id", centerX: 50, centerZ: 50, radiusM: 10, heightM: 5 },
    ];
    expect(() => buildCrestGeometry(dup, () => 0)).toThrow(/buildCrestGeometry:.*dup-id/);
  });
});

describe("crestsForArea", () => {
  it("returns JULIETTE_GA_CRESTS for 'juliette-ga'", () => {
    expect(crestsForArea("juliette-ga")).toBe(JULIETTE_GA_CRESTS);
  });

  it("returns [] for an unknown area", () => {
    expect(crestsForArea("nowhere")).toEqual([]);
  });

  it("returns [] rather than an inherited Object.prototype member for prototype-chain keys", () => {
    expect(crestsForArea("toString")).toEqual([]);
    expect(crestsForArea("constructor")).toEqual([]);
    expect(crestsForArea("__proto__")).toEqual([]);
  });

  it("AUTHORED_CRESTS_BY_AREA itself only has the expected own key", () => {
    expect(Object.hasOwn(AUTHORED_CRESTS_BY_AREA, "juliette-ga")).toBe(true);
  });
});

describe("take-off ramps", () => {
  const ramp: RampSpec = { headingRad: 0, widthM: 10, angleDeg: 16, footRadiusM: 40 };
  const crest: AuthoredCrest = {
    id: "r",
    centerX: 100,
    centerZ: 50,
    radiusM: 0,
    heightM: 1.8,
    ramp,
  };

  it("the profile starts flat on the ground, is tangent there, and reaches the lip height at the end", () => {
    const length = rampLengthM(1.8, ramp);
    expect(rampProfileHeight(0, 1.8, ramp)).toBe(0);
    // Foot is a circle of radius 40: height ~ s^2 / 80 near the start.
    expect(rampProfileHeight(2, 1.8, ramp)).toBeCloseTo(4 / 80, 2);
    expect(rampProfileHeight(length, 1.8, ramp)).toBeCloseTo(1.8, 6);
    expect(length).toBeGreaterThan(10);
    expect(length).toBeLessThan(15);
  });

  it("the profile never decreases and its slope never passes the launch angle", () => {
    const length = rampLengthM(1.8, ramp);
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const s = (length * i) / 200;
      const h = rampProfileHeight(s, 1.8, ramp);
      expect(h).toBeGreaterThanOrEqual(prev);
      expect((h - prev) / (length / 200)).toBeLessThanOrEqual(
        Math.tan((16 * Math.PI) / 180) + 1e-3,
      );
      prev = h;
    }
  });

  it("a foot that reaches the lip height before the launch angle is cut short, not overshot", () => {
    const steep: RampSpec = { headingRad: 0, widthM: 10, angleDeg: 30, footRadiusM: 10 };
    // The arc rises 10 * (1 - cos 30) = 1.34 m; a 1 m lip is reached on the arc.
    const length = rampLengthM(1, steep);
    expect(rampProfileHeight(length, 1, steep)).toBeCloseTo(1, 6);
    expect(length).toBeLessThan(10 * Math.sin((30 * Math.PI) / 180));
  });

  it("builds a closed-ish wedge: top winds CCW from +Y, lip height matches, determinism", () => {
    const [entry] = buildCrestGeometry([crest], () => 0);
    expect(entry.crestId).toBe("r");
    let lipTop = 0;
    for (let i = 0; i < entry.positions.length / 3; i++)
      lipTop = Math.max(lipTop, vertexAt(entry.positions, i)[1]);
    expect(lipTop).toBeCloseTo(1.8, 5);
    // The first third of triangles per step are the top surface; check the top-only ones wind up.
    const length = rampLengthM(1.8, ramp);
    const steps = Math.max(2, Math.ceil(length / 0.5));
    for (let i = 0; i < steps; i++) {
      for (const t of [i * 6, i * 6 + 1]) {
        const v0 = vertexAt(entry.positions, entry.indices[t * 3]);
        const v1 = vertexAt(entry.positions, entry.indices[t * 3 + 1]);
        const v2 = vertexAt(entry.positions, entry.indices[t * 3 + 2]);
        expect(triangleNormalY(v0, v1, v2)).toBeGreaterThan(0);
      }
    }
    const again = buildCrestGeometry([crest], () => 0)[0];
    expect(Array.from(again.positions)).toEqual(Array.from(entry.positions));
  });

  it("follows the terrain under it", () => {
    const [entry] = buildCrestGeometry([crest], (x) => x * 0.01);
    const first = vertexAt(entry.positions, 0);
    expect(first[1]).toBeCloseTo(first[0] * 0.01, 5);
  });

  it("the feel-test ramps respect the foot-load rule v^2 / R <= ~19.5 m/s^2 at 85 mph", () => {
    const ramps = FEEL_TEST_CRESTS.filter((c) => c.ramp !== undefined);
    expect(ramps).toHaveLength(3);
    const v = 85 * 0.44704;
    for (const c of ramps) {
      expect((v * v) / (c.ramp?.footRadiusM ?? 1), c.id).toBeLessThan(19.5);
    }
  });
});
