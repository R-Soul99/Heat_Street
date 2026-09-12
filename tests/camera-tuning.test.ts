import { describe, expect, it } from "vitest";
import {
  CAMERA_TUNING_RANGES,
  CAMERA_TUNING_STORAGE_KEY,
  clampCameraTuning,
  defaultCameraTuning,
  parseSavedCameraTuning,
  serializeCameraTuning,
} from "../src/core/camera-tuning";
import { isTuningRange } from "../src/core/tuning-utils";
import { framingForSpeed } from "../src/render/camera/camera-math";

/**
 * Node-only tests for the camera's tuning contract. Mirrors
 * `tests/surface-tuning.test.ts`'s structure and hostile-blob case list
 * exactly — same clamp/parse/serialize pipeline, same threat model (T-03-01,
 * T-03-05, T-03-11).
 */

/** Recursively walk a tuning-shaped object, calling `fn` on every numeric leaf. */
function forEachLeaf(node: unknown, fn: (value: unknown, path: string) => void, path = ""): void {
  if (typeof node !== "object" || node === null) {
    fn(node, path);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      forEachLeaf(value, fn, nextPath);
    } else {
      fn(value, nextPath);
    }
  }
}

/** Recursively collect every leaf path of a tuning-shaped object (numeric leaves only). */
function leafPaths(node: unknown, path = ""): string[] {
  const paths: string[] = [];
  forEachLeaf(node, (_v, p) => paths.push(p), path);
  return paths;
}

/**
 * Recursively collect every leaf path of a `CAMERA_TUNING_RANGES`-shaped
 * table, stopping at each `TuningRange` leaf (a `{min,max,step}` object)
 * rather than descending into its own `min`/`max`/`step` keys — those are
 * NOT further tuning groups, so `leafPaths` above would over-recurse here.
 */
function rangeLeafPaths(node: Record<string, unknown>, path = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (isTuningRange(value)) {
      paths.push(nextPath);
    } else {
      paths.push(...rangeLeafPaths(value as Record<string, unknown>, nextPath));
    }
  }
  return paths;
}

describe("defaultCameraTuning — freshness and finiteness", () => {
  it("returns a fresh object each call (mutating one does not affect the next)", () => {
    const a = defaultCameraTuning();
    const b = defaultCameraTuning();
    expect(a).not.toBe(b);
    a.framing.lowAltitudeM = 999;
    expect(b.framing.lowAltitudeM).not.toBe(999);
  });

  it("every numeric leaf is finite and lies inside its CAMERA_TUNING_RANGES bound", () => {
    const tuning = defaultCameraTuning() as unknown as Record<string, unknown>;
    const ranges = CAMERA_TUNING_RANGES as unknown as Record<string, unknown>;

    function walk(valueNode: Record<string, unknown>, rangeNode: Record<string, unknown>): void {
      for (const key of Object.keys(rangeNode)) {
        const rangeEntry = rangeNode[key];
        const valueEntry = valueNode[key];
        if (
          typeof rangeEntry === "object" &&
          rangeEntry !== null &&
          "min" in rangeEntry &&
          "max" in rangeEntry
        ) {
          const range = rangeEntry as { min: number; max: number };
          expect(typeof valueEntry, key).toBe("number");
          expect(Number.isFinite(valueEntry as number), key).toBe(true);
          expect(valueEntry as number, key).toBeGreaterThanOrEqual(range.min);
          expect(valueEntry as number, key).toBeLessThanOrEqual(range.max);
        } else {
          walk(valueEntry as Record<string, unknown>, rangeEntry as Record<string, unknown>);
        }
      }
    }

    walk(tuning, ranges);
  });

  it("CAMERA_TUNING_RANGES has the identical key shape as defaultCameraTuning() at every level", () => {
    expect(
      rangeLeafPaths(CAMERA_TUNING_RANGES as unknown as Record<string, unknown>).sort(),
    ).toEqual(leafPaths(defaultCameraTuning()).sort());
  });
});

describe("defaultCameraTuning — SC4 separation against the SHIPPED defaults", () => {
  it("60 mph vs 110 mph yields at least 6 degrees of FOV difference and at least 5 m of altitude difference", () => {
    const tuning = defaultCameraTuning();
    const curve = {
      lowSpeedMs: tuning.framing.lowSpeedMs,
      highSpeedMs: tuning.framing.highSpeedMs,
      low: {
        altitudeM: tuning.framing.lowAltitudeM,
        distanceM: tuning.framing.lowDistanceM,
        fovDeg: tuning.framing.lowFovDeg,
      },
      high: {
        altitudeM: tuning.framing.highAltitudeM,
        distanceM: tuning.framing.highDistanceM,
        fovDeg: tuning.framing.highFovDeg,
      },
    };

    const at60 = framingForSpeed(26.82, curve);
    const at110 = framingForSpeed(49.17, curve);

    expect(Math.abs(at110.fovDeg - at60.fovDeg)).toBeGreaterThanOrEqual(6);
    expect(Math.abs(at110.altitudeM - at60.altitudeM)).toBeGreaterThanOrEqual(5);
  });

  it("near-constant pitch: the low and high framing angles differ by less than 3 degrees", () => {
    const tuning = defaultCameraTuning();
    const lowPitchDeg =
      (Math.atan(tuning.framing.lowAltitudeM / tuning.framing.lowDistanceM) * 180) / Math.PI;
    const highPitchDeg =
      (Math.atan(tuning.framing.highAltitudeM / tuning.framing.highDistanceM) * 180) / Math.PI;
    expect(Math.abs(highPitchDeg - lowPitchDeg)).toBeLessThan(3);
  });
});

