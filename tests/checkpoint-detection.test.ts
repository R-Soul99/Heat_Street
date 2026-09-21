import { describe, expect, it } from "vitest";
import type { CourseCheckpoint } from "../src/core/course";
import { containsCheckpoint, detectCheckpointHit } from "../src/core/checkpoint-detection";

const checkpoint: CourseCheckpoint = {
  id: "cp-1",
  nodeId: 1,
  edgeId: 1,
  position: [10, 0, 20],
  sensor: { widthM: 20, depthM: 30, heightM: 12 },
};

describe("checkpoint detection", () => {
  it("accepts a broad airborne chassis point inside the sensor volume", () => {
    expect(containsCheckpoint([19.9, 5.9, 34.9], checkpoint)).toBe(true);
    expect(containsCheckpoint([20.1, 5.9, 34.9], checkpoint)).toBe(false);
    expect(containsCheckpoint([19.9, 6.1, 34.9], checkpoint)).toBe(false);
  });

  it("emits once while occupied and emits again only after leaving", () => {
    const first = detectCheckpointHit([10, 2, 20], checkpoint, false);
    const sustained = detectCheckpointHit([10, 2, 20], checkpoint, first.inside);
    const afterLeaving = detectCheckpointHit([100, 2, 20], checkpoint, sustained.inside);
    const reentry = detectCheckpointHit([10, 2, 20], checkpoint, afterLeaving.inside);

    expect(first).toEqual({ hit: true, inside: true });
    expect(sustained).toEqual({ hit: false, inside: true });
    expect(afterLeaving).toEqual({ hit: false, inside: false });
    expect(reentry).toEqual({ hit: true, inside: true });
  });

  it("rejects non-finite positions and sensor dimensions", () => {
    expect(containsCheckpoint([Number.NaN, 0, 0], checkpoint)).toBe(false);
    expect(
      containsCheckpoint([10, 0, 20], {
        ...checkpoint,
        sensor: { widthM: Number.POSITIVE_INFINITY, depthM: 30, heightM: 12 },
      }),
    ).toBe(false);
  });
});