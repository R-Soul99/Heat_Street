import { describe, expect, it } from "vitest";
import { forwardFromYaw } from "../src/core/heading";
import {
  createStageRun,
  crossedGateForward,
  FINISH_GATE_ID,
  formatStageTime,
  type StageRunCourse,
  stageSplitLine,
} from "../src/core/stage-run";

const W = 10;

function rel(h: number, fwd: number, side: number) {
  const f = forwardFromYaw(h);
  const rx = Math.cos(h);
  const rz = -Math.sin(h);
  return { x: f.x * fwd + rx * side, z: f.z * fwd + rz * side };
}

describe("crossedGateForward", () => {
  for (const deg of [0, 45, 90]) {
    const h = (deg * Math.PI) / 180;
    const gate = { x: 0, z: 0, headingRad: h, widthM: W };
    it(`crosses forward, not backward, rotation ${deg}`, () => {
      expect(crossedGateForward(gate, rel(h, -1, 0), rel(h, 1, 0))).toBe(true);
      expect(crossedGateForward(gate, rel(h, 1, 0), rel(h, -1, 0))).toBe(false);
    });
    it(`respects width, rotation ${deg}`, () => {
      expect(crossedGateForward(gate, rel(h, -1, W / 2 + 0.1), rel(h, 1, W / 2 + 0.1))).toBe(false);
      expect(crossedGateForward(gate, rel(h, -1, W / 2 - 0.1), rel(h, 1, W / 2 - 0.1))).toBe(true);
    });
  }

  it("counts a sideways slide with positive forward velocity", () => {
    const gate = { x: 0, z: 0, headingRad: 0, widthM: W };
    expect(crossedGateForward(gate, { x: -1, z: 0.5 }, { x: 1, z: -0.5 }, { vx: 8, vz: -1 })).toBe(
      true,
    );
  });

  it("rejects when velocity dot forward <= 0", () => {
    const gate = { x: 0, z: 0, headingRad: 0, widthM: W };
    expect(crossedGateForward(gate, { x: 0, z: 1 }, { x: 0, z: -1 }, { vx: 5, vz: 0 })).toBe(false);
  });
});

const course: StageRunCourse = {
  start: { x: 0, z: 20, headingRad: 0.3 },
  gates: [
    { id: "g1", x: 0, z: 0, headingRad: 0, widthM: W },
    { id: "g2", x: 0, z: -20, headingRad: 0.5, widthM: W },
  ],
  finish: { x: 0, z: -40, headingRad: 0, widthM: W },
};

function pass(run: ReturnType<typeof createStageRun>, z: number, y = 1) {
  run.update({ x: 0, y, z: z + 1, vx: 0, vz: -10 });
  return run.update({ x: 0, y, z: z - 1, vx: 0, vz: -10 });
}

describe("createStageRun", () => {
  it("seeds on the first update and never fires on tick one", () => {
    const run = createStageRun(course);
    expect(run.update({ x: 0, y: 1, z: -1, vx: 0, vz: -10 })).toEqual({});
    expect(run.snapshot().nextGateIndex).toBe(0);
  });

  it("enforces order and finish only after all gates", () => {
    const run = createStageRun(course);
    expect(pass(run, -20)).toEqual({});
    expect(pass(run, -40)).toEqual({});
    expect(run.snapshot().nextGateIndex).toBe(0);
    expect(pass(run, 0)).toEqual({ passedGateId: "g1" });
    expect(run.snapshot().nextGateIndex).toBe(1);
    expect(run.snapshot().targetId).toBe("g2");
    expect(pass(run, -20)).toEqual({ passedGateId: "g2" });
    expect(run.snapshot().nextGateIndex).toBe(2);
    expect(run.snapshot().targetId).toBe(FINISH_GATE_ID);
    expect(run.snapshot().targetPosition).toEqual({ x: 0, z: -40 });
    expect(pass(run, -40)).toEqual({ finished: true });
    expect(run.snapshot().complete).toBe(true);
    expect(run.snapshot().targetPosition).toBeNull();
    expect(pass(run, -40)).toEqual({});
  });

  it("applies the height window", () => {
    const run = createStageRun(course, () => 0);
    expect(pass(run, 0, 15)).toEqual({});
    expect(pass(run, 0, 1)).toEqual({ passedGateId: "g1" });
  });

  it("respawn pose after 0, 1 and all gates", () => {
    const run = createStageRun(course);
    const h = () => 10;
    expect(run.respawnPose(h)).toEqual({ x: 0, y: 10.6, z: 20, headingRad: 0.3 });
    pass(run, 0);
    expect(run.respawnPose(h)).toEqual({ x: 0, y: 10.6, z: 0, headingRad: 0 });
    pass(run, -20);
    expect(run.respawnPose(h)).toEqual({ x: 0, y: 10.6, z: -20, headingRad: 0.5 });
  });

  it("respawn adds a penalty and clears the previous sample; reset clears all", () => {
    const run = createStageRun(course);
    run.update({ x: 0, y: 1, z: 1, vx: 0, vz: -10 });
    run.respawn();
    expect(run.snapshot().penaltySec).toBe(5);
    expect(run.update({ x: 0, y: 1, z: -1, vx: 0, vz: -10 })).toEqual({});
    run.respawn();
    expect(run.snapshot().penaltySec).toBe(10);
    pass(run, 0);
    run.reset();
    const s = run.snapshot();
    expect(s.penaltySec).toBe(0);
    expect(s.nextGateIndex).toBe(0);
    expect(s.complete).toBe(false);
  });
});

describe("formatting", () => {
  it("formats times", () => {
    expect(formatStageTime(72.48)).toBe("01:12.48");
    expect(formatStageTime(5)).toBe("00:05.00");
    expect(formatStageTime(Number.NaN)).toBe("--:--.--");
  });

  it("builds split lines", () => {
    const faster = stageSplitLine("G1", 31.2, 32.0);
    expect(faster.text).toContain("G1");
    expect(faster.text).toContain("00:31.20");
    expect(faster.text).toContain("(-0.8)");
    expect(faster.tone).toBe("faster");
    const slower = stageSplitLine("G1", 31.2, 29.4);
    expect(slower.text).toContain("(+1.8)");
    expect(slower.tone).toBe("slower");
    const none = stageSplitLine("G1", 31.2, undefined);
    expect(none.text).not.toContain("(");
    expect(none.tone).toBe("neutral");
  });
});