describe("CAMERA_TUNING_RANGES — floor discipline (T-03-11)", () => {
  it("fadeFloorOpacity's range minimum is strictly greater than 0", () => {
    expect(CAMERA_TUNING_RANGES.occlusion.fadeFloorOpacity.min).toBeGreaterThan(0);
  });

  it("every damping lambda's range minimum is strictly greater than 0", () => {
    expect(CAMERA_TUNING_RANGES.damping.positionLambda.min).toBeGreaterThan(0);
    expect(CAMERA_TUNING_RANGES.damping.headingLambda.min).toBeGreaterThan(0);
    expect(CAMERA_TUNING_RANGES.damping.framingLambda.min).toBeGreaterThan(0);
    expect(CAMERA_TUNING_RANGES.occlusion.fadeLambda.min).toBeGreaterThan(0);
  });
});

describe("clampCameraTuning", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, "hostile"])(
    "replaces a hostile framing.highFovDeg value (%s) with the default, not the range minimum",
    (hostileValue) => {
      const t = defaultCameraTuning();
      // biome-ignore lint/suspicious/noExplicitAny: deliberately injecting a hostile non-number value
      (t.framing as any).highFovDeg = hostileValue;
      const result = clampCameraTuning(t);
      expect(result.framing.highFovDeg).toBe(defaultCameraTuning().framing.highFovDeg);
    },
  );

  it("replaces a missing leaf key with the default", () => {
    const t = defaultCameraTuning();
    delete (t.damping as Partial<typeof t.damping>).headingLambda;
    const result = clampCameraTuning(t);
    expect(result.damping.headingLambda).toBe(defaultCameraTuning().damping.headingLambda);
  });

  it("clamps an out-of-range finite number to the CAMERA_TUNING_RANGES bound", () => {
    const t = defaultCameraTuning();
    t.framing.highFovDeg = 1e9;
    const result = clampCameraTuning(t);
    expect(result.framing.highFovDeg).toBe(CAMERA_TUNING_RANGES.framing.highFovDeg.max);
    expect(result.framing.highFovDeg).not.toBe(1e9);
  });
});

describe("parseSavedCameraTuning — structural rejection, never throws", () => {
  it("returns null for null input", () => {
    expect(parseSavedCameraTuning(null)).toBeNull();
  });

  it("returns null for non-JSON text", () => {
    expect(parseSavedCameraTuning("not json {{{")).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(parseSavedCameraTuning("[]")).toBeNull();
  });

  it.each(['"hello"', "7", "null", "true"])("returns null for a JSON scalar: %s", (raw) => {
    expect(parseSavedCameraTuning(raw)).toBeNull();
  });

  it("returns null for an object missing any required top-level group", () => {
    const blob = JSON.stringify({ framing: defaultCameraTuning().framing });
    expect(parseSavedCameraTuning(blob)).toBeNull();
  });

  it("never throws for a large sample of hostile string inputs", () => {
    const hostileInputs = [
      "",
      "{",
      "}",
      "undefined",
      "NaN",
      '{"framing":null}',
      '{"framing":"x","damping":1,"heading":[],"occlusion":{},"chaseFallback":{}}',
    ];
    for (const raw of hostileInputs) {
      expect(() => parseSavedCameraTuning(raw)).not.toThrow();
    }
  });
});

describe("round trip", () => {
  it("parseSavedCameraTuning(serializeCameraTuning(defaultCameraTuning())) deep-equals defaultCameraTuning()", () => {
    const original = defaultCameraTuning();
    const result = parseSavedCameraTuning(serializeCameraTuning(original));
    expect(result).toEqual(original);
  });
});

describe("hostile leaf values are clamped, never propagated (T-03-05)", () => {
  it("a blob with framing.highFovDeg of 1e9 comes back clamped to the range max, never 1e9", () => {
    const d = defaultCameraTuning();
    const blob = JSON.stringify({
      ...d,
      framing: { ...d.framing, highFovDeg: 1e9 },
    });
    const result = parseSavedCameraTuning(blob);
    expect(result).not.toBeNull();
    expect(result?.framing.highFovDeg).toBe(CAMERA_TUNING_RANGES.framing.highFovDeg.max);
    expect(result?.framing.highFovDeg).not.toBe(1e9);
  });
});

describe("CAMERA_TUNING_STORAGE_KEY", () => {
  it("is its own dedicated key", () => {
    expect(CAMERA_TUNING_STORAGE_KEY).toBe("heat-street.camera-tuning.v1");
  });
});
