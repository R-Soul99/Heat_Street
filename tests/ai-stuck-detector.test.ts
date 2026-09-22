import { describe, expect, it } from "vitest";
import {
  createStuckDetector,
  deriveAiDebugState,
  driveOutFrame,
  STUCK_PARAMS,
  type StuckAction,
  type StuckInput,
} from "../src/core/ai-stuck-detector";

const DT = 1 / 60;
const LAP_LENGTH_M = 1000;

/** A far-away player by default so reset-deferral never interferes with tests that aren't specifically about it. */
const FAR_PLAYER_M = 1000;

function baseInput(overrides: Partial<StuckInput> = {}): StuckInput {
  return {
    dtSec: DT,
    groundSpeedMs: 5,
    tiltDeg: 0,
    throttleCommanded: 0,
    arcM: 0,
    distanceToPlayerM: FAR_PLAYER_M,
    ...overrides,
  };
}

describe("STUCK_PARAMS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(STUCK_PARAMS)).toBe(true);
  });
});

describe("createStuckDetector — racing: stuck hysteresis", () => {
  it("groundSpeed 0.5 with throttleCommanded 1 for 2.5s returns begin-recovery exactly once, phase becomes recovering", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    const actions: StuckAction[] = [];
    for (let i = 0; i < 300; i++) {
      actions.push(
        detector.update(baseInput({ groundSpeedMs: 0.5, throttleCommanded: 1, arcM: 0 })),
      );
      if (detector.snapshot().phase === "recovering") break;
    }
    const beginRecoveryCount = actions.filter((a) => a === "begin-recovery").length;
    expect(beginRecoveryCount).toBe(1);
    expect(detector.snapshot().phase).toBe("recovering");
  });

  it("groundSpeed 0.5 with throttleCommanded 0 never triggers", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    for (let i = 0; i < 300; i++) {
      const action = detector.update(
        baseInput({ groundSpeedMs: 0.5, throttleCommanded: 0, arcM: 0 }),
      );
      expect(action).toBe("none");
    }
    expect(detector.snapshot().phase).toBe("racing");
    expect(detector.snapshot().stuckSec).toBe(0);
  });

  it("speed dipping to 0.8 then 2.0 (between enter 1.0 and exit 4.0) does not reset stuckSec; reaching 4.0 resets it to 0", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    // Accumulate some stuckSec at 0.8 (below enter 1.0).
    for (let i = 0; i < 60; i++) {
      detector.update(baseInput({ groundSpeedMs: 0.8, throttleCommanded: 1, arcM: 0 }));
    }
    const afterAccumulate = detector.snapshot().stuckSec;
    expect(afterAccumulate).toBeGreaterThan(0);

    // Move into the hysteresis band (2.0, between enter and exit) — must not reset.
    for (let i = 0; i < 30; i++) {
      detector.update(baseInput({ groundSpeedMs: 2.0, throttleCommanded: 1, arcM: 0 }));
    }
    expect(detector.snapshot().stuckSec).toBeGreaterThanOrEqual(afterAccumulate);
    expect(detector.snapshot().phase).toBe("racing");

    // Reach the exit threshold — resets to 0.
    detector.update(baseInput({ groundSpeedMs: 4.0, throttleCommanded: 1, arcM: 0 }));
    expect(detector.snapshot().stuckSec).toBe(0);
  });
});

describe("createStuckDetector — flipped", () => {
  it("tiltDeg 80 for 1.0s returns request-reset (skips drive-out) and never enters recovering", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    const actions: StuckAction[] = [];
    for (let i = 0; i < 120; i++) {
      const action = detector.update(baseInput({ tiltDeg: 80, arcM: 0 }));
      actions.push(action);
      expect(detector.snapshot().phase).not.toBe("recovering");
      if (action === "request-reset") break;
    }
    expect(actions.at(-1)).toBe("request-reset");
    expect(actions.filter((a) => a === "begin-recovery")).toEqual([]);
  });
});

