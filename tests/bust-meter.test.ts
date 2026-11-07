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

  it("boxed in but still moving is never busted; boxed in and stuck is", () => {
    const box = (speedMs: number) => () => ({
      player: { x: 0, z: 0, speedMs },
      pursuers: [
        { x: 4, z: 0 },
        { x: -4, z: 0 },
      ],
    });
    for (const speed of [25, 8, 5, 3]) {
      const s = run(box(speed), 30);
      expect(s.boxed).toBe(true);
      expect(s.busted).toBe(false);
    }
    expect(run(box(0.5), 12).busted).toBe(true);
    expect(run(box(0), 12).busted).toBe(true);
  });

  it("two pursuers on the same side never box in, even on a stopped player", () => {
    const sameSide = run(
      () => ({
        player: still,
        pursuers: [
          { x: 5, z: 0 },
          { x: 7, z: 1 },
        ],
      }),
      30,
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

  it("a flipped player being shoved along at speed is busted by one close pursuer", () => {
    const shoved = { x: 0, z: 0, speedMs: 13, disabled: true };
    const s = run(() => ({ player: shoved, pursuers: [{ x: 3, z: 0 }] }), 10);
    expect(s.busted).toBe(true);
    // Same speed, same pursuer, car upright: nothing like a bust.
    const upright = run(
      () => ({ player: { ...shoved, disabled: false }, pursuers: [{ x: 3, z: 0 }] }),
      10,
    );
    expect(upright.busted).toBe(false);
    // Flipped with nobody near is not a bust.
    const alone = run(() => ({ player: shoved, pursuers: [{ x: 80, z: 0 }] }), 10);
    expect(alone.level).toBe(0);
  });
});
