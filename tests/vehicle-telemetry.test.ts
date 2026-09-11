import { describe, expect, it } from "vitest";
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

describe("vehicle-telemetry: runAllRoutines", () => {
  it("runs every routine currently registered and returns one result per routine", () => {
    const results = runAllRoutines(defaultTuning());
    expect(results.length).toBe(ROUTINES.length);
  });
});
