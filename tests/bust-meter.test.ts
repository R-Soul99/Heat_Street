import { describe, expect, it } from "vitest";
import {
  type BustInput,
  type BustState,
  INITIAL_BUST_STATE,
  stepBustMeter,
} from "../src/core/bust-meter";

const DT = 1 / 60;

function run(
  input: (t: number) => Omit<BustInput, "dtSec">,
  seconds: number,
  from: BustState = INITIAL_BUST_STATE,
): BustState {
  let s = from;
  for (let k = 0; k < Math.round(seconds * 60); k++)
    s = stepBustMeter(s, { dtSec: DT, ...input(k * DT) });
  return s;
}

const still = { x: 0, z: 0, speedMs: 0 };
const fast = { x: 0, z: 0, speedMs: 30 };

describe("bust meter", () => {
  it("a lone pursuer, however close, raises the meter but can never bust a stopped player", () => {
    const after1 = run(() => ({ player: still, pursuers: [{ x: 3, z: 0 }] }), 1);
    expect(after1.level).toBeGreaterThan(0.1);
    const after30 = run(() => ({ player: still, pursuers: [{ x: 3, z: 0 }] }), 30);
    expect(after30.busted).toBe(false);
    expect(after30.level).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(after30.level).toBeGreaterThan(0.35);
  });

  it("boxing in a stopped player takes seconds, never instantly", () => {
    const box = () => ({
      player: still,
      pursuers: [
        { x: 3, z: 0 },
        { x: -3, z: 0 },
      ],
    });
    expect(run(box, 1).busted).toBe(false);
    expect(run(box, 8).busted).toBe(true);
  });

  it("pursuers behind a building (not visible) neither press nor box in", () => {
    const hidden = run(
      () => ({
        player: still,
        pursuers: [
          { x: 3, z: 0, visible: false },
          { x: -3, z: 0, visible: false },
        ],
      }),
      20,
    );
    expect(hidden.level).toBe(0);
    expect(hidden.boxed).toBe(false);
    // One visible + one hidden is not a box.
    const half = run(
      () => ({
        player: still,
        pursuers: [
          { x: 3, z: 0 },
          { x: -3, z: 0, visible: false },
        ],
      }),
      20,
    );
    expect(half.busted).toBe(false);
    expect(half.boxed).toBe(false);
  });

  it("hidden-but-near pursuers still stop you counting as escaped", () => {
    const s = run(() => ({ player: fast, pursuers: [{ x: 30, z: 0, visible: false }] }), 20);
    expect(s.escaped).toBe(false);
  });

  it("a fast player with a pursuer glued alongside is not busted", () => {
    const s = run(() => ({ player: fast, pursuers: [{ x: 3, z: 0 }] }), 20);
    expect(s.busted).toBe(false);
    expect(s.level).toBeLessThan(0.05);
  });

  it("two pursuers on opposite sides box a moving player in", () => {
    const moving = { x: 0, z: 0, speedMs: 25 };
    const boxed = run(
      () => ({
        player: moving,
        pursuers: [
          { x: 5, z: 0 },
          { x: -5, z: 0 },
        ],
      }),
      12,
    );
    expect(boxed.boxed).toBe(true);
    expect(boxed.busted).toBe(true);
    const sameSide = run(
      () => ({
        player: moving,
        pursuers: [
          { x: 5, z: 0 },
          { x: 7, z: 1 },
        ],
      }),
      12,
    );
    expect(sameSide.busted).toBe(false);
  });

  it("drains when the pursuer drops away", () => {
    const filled = run(() => ({ player: still, pursuers: [{ x: 3, z: 0 }] }), 3);
    expect(filled.level).toBeGreaterThan(0.3);
    const drained = run(() => ({ player: still, pursuers: [{ x: 60, z: 0 }] }), 6, filled);
    expect(drained.level).toBe(0);
  });

  it("latches ESCAPED after staying far away, and BUSTED stays busted", () => {
    const escaped = run(() => ({ player: fast, pursuers: [{ x: 200, z: 0 }] }), 7);
    expect(escaped.escaped).toBe(true);
    const busted = run(
      () => ({
        player: still,
        pursuers: [
          { x: 2, z: 0 },
          { x: -2, z: 0 },
        ],
      }),
      8,
    );
    expect(busted.busted).toBe(true);
    const later = run(() => ({ player: fast, pursuers: [{ x: 500, z: 0 }] }), 5, busted);
    expect(later.busted).toBe(true);
    expect(later.escaped).toBe(false);
  });

  it("no pursuers means nothing happens and nothing is nearest", () => {
    const s = run(() => ({ player: still, pursuers: [] }), 3);
    expect(s.level).toBe(0);
    expect(s.nearestM).toBe(Number.POSITIVE_INFINITY);
  });
});