describe("createStuckDetector — no progress", () => {
  it("arcM frozen (no advance) for 8s returns begin-recovery", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    const actions: StuckAction[] = [];
    // Speed above the exit threshold so the STUCK check alone can never
    // fire — isolates the no-progress mechanism.
    for (let i = 0; i < 8 * 60 + 5; i++) {
      actions.push(detector.update(baseInput({ groundSpeedMs: 5, arcM: 500 })));
    }
    expect(actions.filter((a) => a === "begin-recovery")).toHaveLength(1);
    expect(detector.snapshot().phase).toBe("recovering");
  });

  it("advancing 10m inside the window (including a start/finish wrap) never triggers", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    let triggered = false;
    // Start near the end of the lap, wrap across the start/finish line
    // partway through the window, net +12m forward.
    const arcSequence = [995, 995, 995, 7, 7, 7];
    for (let i = 0; i < 8 * 60 + 5; i++) {
      const arcM = arcSequence[Math.min(i, arcSequence.length - 1)];
      const action = detector.update(baseInput({ groundSpeedMs: 5, arcM }));
      if (action === "begin-recovery") triggered = true;
    }
    expect(triggered).toBe(false);
    expect(detector.snapshot().phase).toBe("racing");
  });

  it("backwards motion (net negative arc) over the window triggers begin-recovery", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    const actions: StuckAction[] = [];
    const arcSequence = [100, 90, 85, 80];
    for (let i = 0; i < 8 * 60 + 5; i++) {
      const arcM = arcSequence[Math.min(i, arcSequence.length - 1)];
      actions.push(detector.update(baseInput({ groundSpeedMs: 5, arcM })));
    }
    expect(actions.filter((a) => a === "begin-recovery")).toHaveLength(1);
  });
});

describe("createStuckDetector — recovering", () => {
  function forceRecovering(detector: ReturnType<typeof createStuckDetector>): void {
    for (let i = 0; i < 200; i++) {
      detector.update(baseInput({ groundSpeedMs: 0.5, throttleCommanded: 1, arcM: 0 }));
      if (detector.snapshot().phase === "recovering") return;
    }
    throw new Error("forceRecovering: never entered recovering");
  }

  it("after driveOutReverseSec 1.8s, groundSpeed >= 4.0 with tilt < 70 returns to racing", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    forceRecovering(detector);

    // Reverse phase: keep tilt/speed irrelevant to the recovery condition
    // (still slow) for just under 1.8s.
    for (let i = 0; i < Math.round(1.8 * 60) - 1; i++) {
      const action = detector.update(baseInput({ groundSpeedMs: 0.5, tiltDeg: 0, arcM: 0 }));
      expect(action).toBe("none");
      expect(detector.snapshot().phase).toBe("recovering");
    }

    // Now past 1.8s with good speed/tilt — recovers.
    let recovered = false;
    for (let i = 0; i < 10; i++) {
      const action = detector.update(baseInput({ groundSpeedMs: 5, tiltDeg: 0, arcM: 0 }));
      if (detector.snapshot().phase === "racing") {
        expect(action).toBe("none");
        recovered = true;
        break;
      }
    }
    expect(recovered).toBe(true);
  });

  it("still slow at recoverSec >= 3.0 returns request-reset", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    forceRecovering(detector);

    let requestedReset = false;
    for (let i = 0; i < 4 * 60; i++) {
      const action = detector.update(baseInput({ groundSpeedMs: 0.5, tiltDeg: 0, arcM: 0 }));
      if (action === "request-reset") {
        requestedReset = true;
        break;
      }
    }
    expect(requestedReset).toBe(true);
  });
});

