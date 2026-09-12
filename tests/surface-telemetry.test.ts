import { describe, expect, it } from "vitest";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { SURFACE_TYPES } from "../src/core/surface-types";
import { defaultTuning } from "../src/core/vehicle-tuning";
import {
  runSkidpadAtGroundFriction,
  runSurfaceSkidpadSweep,
  runSurfaceStabilitySweep,
  SURFACE_SEPARATION_MIN_G,
} from "../src/physics/telemetry/surface-routines";

/**
 * This is the Wave-0 gate 03-VALIDATION.md names for SURF-01: it turns SC1's
 * claim — "driving from tarmac onto gravel, grass, mud, sand or dirt
 * produces a distinct and measurable grip change (skidpad lateral-G differs
 * per surface)" — into a command that runs in seconds and fails loudly when
 * it stops being true (`npx vitest run tests/surface-telemetry.test.ts -t skidpad`).
 *
 * This file also settles 03-RESEARCH.md Assumption A1 / Open Question 1 (does
 * the ground collider's own friction coefficient participate in the raycast
 * tire model at all?) and re-verifies `.planning/STATE.md`'s Phase 3
 * carry-forward on the plan-02-10 straight-line spin-out across every
 * surface, not just tarmac.
 */

describe("surface-telemetry: skidpad sweep (SC1)", () => {
  it("skidpad sweep returns exactly six results, one per SURFACE_TYPES entry, each finite and positive", () => {
    const results = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles());

    expect(results.length).toBe(SURFACE_TYPES.length);
    for (let i = 0; i < SURFACE_TYPES.length; i++) {
      expect(results[i].id).toBe(`skidpad:${SURFACE_TYPES[i]}`);
      expect(Number.isFinite(results[i].value)).toBe(true);
      expect(results[i].value).toBeGreaterThan(0);
    }
  });

  it("tarmac produces the highest lateral-g of the six surfaces; mud produces the lowest", () => {
    const results = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles());
    const byId = new Map(results.map((r) => [r.id, r.value]));

    const tarmacG = byId.get("skidpad:tarmac") ?? 0;
    const mudG = byId.get("skidpad:mud") ?? 0;

    for (const surface of SURFACE_TYPES) {
      const g = byId.get(`skidpad:${surface}`) ?? 0;
      expect(tarmacG).toBeGreaterThanOrEqual(g);
      expect(mudG).toBeLessThanOrEqual(g);
    }
  });

  it("every pair of surfaces differs by at least SURFACE_SEPARATION_MIN_G — SC1's 'distinct and measurable' claim", () => {
    const results = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles());

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const diff = Math.abs(results[i].value - results[j].value);
        expect(diff, `${results[i].id} vs ${results[j].id}: diff ${diff}`).toBeGreaterThanOrEqual(
          SURFACE_SEPARATION_MIN_G,
        );
      }
    }
  });

  it("tarmac to gravel — the exact pair SC1's text names — differs by at least 10% relative", () => {
    const results = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles());
    const byId = new Map(results.map((r) => [r.id, r.value]));
    const tarmacG = byId.get("skidpad:tarmac") ?? 0;
    const gravelG = byId.get("skidpad:gravel") ?? 0;

    const relativeDiff = Math.abs(tarmacG - gravelG) / tarmacG;
    expect(relativeDiff).toBeGreaterThanOrEqual(0.1);
  });

  it("determinism: running the sweep twice in the same process returns identical values", () => {
    const first = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles());
    const second = runSurfaceSkidpadSweep(defaultTuning(), defaultSurfaceProfiles());

    expect(second.map((r) => r.value)).toEqual(first.map((r) => r.value));
  });
});

describe("surface-telemetry: ground-collider friction control (03-RESEARCH.md A1 / Open Question 1)", () => {
  it("ground collider friction does not participate in the raycast tire model (03-RESEARCH.md A1)", () => {
    const tuning = defaultTuning();
    const profiles = defaultSurfaceProfiles();

    const highFriction = runSkidpadAtGroundFriction(tuning, profiles, 1.0);
    const lowFriction = runSkidpadAtGroundFriction(tuning, profiles, 0.1);

    const relativeDiff = Math.abs(highFriction.value - lowFriction.value) / highFriction.value;
    expect(relativeDiff).toBeLessThan(0.02);
  });
});

describe("surface-telemetry: straight-line stability re-verification (STATE.md Phase 3 carry-forward)", () => {
  it("stability sweep returns exactly six results, one per SURFACE_TYPES entry", () => {
    const results = runSurfaceStabilitySweep(defaultTuning(), defaultSurfaceProfiles());

    expect(results.length).toBe(SURFACE_TYPES.length);
    for (let i = 0; i < SURFACE_TYPES.length; i++) {
      expect(results[i].id).toBe(`stability:${SURFACE_TYPES[i]}`);
    }
  });

  it("on every surface, sustained full throttle with zero steer never exceeds 30 deg of slip angle", () => {
    const results = runSurfaceStabilitySweep(defaultTuning(), defaultSurfaceProfiles());

    for (const result of results) {
      expect(result.value, `${result.id}: max slip ${result.value} deg`).toBeLessThanOrEqual(30);
    }
  });

  it("on every surface the run ends still moving forward — a 'stable' result cannot come from a car that never accelerated", () => {
    const results = runSurfaceStabilitySweep(defaultTuning(), defaultSurfaceProfiles());

    for (const result of results) {
      expect(result.pass, `${result.id} did not pass`).toBe(true);
    }
  });
});
