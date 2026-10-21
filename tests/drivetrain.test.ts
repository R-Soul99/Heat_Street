import { describe, expect, it } from "vitest";
import { engineForceScale, gearForSpeed } from "../src/core/drivetrain";

const TOP = 48;

describe("drivetrain", () => {
  it("pulls hardest in first gear and zero at top speed", () => {
    expect(engineForceScale(0, TOP)).toBeGreaterThan(1.5);
    expect(engineForceScale(TOP, TOP)).toBe(0);
    expect(engineForceScale(TOP * 2, TOP)).toBe(0);
  });

  it("shifts up monotonically with speed", () => {
    let prev = 0;
    for (let v = 0; v < TOP; v += 0.5) {
      const g = gearForSpeed(v, TOP);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(prev).toBe(4);
  });

  it("is never negative and treats reverse speed as first gear", () => {
    for (let v = -5; v < TOP + 5; v += 0.25) {
      expect(engineForceScale(v, TOP)).toBeGreaterThanOrEqual(0);
    }
    expect(engineForceScale(-3, TOP)).toBe(engineForceScale(0, TOP));
  });
});