describe("createStuckDetector — reset deferral", () => {
  it("while distanceToPlayerM < 60, request-reset is withheld until 3.0s of deferral elapse, then returned every tick", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    // Trigger a pending reset via flip (already close to the player, so the
    // very first pending-reset tick also begins the deferral countdown).
    for (let i = 0; i < 60; i++) {
      detector.update(baseInput({ tiltDeg: 80, distanceToPlayerM: 10, arcM: 0 }));
    }

    // Drive deferSec up until the first non-"none" tick, counting how long
    // it took — asserts against a comfortable band around 3.0s (180 ticks)
    // rather than an exact tick index, avoiding float-accumulation brittleness
    // at the boundary while still proving this is genuinely deferred (not
    // immediate) and genuinely bounded (not indefinite).
    let action: StuckAction = "none";
    let ticks = 0;
    while (action === "none" && ticks < 400) {
      action = detector.update(baseInput({ tiltDeg: 0, distanceToPlayerM: 10, arcM: 0 }));
      ticks++;
    }
    expect(action).toBe("request-reset");
    expect(ticks).toBeGreaterThanOrEqual(170);
    expect(ticks).toBeLessThanOrEqual(185);

    // Stays returned every subsequent tick even though the car is still close.
    const again = detector.update(baseInput({ tiltDeg: 0, distanceToPlayerM: 10, arcM: 0 }));
    expect(again).toBe("request-reset");
  });

  it("beyond 60m it is returned immediately", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    let action: StuckAction = "none";
    for (let i = 0; i < 60; i++) {
      action = detector.update(baseInput({ tiltDeg: 80, distanceToPlayerM: 1000, arcM: 0 }));
      if (action === "request-reset") break;
    }
    expect(action).toBe("request-reset");
  });
});

describe("createStuckDetector — acknowledgeReset and restart", () => {
  it("acknowledgeReset(): phase reset for 1.0s (label time), all timers zeroed, then racing", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    for (let i = 0; i < 60; i++) {
      detector.update(baseInput({ tiltDeg: 80, arcM: 0 }));
    }
    expect(detector.snapshot().flippedSec).toBeGreaterThan(0);

    detector.acknowledgeReset();
    const afterAck = detector.snapshot();
    expect(afterAck.phase).toBe("reset");
    expect(afterAck.stuckSec).toBe(0);
    expect(afterAck.flippedSec).toBe(0);
    expect(afterAck.recoverSec).toBe(0);
    expect(afterAck.deferSec).toBe(0);
    expect(afterAck.noProgressSec).toBe(0);

    // Comfortably-under-1.0s margin, not an exact tick count (float
    // accumulation of dtSec could land a single ULP either side of 1.0).
    for (let i = 0; i < 55; i++) {
      detector.update(baseInput({ arcM: 0 }));
      expect(detector.snapshot().phase).toBe("reset");
    }
    let ticks = 55;
    while (detector.snapshot().phase === "reset" && ticks < 100) {
      detector.update(baseInput({ arcM: 0 }));
      ticks++;
    }
    expect(detector.snapshot().phase).toBe("racing");
    expect(ticks).toBeLessThan(100);
  });

  it("restart() returns to a fresh racing state", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    for (let i = 0; i < 60; i++) {
      detector.update(baseInput({ groundSpeedMs: 0.5, throttleCommanded: 1, arcM: 0 }));
    }
    expect(detector.snapshot().stuckSec).toBeGreaterThan(0);

    detector.restart();
    expect(detector.snapshot()).toEqual({
      phase: "racing",
      stuckSec: 0,
      flippedSec: 0,
      noProgressSec: 0,
      recoverSec: 0,
      deferSec: 0,
    });
  });
});

describe("driveOutFrame", () => {
  it("driveOutFrame(0.5, 0.4) is the reverse phase (before driveOutReverseSec)", () => {
    expect(driveOutFrame(0.5, 0.4)).toEqual({
      steer: -0.4,
      throttle: 0,
      brake: 1,
      handbrake: false,
    });
  });

  it("driveOutFrame(2.0, 0.4) is the forward phase (after driveOutReverseSec)", () => {
    expect(driveOutFrame(2.0, 0.4)).toEqual({
      steer: 0.4,
      throttle: 0.6,
      brake: 0,
      handbrake: false,
    });
  });
});

describe("deriveAiDebugState", () => {
  it("maps phase/avoidanceScale to the correct debug label", () => {
    expect(deriveAiDebugState("reset", 1)).toBe("reset");
    expect(deriveAiDebugState("recovering", 1)).toBe("recovering");
    expect(deriveAiDebugState("racing", 0.9)).toBe("avoiding");
    expect(deriveAiDebugState("racing", 1)).toBe("racing");
  });
});

describe("createStuckDetector — snapshots are frozen", () => {
  it("returns a frozen snapshot object", () => {
    const detector = createStuckDetector(LAP_LENGTH_M);
    expect(Object.isFrozen(detector.snapshot())).toBe(true);
  });
});
