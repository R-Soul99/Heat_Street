import { describe, expect, it } from "vitest";
import { parseDriveHeading } from "../../src/core/map-select.ts";
import {
  buildDriveUrl,
  buildRouteTestUrl,
  buildStageTestUrl,
  yawToHeadingDeg,
} from "./drive-url.ts";

describe("buildDriveUrl", () => {
  it("builds the start form", () => {
    expect(buildDriveUrl("demo-hills", { start: "start-2" })).toBe(
      "/?map=demo-hills&start=start-2&debug",
    );
  });
  it("builds the at form with heading", () => {
    expect(buildDriveUrl("m", { at: { x: 1.234, z: -5 }, headingDeg: 90.04 })).toBe(
      "/?map=m&at=1.2,-5.0&heading=90.0&debug",
    );
  });
  it("omits heading when absent and normalises into [0, 360)", () => {
    expect(buildDriveUrl("m", { at: { x: 0, z: 0 } })).toBe("/?map=m&at=0.0,0.0&debug");
    expect(buildDriveUrl("m", { at: { x: 0, z: 0 }, headingDeg: -90 })).toContain("heading=270.0");
    expect(buildDriveUrl("m", { at: { x: 0, z: 0 }, headingDeg: 359.99 })).toContain("heading=0.0");
  });
  it("encodes the map id", () => {
    expect(buildDriveUrl("a b&c", { start: "start-1" })).toContain("map=a%20b%26c");
  });
});

describe("yawToHeadingDeg", () => {
  it("agrees with parseDriveHeading", () => {
    for (const deg of [0, 90, 180, 270]) {
      const yaw = parseDriveHeading(`?heading=${deg}.0`) as number;
      expect(yawToHeadingDeg(yaw)).toBeCloseTo(deg, 6);
    }
    expect(yawToHeadingDeg(-Math.PI / 2)).toBeCloseTo(270, 6);
  });
});

describe("test-drive urls", () => {
  it("builds stage and route urls", () => {
    expect(buildStageTestUrl("demo-hills", "dust-run")).toBe(
      "/?map=demo-hills&mode=stage&stage=dust-run&debug",
    );
    expect(buildRouteTestUrl("demo-hills", "p2p", "demo-hills-route-1")).toBe(
      "/?map=demo-hills&mode=p2p&route=demo-hills-route-1&debug",
    );
    expect(buildRouteTestUrl("a b", "circuit", "r/1")).toBe(
      "/?map=a%20b&mode=circuit&route=r%2F1&debug",
    );
  });
});
