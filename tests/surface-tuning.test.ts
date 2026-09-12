import { describe, expect, it } from "vitest";
import {
  clampSurfaceProfiles,
  defaultSurfaceProfiles,
  parseSavedSurfaceProfiles,
  serializeSurfaceProfiles,
  SURFACE_PROFILE_RANGES,
  SURFACE_TUNING_STORAGE_KEY,
} from "../src/core/surface-tuning";
import { SURFACE_TYPES } from "../src/core/surface-types";

// Both files are read through Vite's `?raw` transform rather than `node:fs`,
// matching `tests/road-graph-schema.test.ts`'s established convention —
// `@types/node` is not installed and this phase installs zero new packages.
import schemaDoc from "../docs/schemas/road-graph.v1.md?raw";

/**
 * T-03-04's mechanical guard: the six surface names spelled in game code must
 * be provably identical to `docs/schemas/road-graph.v1.md`'s normative
 * `SURFACE_ENUM` line — parsed FROM the doc, not hardcoded here, mirroring
 * `tests/road-graph-schema.test.ts`'s `surfaceEnumFromDoc` idiom verbatim.
 * Not exported: biome's lint/suspicious/noExportsInTest forbids exports from
 * a test file, and nothing outside this file needs it.
 */
function surfaceEnumFromDoc(doc: string): string[] {
  const match = doc.match(/^SURFACE_ENUM\s*=\s*(.+)$/m);
  if (match === null) {
    throw new Error(
      "docs/schemas/road-graph.v1.md contains no normative `SURFACE_ENUM = a | b | ...` line",
    );
  }
  return match[1]
    .split("|")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

describe("surface-types — doc parity (T-03-04)", () => {
  it("SURFACE_TYPES equals docs/schemas/road-graph.v1.md's SURFACE_ENUM exactly, same order", () => {
    expect(SURFACE_TYPES).toEqual(surfaceEnumFromDoc(schemaDoc));
  });

  it("includes dirt_road, not dirt — the closed enum's exact spelling", () => {
    expect(SURFACE_TYPES).toContain("dirt_road");
    expect(SURFACE_TYPES as readonly string[]).not.toContain("dirt");
  });
});

describe("surface-tuning — key parity", () => {
  it("defaultSurfaceProfiles() has exactly the six SURFACE_TYPES keys", () => {
    expect(Object.keys(defaultSurfaceProfiles()).sort()).toEqual([...SURFACE_TYPES].sort());
  });

  it("SURFACE_PROFILE_RANGES has exactly the six SURFACE_TYPES keys", () => {
    expect(Object.keys(SURFACE_PROFILE_RANGES).sort()).toEqual([...SURFACE_TYPES].sort());
  });
});

describe("surface-tuning — default values", () => {
  it("tarmac is the untouched Phase 2 baseline: forwardGrip 1, lateralGrip 1", () => {
    expect(defaultSurfaceProfiles().tarmac).toEqual({ forwardGrip: 1, lateralGrip: 1 });
  });

  it("every non-tarmac surface has forwardGrip < 1 and lateralGrip < 1", () => {
    const p = defaultSurfaceProfiles();
    for (const surface of SURFACE_TYPES) {
      if (surface === "tarmac") continue;
      expect(p[surface].forwardGrip, `${surface}.forwardGrip`).toBeLessThan(1);
      expect(p[surface].lateralGrip, `${surface}.lateralGrip`).toBeLessThan(1);
    }
  });

  it("D-04 floor discipline: every forwardGrip and lateralGrip default is >= 0.4", () => {
    const p = defaultSurfaceProfiles();
    for (const surface of SURFACE_TYPES) {
      expect(p[surface].forwardGrip, `${surface}.forwardGrip`).toBeGreaterThanOrEqual(0.4);
      expect(p[surface].lateralGrip, `${surface}.lateralGrip`).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("D-05 anchor: gravel and dirt_road each cut lateral grip harder than forward grip by >= 0.15", () => {
    const p = defaultSurfaceProfiles();
    expect(p.gravel.forwardGrip - p.gravel.lateralGrip).toBeGreaterThanOrEqual(0.15);
    expect(p.dirt_road.forwardGrip - p.dirt_road.lateralGrip).toBeGreaterThanOrEqual(0.15);
  });

  it("returns a fresh object on every call", () => {
    const a = defaultSurfaceProfiles();
    const b = defaultSurfaceProfiles();
    expect(a).not.toBe(b);
    a.mud.forwardGrip = 999;
    expect(b.mud.forwardGrip).not.toBe(999);
  });
});

describe("clampSurfaceProfiles", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, "hostile"])(
    "replaces a hostile mud.forwardGrip value (%s) with the default, not the range minimum",
    (hostileValue) => {
      const p = defaultSurfaceProfiles();
      // biome-ignore lint/suspicious/noExplicitAny: deliberately injecting a hostile non-number value
      (p.mud as any).forwardGrip = hostileValue;
      const result = clampSurfaceProfiles(p);
      expect(result.mud.forwardGrip).toBe(defaultSurfaceProfiles().mud.forwardGrip);
    },
  );

  it("replaces a missing leaf key with the default", () => {
    const p = defaultSurfaceProfiles();
    // biome-ignore lint/performance/noDelete: simulating a hostile blob missing a key
    delete (p.sand as Partial<typeof p.sand>).lateralGrip;
    const result = clampSurfaceProfiles(p);
    expect(result.sand.lateralGrip).toBe(defaultSurfaceProfiles().sand.lateralGrip);
  });

  it("clamps an out-of-range finite number to the SURFACE_PROFILE_RANGES bound", () => {
    const p = defaultSurfaceProfiles();
    p.mud.forwardGrip = 1e9;
    const result = clampSurfaceProfiles(p);
    expect(result.mud.forwardGrip).toBe(SURFACE_PROFILE_RANGES.mud.forwardGrip.max);
  });
});

describe("parseSavedSurfaceProfiles — structural rejection, never throws", () => {
  it("returns null for null input", () => {
    expect(parseSavedSurfaceProfiles(null)).toBeNull();
  });

  it("returns null for non-JSON text", () => {
    expect(parseSavedSurfaceProfiles("not json {{{")).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(parseSavedSurfaceProfiles("[]")).toBeNull();
  });

  it.each(['"hello"', "7", "null", "true"])(
    "returns null for a JSON scalar: %s",
    (raw) => {
      expect(parseSavedSurfaceProfiles(raw)).toBeNull();
    },
  );

  it("returns null for an object missing any of the six surface keys", () => {
    const blob = JSON.stringify({ tarmac: { forwardGrip: 1, lateralGrip: 1 } });
    expect(parseSavedSurfaceProfiles(blob)).toBeNull();
  });

  it("never throws for a large sample of hostile string inputs", () => {
    const hostileInputs = [
      "",
      "{",
      "}",
      "undefined",
      "NaN",
      '{"tarmac":null}',
      '{"tarmac":"x","gravel":1,"dirt_road":[],"grass":{},"sand":{},"mud":{}}',
    ];
    for (const raw of hostileInputs) {
      expect(() => parseSavedSurfaceProfiles(raw)).not.toThrow();
    }
  });
});

describe("parseSavedSurfaceProfiles — hostile leaf values are clamped or defaulted", () => {
  it("clamps a parsed mud.forwardGrip of 1e9 to the range max, never propagating 1e9", () => {
    const blob = JSON.stringify({
      tarmac: { forwardGrip: 1, lateralGrip: 1 },
      gravel: { forwardGrip: 0.75, lateralGrip: 0.55 },
      dirt_road: { forwardGrip: 0.78, lateralGrip: 0.55 },
      grass: { forwardGrip: 0.55, lateralGrip: 0.6 },
      sand: { forwardGrip: 0.45, lateralGrip: 0.55 },
      mud: { forwardGrip: 1e9, lateralGrip: 0.5 },
    });
    const result = parseSavedSurfaceProfiles(blob);
    expect(result).not.toBeNull();
    expect(result?.mud.forwardGrip).toBe(SURFACE_PROFILE_RANGES.mud.forwardGrip.max);
    expect(result?.mud.forwardGrip).not.toBe(1e9);
  });
});

describe("serializeSurfaceProfiles + parseSavedSurfaceProfiles round trip", () => {
  it("round-trips defaultSurfaceProfiles() through serialize/parse unchanged", () => {
    const original = defaultSurfaceProfiles();
    const result = parseSavedSurfaceProfiles(serializeSurfaceProfiles(original));
    expect(result).toEqual(original);
  });
});

describe("SURFACE_TUNING_STORAGE_KEY", () => {
  it("is its own dedicated key, not the vehicle tuning key", () => {
    expect(SURFACE_TUNING_STORAGE_KEY).toBe("heat-street.surface-tuning.v1");
  });
});
