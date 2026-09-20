import { describe, expect, it } from "vitest";
import { defaultCameraTuning } from "../src/core/camera-tuning";
import { defaultSurfaceProfiles, SURFACE_PROFILE_RANGES } from "../src/core/surface-tuning";
import {
  parseTuningSnapshot,
  serializeTuningSnapshot,
  TUNING_SNAPSHOT_KIND,
  TUNING_SNAPSHOT_VERSION,
} from "../src/core/tuning-snapshot";
import { defaultTuning, TUNING_RANGES } from "../src/core/vehicle-tuning";

/**
 * This module is the security boundary an imported tuning file crosses on
 * its way into Rapier — see `src/core/tuning-snapshot.ts`'s module doc
 * comment. Naming style and assertion shape follow
 * `tests/tuning-persist.test.ts`: every case in the "never throws" and
 * "hostile leaves" describes asserts a non-throwing, fully-populated,
 * in-range result — a thrown exception here is as bad as a NaN getting
 * through, since either breaks the panel or the frame loop.
 */

/** Narrows a nullable value to non-null without `!`, matching this repo's
 * `lint/style/noNonNullAssertion` convention — throws (failing the test with
 * a clear message) rather than silently proceeding on `null`/`undefined`. */
function assertPresent<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be present`);
  }
  return value;
}

describe("serializeTuningSnapshot + parseTuningSnapshot round trip", () => {
  it("round-trips all three domains with several hand-picked non-default leaves preserved exactly", () => {
    const vehicle = defaultTuning();
    vehicle.wheels.rearSideFriction = 0.27;
    vehicle.drive.powerOversteerGain = 1.6;

    const surfaces = defaultSurfaceProfiles();
    surfaces.gravel.lateralGrip = 0.42;

    const camera = defaultCameraTuning();
    camera.framing.lowAltitudeM = 33.5;

    const raw = serializeTuningSnapshot(vehicle, surfaces, camera);
    const result = parseTuningSnapshot(raw);

    expect(result).not.toBeNull();
    expect(result?.vehicle).toEqual(vehicle);
    expect(result?.surfaces).toEqual(surfaces);
    expect(result?.camera).toEqual(camera);
    expect(result?.vehicle?.wheels.rearSideFriction).toBe(0.27);
    expect(result?.vehicle?.drive.powerOversteerGain).toBe(1.6);
    expect(result?.surfaces?.gravel.lateralGrip).toBe(0.42);
    expect(result?.camera?.framing.lowAltitudeM).toBe(33.5);
  });

  it("serialized output parses as JSON and carries both kind and version", () => {
    const raw = serializeTuningSnapshot(
      defaultTuning(),
      defaultSurfaceProfiles(),
      defaultCameraTuning(),
    );
    const parsed = JSON.parse(raw);
    expect(parsed.kind).toBe(TUNING_SNAPSHOT_KIND);
    expect(parsed.version).toBe(TUNING_SNAPSHOT_VERSION);
  });
});

describe("parseTuningSnapshot — structural rejection, never throws", () => {
  it("returns null for null input", () => {
    expect(parseTuningSnapshot(null)).toBeNull();
  });

  it.each(["", "not json", "[]", "123", "null"])(
    "returns null for malformed or non-object input: %s",
    (raw) => {
      expect(parseTuningSnapshot(raw)).toBeNull();
    },
  );

  it("returns null for an object whose kind is missing", () => {
    const blob = JSON.stringify({ version: TUNING_SNAPSHOT_VERSION, vehicle: defaultTuning() });
    expect(parseTuningSnapshot(blob)).toBeNull();
  });

  it("returns null for an object whose kind is wrong", () => {
    const blob = JSON.stringify({
      kind: "some-other-kind",
      version: TUNING_SNAPSHOT_VERSION,
      vehicle: defaultTuning(),
    });
    expect(parseTuningSnapshot(blob)).toBeNull();
  });

  it("returns null for a correctly-kinded envelope carrying none of the three domain keys", () => {
    const blob = JSON.stringify({ kind: TUNING_SNAPSHOT_KIND, version: TUNING_SNAPSHOT_VERSION });
    expect(parseTuningSnapshot(blob)).toBeNull();
  });

  it("never throws for a large sample of hostile string inputs", () => {
    const hostileInputs = [
      "",
      "{",
      "}",
      "undefined",
      "NaN",
      '{"kind":null}',
      `{"kind":"${TUNING_SNAPSHOT_KIND}","vehicle":"x","surfaces":1,"camera":[]}`,
    ];
    for (const raw of hostileInputs) {
      expect(() => parseTuningSnapshot(raw)).not.toThrow();
    }
  });
});

describe("parseTuningSnapshot — per-domain independence", () => {
  it("a valid vehicle and a garbage camera return vehicle populated and camera null", () => {
    const blob = JSON.stringify({
      kind: TUNING_SNAPSHOT_KIND,
      version: TUNING_SNAPSHOT_VERSION,
      vehicle: defaultTuning(),
      camera: "not an object",
    });
    const result = parseTuningSnapshot(blob);
    expect(result).not.toBeNull();
    expect(result?.vehicle).toEqual(defaultTuning());
    expect(result?.camera).toBeNull();
  });

  it("an absent domain comes back null while the present domains are populated", () => {
    const blob = JSON.stringify({
      kind: TUNING_SNAPSHOT_KIND,
      version: TUNING_SNAPSHOT_VERSION,
      surfaces: defaultSurfaceProfiles(),
    });
    const result = parseTuningSnapshot(blob);
    expect(result).not.toBeNull();
    expect(result?.vehicle).toBeNull();
    expect(result?.surfaces).toEqual(defaultSurfaceProfiles());
    expect(result?.camera).toBeNull();
  });
});

describe("parseTuningSnapshot — hostile leaves are neutralised by the delegated validated path", () => {
  it("comes back with every hostile leaf finite and in range, never propagating the hostile value", () => {
    const vehicle = defaultTuning() as unknown as Record<string, Record<string, unknown>>;
    vehicle.chassis.mass = Number.NaN;
    vehicle.wheels.frictionSlip = Number.POSITIVE_INFINITY;
    vehicle.wheels.rearSideFriction = 1e12;

    const surfaces = defaultSurfaceProfiles() as unknown as Record<string, Record<string, unknown>>;
    surfaces.mud.lateralGrip = -5;

    const camera = defaultCameraTuning() as unknown as Record<string, Record<string, unknown>>;
    camera.occlusion.fanRayCount = "9";

    const blob = JSON.stringify({
      kind: TUNING_SNAPSHOT_KIND,
      version: TUNING_SNAPSHOT_VERSION,
      vehicle,
      surfaces,
      camera,
    });

    const result = parseTuningSnapshot(blob);
    expect(result).not.toBeNull();

    expect(Number.isFinite(result?.vehicle?.chassis.mass)).toBe(true);
    expect(result?.vehicle?.chassis.mass).toBe(defaultTuning().chassis.mass);

    expect(Number.isFinite(result?.vehicle?.wheels.frictionSlip)).toBe(true);
    expect(result?.vehicle?.wheels.frictionSlip).toBe(defaultTuning().wheels.frictionSlip);

    expect(Number.isFinite(result?.vehicle?.wheels.rearSideFriction)).toBe(true);
    expect(result?.vehicle?.wheels.rearSideFriction).toBe(
      TUNING_RANGES.wheels.rearSideFriction.max,
    );

    expect(Number.isFinite(result?.surfaces?.mud.lateralGrip)).toBe(true);
    expect(result?.surfaces?.mud.lateralGrip).toBe(SURFACE_PROFILE_RANGES.mud.lateralGrip.min);

    expect(Number.isFinite(result?.camera?.occlusion.fanRayCount)).toBe(true);
    expect(result?.camera?.occlusion.fanRayCount).toBe(defaultCameraTuning().occlusion.fanRayCount);
  });

  it("clamps a directly-injected NaN vehicle mass to the default rather than throwing", () => {
    // JSON has no NaN literal; JSON.stringify(NaN) already serialises to
    // `null`, so this exercises the same "non-finite becomes default" path
    // through the actual on-disk shape a corrupt file would have.
    const blob = `{"kind":"${TUNING_SNAPSHOT_KIND}","version":${TUNING_SNAPSHOT_VERSION},"vehicle":{"chassis":{"mass":null},"wheels":{},"drive":{},"assists":{}}}`;
    const result = parseTuningSnapshot(blob);
    expect(result).not.toBeNull();
    expect(result?.vehicle?.chassis.mass).toBe(defaultTuning().chassis.mass);
  });
});

describe("parseTuningSnapshot — prototype pollution resistance", () => {
  it("a __proto__ key inside a domain leaves Object.prototype unpolluted and returns in-range values", () => {
    const vehicle = defaultTuning() as unknown as Record<string, unknown>;
    Object.defineProperty(vehicle, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    });
    const raw = JSON.stringify(vehicle);
    expect(raw).toContain("__proto__");

    const blob = JSON.stringify({
      kind: TUNING_SNAPSHOT_KIND,
      version: TUNING_SNAPSHOT_VERSION,
      vehicle: JSON.parse(raw),
    });

    const result = parseTuningSnapshot(blob);
    expect(result).not.toBeNull();
    const vehicleResult = assertPresent(result, "result").vehicle;
    expect(Object.getPrototypeOf(vehicleResult)).toBe(Object.prototype);
    expect((vehicleResult as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("a constructor key inside a domain cannot reach the returned object", () => {
    const surfaces = defaultSurfaceProfiles() as unknown as Record<string, unknown>;
    Object.defineProperty(surfaces, "constructor", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    });
    const raw = JSON.stringify(surfaces);

    const blob = JSON.stringify({
      kind: TUNING_SNAPSHOT_KIND,
      version: TUNING_SNAPSHOT_VERSION,
      surfaces: JSON.parse(raw),
    });

    const result = parseTuningSnapshot(blob);
    expect(result).not.toBeNull();
    const surfacesResult = assertPresent(result, "result").surfaces;
    expect((surfacesResult as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(surfacesResult)).toBe(Object.prototype);
  });
});

describe("parseTuningSnapshot — unknown extra keys are dropped, not copied", () => {
  it("an unknown top-level leaf inside vehicle.chassis does not appear on the result", () => {
    const blob = JSON.stringify({
      kind: TUNING_SNAPSHOT_KIND,
      version: TUNING_SNAPSHOT_VERSION,
      vehicle: {
        chassis: { ...defaultTuning().chassis, someHostileExtraField: "haxx" },
        wheels: defaultTuning().wheels,
        drive: defaultTuning().drive,
        assists: defaultTuning().assists,
      },
    });
    const result = parseTuningSnapshot(blob);
    expect(result).not.toBeNull();
    const vehicleResult = assertPresent(assertPresent(result, "result").vehicle, "result.vehicle");
    expect(
      (vehicleResult.chassis as unknown as Record<string, unknown>).someHostileExtraField,
    ).toBeUndefined();
  });
});
