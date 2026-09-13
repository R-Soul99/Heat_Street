import { describe, expect, it } from "vitest";
import { makeProjector } from "./project.ts";

// Juliette, GA bbox centre, matching tools/map-compiler/areas/juliette-ga.config.ts's
// actual bbox — real latitude, not an arbitrary round number, so the
// metres-per-degree series is exercised at a realistic value.
const ORIGIN = { lat: 33.1093, lon: -83.8095 };

describe("makeProjector", () => {
  it("projects the origin itself to exactly {x: 0, z: 0}", () => {
    const projector = makeProjector(ORIGIN);
    const { x, z } = projector.project(ORIGIN.lat, ORIGIN.lon);
    expect(x).toBe(0);
    expect(z).toBe(0);
  });

  it("projects a point 0.001 degrees east to positive x of roughly 93m at latitude 33.1", () => {
    const projector = makeProjector(ORIGIN);
    const { x, z } = projector.project(ORIGIN.lat, ORIGIN.lon + 0.001);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeCloseTo(93, 0);
    expect(z).toBeCloseTo(0, 6);
  });

  it("projects a point 0.001 degrees north to NEGATIVE z of roughly 111m (Z points south)", () => {
    const projector = makeProjector(ORIGIN);
    const { x, z } = projector.project(ORIGIN.lat + 0.001, ORIGIN.lon);
    expect(z).toBeLessThan(0);
    expect(z).toBeCloseTo(-111, 0);
    expect(x).toBeCloseTo(0, 6);
  });

  it("projects a point south of the origin to a POSITIVE z", () => {
    const projector = makeProjector(ORIGIN);
    const { z } = projector.project(ORIGIN.lat - 0.001, ORIGIN.lon);
    expect(z).toBeGreaterThan(0);
  });

  it("round-trips project -> unproject back to the original lat/lon within 1e-9 degrees", () => {
    const projector = makeProjector(ORIGIN);
    const cases: Array<[number, number]> = [
      [ORIGIN.lat, ORIGIN.lon],
      [ORIGIN.lat + 0.0047, ORIGIN.lon - 0.0031],
      [ORIGIN.lat - 0.0123, ORIGIN.lon + 0.0089],
    ];
    for (const [lat, lon] of cases) {
      const { x, z } = projector.project(lat, lon);
      const back = projector.unproject(x, z);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-9);
      expect(Math.abs(back.lon - lon)).toBeLessThan(1e-9);
    }
  });

  it("unprojects {x: 0, z: 0} back to exactly the origin", () => {
    const projector = makeProjector(ORIGIN);
    const back = projector.unproject(0, 0);
    expect(back.lat).toBeCloseTo(ORIGIN.lat, 9);
    expect(back.lon).toBeCloseTo(ORIGIN.lon, 9);
  });

  it("scales roughly linearly for a larger offset (sanity check against a doubled distance)", () => {
    const projector = makeProjector(ORIGIN);
    const near = projector.project(ORIGIN.lat, ORIGIN.lon + 0.001);
    const far = projector.project(ORIGIN.lat, ORIGIN.lon + 0.002);
    expect(far.x).toBeCloseTo(near.x * 2, 0);
  });
});
