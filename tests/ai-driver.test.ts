import { describe, expect, it } from "vitest";
import {
  type AiDriverParams,
  createAiDriver,
  defaultAiDriverParams,
  lookAheadDistanceM,
  pursuitSteer,
} from "../src/core/ai-driver";
import aiDriverSource from "../src/core/ai-driver.ts?raw";
import type { RacingLine, RacingLinePoint } from "../src/core/racing-line";
import racingLineSource from "../src/core/racing-line.ts?raw";
import { defaultTuning } from "../src/core/vehicle-tuning";

const tuning = defaultTuning();

/** A straight, flat, constant-speed synthetic racing line along +X, z=0, spaced 1m apart. */
function buildStraightLine(length = 200, targetSpeedMs = 30): RacingLine {
  const points: RacingLinePoint[] = [];
  for (let i = 0; i < length; i++) {
    points.push(
      Object.freeze({
        x: i,
        y: 0,
        z: 0,
        centreX: i,
        centreZ: 0,
        halfWidthM: 4,
        surface: "tarmac",
        arcM: i,
        curvature: 0,
        targetSpeedMs,
      }),
    );
  }
  return Object.freeze({
    courseId: "synthetic-straight",
    points: Object.freeze(points),
    lapLengthM: length,
    checkpointArcM: Object.freeze([length]),
  });
}

describe("pursuitSteer", () => {
  it("car at origin facing +X (heading 0), target (10, 3) returns steer > 0 (RIGHT)", () => {
    const steer = pursuitSteer(0, 0, 0, 10, 3, 20, 3.1, Math.PI / 4);
    expect(steer).toBeGreaterThan(0);
  });

  it("car at origin facing +X (heading 0), target (10, -3) returns steer < 0 (LEFT)", () => {
    const steer = pursuitSteer(0, 0, 0, 10, -3, 20, 3.1, Math.PI / 4);
    expect(steer).toBeLessThan(0);
  });

  it("target dead ahead returns 0", () => {
    const steer = pursuitSteer(0, 0, 0, 10, 0, 20, 3.1, Math.PI / 4);
    expect(steer).toBeCloseTo(0, 9);
  });

  it("result is always in [-1, 1]", () => {
    for (const target of [
      { x: 1, z: 100 },
      { x: -50, z: -1 },
      { x: 0.001, z: 0.001 },
    ]) {
      const steer = pursuitSteer(0, 0, 0, target.x, target.z, 6, 3.1, Math.PI / 4);
      expect(steer).toBeGreaterThanOrEqual(-1);
      expect(steer).toBeLessThanOrEqual(1);
    }
  });
});

describe("lookAheadDistanceM", () => {
  const params: AiDriverParams = defaultAiDriverParams(tuning);

  it("speed 0 clamps to lookAheadMinM (6)", () => {
    expect(lookAheadDistanceM(0, params)).toBe(6);
  });

  it("speed 100 clamps to lookAheadMaxM (40)", () => {
    expect(lookAheadDistanceM(100, params)).toBe(40);
  });

  it("speed 20 with gain 0.9 is 18", () => {
    expect(lookAheadDistanceM(20, params)).toBeCloseTo(18, 9);
  });
});

describe("createAiDriver: tracking a synthetic straight line", () => {
  it("a car 0.5m left of the line, aligned, at 30 m/s yields |steer| < 0.05, steering back toward the line", () => {
    const line = buildStraightLine();
    const driver = createAiDriver(line, defaultAiDriverParams(tuning));
    driver.observe({ x: 50, z: -0.5, headingRad: 0, forwardSpeedMs: 30 });
    const frame = driver.sampleForTick(0);
    expect(Math.abs(frame.steer)).toBeLessThan(0.05);
    // Right vector convention (src/core/racing-line.ts buildGridPoses):
    // right = (-tz, tx); for tangent (1, 0) that is (0, 1) -- +Z is RIGHT.
    // The car sits at z = -0.5 (to the left of the z=0 line), so correcting
    // back toward the line means steering RIGHT (positive).
    expect(frame.steer).toBeGreaterThan(0);
  });

  it("every frame stays in bounds: steer in [-1,1], throttle/brake in [0,1], handbrake false, never throttle>0 and brake>0 together", () => {
    const line = buildStraightLine();
    const driver = createAiDriver(line, defaultAiDriverParams(tuning));
    const observations = [
      { x: 0, z: 0, headingRad: 0, forwardSpeedMs: 0 },
      { x: 20, z: 2, headingRad: 0.3, forwardSpeedMs: 15 },
      { x: 60, z: -3, headingRad: -0.5, forwardSpeedMs: 40 },
      { x: 100, z: 0, headingRad: Math.PI, forwardSpeedMs: 5 },
      { x: 150, z: 1, headingRad: -Math.PI + 0.1, forwardSpeedMs: 25 },
    ];
    for (let tick = 0; tick < observations.length; tick++) {
      driver.observe(observations[tick]);
      const frame = driver.sampleForTick(tick);
      expect(frame.steer).toBeGreaterThanOrEqual(-1);
      expect(frame.steer).toBeLessThanOrEqual(1);
      expect(frame.throttle).toBeGreaterThanOrEqual(0);
      expect(frame.throttle).toBeLessThanOrEqual(1);
      expect(frame.brake).toBeGreaterThanOrEqual(0);
      expect(frame.brake).toBeLessThanOrEqual(1);
      expect(frame.handbrake).toBe(false);
      expect(frame.throttle > 0 && frame.brake > 0).toBe(false);
    }
  });

  it("brake === 0 whenever forwardSpeedMs < brakeMinSpeedMs (1.5), even far above target speed", () => {
    // A slow-moving car (1.0 m/s) observed against a line point whose target
    // speed is far below current -- near vehicle.ts's reverse-engagement
    // threshold, brake must stay 0 to avoid accidentally reversing it.
    const line = buildStraightLine(200, 0.1);
    const driver = createAiDriver(line, defaultAiDriverParams(tuning));
    driver.observe({ x: 50, z: 0, headingRad: 0, forwardSpeedMs: 1.0 });
    const frame = driver.sampleForTick(0);
    expect(frame.brake).toBe(0);
  });

  it("sampleForTick(t) called twice for the same t returns equal frames; a new observe() between them does not change tick t's cached frame", () => {
    const line = buildStraightLine();
    const driver = createAiDriver(line, defaultAiDriverParams(tuning));
    driver.observe({ x: 10, z: 0, headingRad: 0, forwardSpeedMs: 20 });
    const first = driver.sampleForTick(5);
    driver.observe({ x: 999, z: 999, headingRad: 2, forwardSpeedMs: 99 });
    const second = driver.sampleForTick(5);
    expect(second).toEqual(first);
  });
});

describe("source guard: ai-driver.ts and racing-line.ts are blind to player/placement/race-standing state (T-07-04)", () => {
  const forbidden = [
    "race-state",
    "race-placement",
    "player",
    "rubber",
    "catchUp",
    "Math.random",
    "Date.now",
  ];

  function nonCommentLines(source: string): string[] {
    return source.split("\n").filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
    });
  }

  it("ai-driver.ts has no non-comment reference to any forbidden term", () => {
    const lines = nonCommentLines(aiDriverSource);
    for (const term of forbidden) {
      const hits = lines.filter((line) => line.includes(term));
      expect(hits).toEqual([]);
    }
  });

  it("racing-line.ts has no non-comment reference to any forbidden term", () => {
    const lines = nonCommentLines(racingLineSource);
    for (const term of forbidden) {
      const hits = lines.filter((line) => line.includes(term));
      expect(hits).toEqual([]);
    }
  });
});
