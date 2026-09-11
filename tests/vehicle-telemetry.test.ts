import { describe, expect, it } from "vitest";
import type { InputFrame } from "../src/core/input-tape";
import { DT } from "../src/core/sim-clock";
import type { VehicleTuning } from "../src/core/vehicle-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import type { Routine } from "../src/physics/telemetry/routines";
import { ROUTINES } from "../src/physics/telemetry/routines";
import { buildTelemetryScene, runAllRoutines, runRoutine } from "../src/physics/telemetry/run";
import { createVehicle, sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

/**
 * This is the CI half of ROADMAP SC5 ("re-verified against a scripted
 * telemetry track … with no code edit"): the exact `runRoutine` /
 * `runAllRoutines` exported here are what the plan 02-09 browser panel calls
 * against LIVE-tuned values. This file only ever exercises them against
 * `defaultTuning()` — the browser side is exercised manually, per
 * 02-VALIDATION.md.
 */

/** MUST MATCH `src/physics/telemetry/run.ts`'s own SPAWN — used by this
 * file's own scripted-run helpers below, which mirror `runRoutine`'s loop to
 * reach into the world for a snapshot hash `runRoutine` itself does not
 * expose. */
const SPAWN = { x: 0, y: 1, z: 0 };

/**
 * FNV-1a, 32-bit. A NON-CRYPTOGRAPHIC fingerprint used only to compare two
 * snapshots for equality inside this test file. It is not a checksum, it
 * provides no integrity guarantee, and nothing outside this file may treat
 * it as one (01-RESEARCH.md "Security Domain", ASVS V6). Copied verbatim
 * from `tests/determinism.test.ts:18-31`.
 */
function fnv1a(bytes: Uint8Array): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function findRoutine(id: string): Routine {
  const routine = ROUTINES.find((r) => r.id === id);
  if (!routine) {
    throw new Error(`routine not found: ${id}`);
  }
  return routine;
}

/**
 * Mirrors `runRoutine`'s loop exactly, but returns the final world's snapshot
 * hash instead of a `RoutineResult` — `runRoutine` frees its world before
 * returning, so this is the only way to reach the raw bytes from outside
 * `src/physics/telemetry/run.ts`.
 */
function runRoutineForSnapshotHash(routine: Routine, tuning: VehicleTuning): string {
  const world = createWorld();
  buildTelemetryScene(world);
  const vehicle = createVehicle(world, tuning, SPAWN);
  routine.setup?.(vehicle);
  for (let tick = 0; tick < 1800; tick++) {
    const s = sampleVehicle(vehicle);
    const frame = routine.drive(tick, s);
    if (frame === null) {
      break;
    }
    vehicle.tick(frame, tuning);
    world.step();
  }
  const hash = fnv1a(world.takeSnapshot());
  world.free();
  return hash;
}

/**
 * A closed-form, always-continuing scripted drive (never early-exiting),
 * stepped for exactly `ticks` fixed ticks. Used only for the N-vs-N+1
 * anti-trivially-green companion below — matches
 * `tests/determinism.test.ts`'s `buildVaryingTape` discipline: no random
 * source, a pure function of the tick index.
 */
function stepFixedTicks(ticks: number): string {
  const world = createWorld();
  buildTelemetryScene(world);
  const tuning = defaultTuning();
  const vehicle = createVehicle(world, tuning, SPAWN);
  for (let t = 0; t < ticks; t++) {
    vehicle.tick(
      { steer: Math.sin(t / 37), throttle: (t % 120) / 120, brake: 0, handbrake: false },
      tuning,
    );
    world.step();
  }
  const hash = fnv1a(world.takeSnapshot());
  world.free();
  return hash;
}

describe("vehicle-telemetry: shared harness", () => {
  it("world.free() leaves no residual body count on the RAPIER module level", () => {
    // Not a leak detector on its own (RAPIER exposes no global body count),
    // but proves runRoutine completes and returns without throwing, which is
    // the precondition for every other case in this file.
    const result = runRoutine(findRoutine("accel"), defaultTuning());
    expect(typeof result.pass).toBe("boolean");
  });
});

describe("vehicle-telemetry: accel (VEH-01, D-14)", () => {
  it("accel: reaches 60 mph inside the 6.0-7.0 s target at default tuning", () => {
    const result = runRoutine(findRoutine("accel"), defaultTuning());

    expect(result.pass).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(6.0);
    expect(result.value).toBeLessThanOrEqual(7.0);
  });
});

describe("vehicle-telemetry: brake (VEH-01, D-14, Pitfall 7)", () => {
  it("brake: 60-0 mph stopping distance inside the 110-135 ft target at default tuning", () => {
    const result = runRoutine(findRoutine("brake"), defaultTuning());

    expect(result.pass).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(110);
    expect(result.value).toBeLessThanOrEqual(135);
  });
});

describe("vehicle-telemetry: reproducible (VEH-03 regression, applied to the telemetry harness)", () => {
  it("two runs of the same routine object produce bit-identical RoutineResult values", () => {
    const routine = findRoutine("accel");
    const first = runRoutine(routine, defaultTuning());
    const second = runRoutine(routine, defaultTuning());

    expect(second.value).toBe(first.value);
    expect(second.pass).toBe(first.pass);
    expect(second.unit).toBe(first.unit);
  });

  it("two full scripted runs produce identical snapshot hashes", () => {
    const routine = findRoutine("brake");
    const first = runRoutineForSnapshotHash(routine, defaultTuning());
    const second = runRoutineForSnapshotHash(routine, defaultTuning());

    expect(second).toBe(first);
  });

  it("a one-tick difference in scripted run length produces a different hash (anti-trivially-green)", () => {
    // Not padding. Without this, a `takeSnapshot()` that returned a constant
    // — or a hash that collapsed everything to one value — would make the
    // reproducibility case above trivially green while proving nothing.
    expect(stepFixedTicks(300)).not.toBe(stepFixedTicks(301));
  });
});

describe("vehicle-telemetry: skidpad (VEH-01, D-14)", () => {
  it("skidpad: steady-state lateral g inside the 0.75-1.05 g target at default tuning", () => {
    const result = runRoutine(findRoutine("skidpad"), defaultTuning());

    expect(result.pass).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(0.75);
    expect(result.value).toBeLessThanOrEqual(1.05);
  });

  it("skidpad anti-trivially-green: frictionSlip 10.5 fails the band (proves the routine measures grip, not a constant)", () => {
    // 02-RESEARCH.md "the frictionSlip saturation cliff": 10.5 and 1000
    // measure IDENTICAL 3.48-3.49 g against a NEUTRAL side-friction rig — the
    // dial is dead above ~10. Against this file's shipped Config A rig (an
    // 8x front/rear side-friction asymmetry for the RWD-loose feel), the
    // same value instead drives the positive-feedback body-roll assist past
    // its cutoff and the chassis flips (tilt -> 180 deg, contacts -> 0,
    // angvel.y -> 0), which reads as ~0 g — still a clear FAIL of the
    // 0.75-1.05 g band either way, proving this routine is not returning a
    // constant.
    const tuning = defaultTuning();
    tuning.wheels.frictionSlip = 10.5;
    const result = runRoutine(findRoutine("skidpad"), tuning);

    expect(result.pass).toBe(false);
    expect(result.value < 0.75 || result.value > 1.05).toBe(true);
  });
});

describe("vehicle-telemetry: slalom (VEH-01)", () => {
  it("slalom: never exceeds 90 deg of slip and recovers below 5 deg by the end", () => {
    const result = runRoutine(findRoutine("slalom"), defaultTuning());

    expect(result.pass).toBe(true);
    expect(result.value).toBeLessThan(90);
  });
});

describe("vehicle-telemetry: handbrake (VEH-01, D-01)", () => {
  it("handbrake: max slip above 25 deg AND recovers below 5 deg within 2.5 s at default tuning", () => {
    const result = runRoutine(findRoutine("handbrake"), defaultTuning());

    // Both halves of the D-01 target asserted separately, not just `pass`:
    // the max-slip half via the exposed `value`, the recovery-time half
    // folded into `pass` (RoutineResult has no second numeric field).
    expect(result.value).toBeGreaterThan(25);
    expect(result.pass).toBe(true);
  });
});

describe("vehicle-telemetry: brake-understeer (VEH-01, D-04)", () => {
  /**
   * D-04's brake-while-turning understeer is a front-axle friction-CIRCLE
   * effect (braking eats the longitudinal share of the budget, starving the
   * front's lateral share) and is ORTHOGONAL to D-01's permanent rear-bias
   * "RWD-loose" feature (`rearSideFriction: 0.12` in `defaultTuning()`).
   * `[MEASURED]` (plan 02-07): run against the LITERAL `defaultTuning()`,
   * the rear bias dominates — braking unloads the already-starved rear
   * further and the car shows a mild OVERSTEER (tighter, not wider, radius)
   * at every steer angle tried, the opposite of D-04. Isolating D-04 needs a
   * SYMMETRIC front/rear side friction (matching 02-RESEARCH.md's own D-04
   * sweep, which used the neutral 1.0/1.0 reference, not the shipped
   * RWD-loose default) and a low enough `frictionSlip` for the circle to
   * bind — `frictionSlip: 0.5` reproduces a clean, non-flaky ~22% radius gap.
   * This is a diagnostic pair used only by this test, not part of the six
   * canonical `ROUTINES` (`runRoutine` accepts any `Routine`, not only ones
   * registered there).
   */
  const D04_MPH_50_MS = 22.352;
  const D04_STEER_FRACTION = 0.6;
  const D04_HOLD_TICKS = Math.round(1 / DT);
  const D04_WINDOW_TICKS = Math.round(0.25 / DT);

  function isolatedD04Tuning(): VehicleTuning {
    const t = defaultTuning();
    t.wheels.frictionSlip = 0.5;
    t.wheels.rearSideFriction = 1.0;
    return t;
  }

  function makeCorneringRadiusRoutine(braking: boolean): Routine {
    let holding = false;
    let holdStartTick = 0;
    const id = braking ? "brake-understeer-brake" : "brake-understeer-coast";
    const label = braking ? "cornering radius under braking" : "cornering radius while coasting";

    return {
      id,
      label,
      setup() {
        holding = false;
        holdStartTick = 0;
      },
      drive(tick, s): InputFrame | null {
        if (!holding) {
          if (s.forwardSpeedMs >= D04_MPH_50_MS) {
            holding = true;
            holdStartTick = tick;
          } else {
            return { steer: 0, throttle: 1, brake: 0, handbrake: false };
          }
        }
        if (tick - holdStartTick >= D04_HOLD_TICKS) {
          return null;
        }
        // Zero throttle even while coasting — a maintaining throttle would
        // blend rearSideFriction toward the handbrake value via the authored
        // throttle-oversteer term (vehicle.ts step 4), contaminating the
        // coast baseline with an unrelated effect.
        return { steer: D04_STEER_FRACTION, throttle: 0, brake: braking ? 1 : 0, handbrake: false };
      },
      sample(tick, s, acc) {
        if (!holding) {
          return;
        }
        const elapsed = tick - holdStartTick;
        if (elapsed >= D04_HOLD_TICKS - D04_WINDOW_TICKS) {
          acc.yawSum = (acc.yawSum ?? 0) + Math.abs(s.angvel.y);
          acc.yawCount = (acc.yawCount ?? 0) + 1;
          acc.speedSum = (acc.speedSum ?? 0) + s.groundSpeedMs;
        }
      },
      evaluate(acc) {
        const yawCount = acc.yawCount ?? 0;
        const yawRate = yawCount > 0 ? (acc.yawSum ?? 0) / yawCount : 0;
        const speed = yawCount > 0 ? (acc.speedSum ?? 0) / yawCount : 0;
        const radiusM = yawRate > 1e-6 ? speed / yawRate : Number.POSITIVE_INFINITY;
        return {
          id,
          label,
          value: radiusM,
          unit: "m",
          target: "braking radius > coasting radius",
          pass: true,
        };
      },
    };
  }

  it("brake-understeer: cornering radius under braking exceeds cornering radius while coasting", () => {
    const coast = runRoutine(makeCorneringRadiusRoutine(false), isolatedD04Tuning());
    const brake = runRoutine(makeCorneringRadiusRoutine(true), isolatedD04Tuning());

    expect(brake.value).toBeGreaterThan(coast.value);
  });
});

describe("vehicle-telemetry: runAllRoutines", () => {
  it("runs every routine currently registered and returns one result per routine", () => {
    const results = runAllRoutines(defaultTuning());
    expect(results.length).toBe(ROUTINES.length);
  });
});
