import { describe, expect, it } from "vitest";
import {
  AI_PAINTS,
  AI_RACER_COUNT,
  coastFrame,
  COUNTDOWN_STEP_TICKS,
  COUNTDOWN_TICKS,
  countdownState,
  HOLD_FRAME,
  PLAYER_GRID_SLOT,
  RACE_FIELD_SIZE,
} from "../src/core/race-start";
import { NEUTRAL } from "../src/core/input-tape";

describe("countdownState", () => {
  it("holds each label for one COUNTDOWN_STEP_TICKS-tick step", () => {
    expect(countdownState(0)).toEqual({ label: "3", released: false });
    expect(countdownState(59)).toEqual({ label: "3", released: false });
    expect(countdownState(60)).toEqual({ label: "2", released: false });
    expect(countdownState(120)).toEqual({ label: "1", released: false });
    expect(countdownState(179)).toEqual({ label: "1", released: false });
    expect(countdownState(180)).toEqual({ label: "GO", released: true });
    expect(countdownState(239)).toEqual({ label: "GO", released: true });
    expect(countdownState(240)).toEqual({ label: null, released: true });
  });

  it("COUNTDOWN_STEP_TICKS is 60 and COUNTDOWN_TICKS is 180", () => {
    expect(COUNTDOWN_STEP_TICKS).toBe(60);
    expect(COUNTDOWN_TICKS).toBe(180);
  });

  it("stays released forever once GO has fired", () => {
    expect(countdownState(1000).released).toBe(true);
    expect(countdownState(1000).label).toBeNull();
  });
});

describe("HOLD_FRAME", () => {
  it("deep-equals NEUTRAL, so a held car never engages reverse (brake is 0)", () => {
    expect(HOLD_FRAME).toEqual(NEUTRAL);
    expect(HOLD_FRAME.brake).toBe(0);
  });
});

describe("coastFrame", () => {
  const base = { steer: 0.42, throttle: 1, brake: 0, handbrake: true };

  it("keeps steer, zeroes throttle, brakes gently, drops handbrake, once genuinely moving", () => {
    expect(coastFrame(base, 10)).toEqual({
      steer: 0.42,
      throttle: 0,
      brake: 0.5,
      handbrake: false,
    });
  });

  it("does not brake a near-stationary car (would engage reverse)", () => {
    expect(coastFrame(base, 1.0).brake).toBe(0);
  });
});

describe("AI_PAINTS", () => {
  it("has exactly 3 entries with distinct hex values", () => {
    expect(AI_PAINTS).toHaveLength(3);
    const hexes = AI_PAINTS.map((p) => p.hex);
    expect(new Set(hexes).size).toBe(3);
  });

  it("each css equals '#' + hex as 6-digit lowercase", () => {
    for (const paint of AI_PAINTS) {
      expect(paint.css).toBe(`#${paint.hex.toString(16).padStart(6, "0")}`);
    }
  });

  it("none equals the player's chassis red (0xb5321f)", () => {
    for (const paint of AI_PAINTS) {
      expect(paint.hex).not.toBe(0xb5321f);
    }
  });
});

describe("field constants", () => {
  it("RACE_FIELD_SIZE is 4, AI_RACER_COUNT is 3, PLAYER_GRID_SLOT is 3", () => {
    expect(RACE_FIELD_SIZE).toBe(4);
    expect(AI_RACER_COUNT).toBe(3);
    expect(PLAYER_GRID_SLOT).toBe(3);
  });
});
