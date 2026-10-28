import { describe, expect, it } from "vitest";
import {
  cycleSpeed,
  DEFAULT_STATION_SPEED_MPH,
  launchVelocity,
  parseStations,
  STATION_SPEEDS_MPH,
} from "../src/debug/test-stations";

const station = { id: "a", key: "1", name: "A", note: "n", x: 1, z: 2, headingRad: -Math.PI / 2 };

describe("test stations", () => {
  it("parses a stations file and rejects the wrong area or a bad field", () => {
    const text = JSON.stringify({ areaId: "feel-test", stations: [station] });
    expect(parseStations(text, "feel-test")).toEqual([station]);
    expect(() => parseStations(text, "grid-test")).toThrow();
    expect(() =>
      parseStations(
        JSON.stringify({ areaId: "feel-test", stations: [{ ...station, x: "1" }] }),
        "feel-test",
      ),
    ).toThrow(/stations\[0\]/);
    expect(() => parseStations("nope", "feel-test")).toThrow();
  });

  it("launches along the heading: east (-pi/2) is +x, and zero speed is still", () => {
    const v = launchVelocity(-Math.PI / 2, 70);
    expect(v.x).toBeCloseTo(70 * 0.44704, 6);
    expect(v.z).toBeCloseTo(0, 6);
    expect(launchVelocity(0, 0)).toEqual({ x: -0, y: 0, z: -0 });
    // heading 0 is north (-z)
    expect(launchVelocity(0, 10).z).toBeLessThan(0);
  });

  it("cycles speed within the list and clamps at the ends", () => {
    expect(cycleSpeed(DEFAULT_STATION_SPEED_MPH, 1)).toBe(80);
    expect(cycleSpeed(DEFAULT_STATION_SPEED_MPH, -1)).toBe(60);
    expect(cycleSpeed(STATION_SPEEDS_MPH[0], -1)).toBe(0);
    expect(cycleSpeed(100, 1)).toBe(100);
    expect(cycleSpeed(55, 1)).toBe(80);
  });
});
