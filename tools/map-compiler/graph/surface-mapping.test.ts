import { describe, expect, it } from "vitest";
// Both files read through Vite's `?raw` transform, matching
// `tests/road-graph-schema.test.ts`'s existing idiom.
import schemaDoc from "../../../docs/schemas/road-graph.v1.md?raw";
import { mapSurface, surfaceCoverage } from "./surface-mapping.ts";

/**
 * Copy of `tests/road-graph-schema.test.ts`'s `surfaceEnumFromDoc` idiom —
 * not exported (biome's `noExportsInTest` forbids exports from a test file),
 * and nothing outside this file needs it.
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

/**
 * Parses the doc's "OSM -> game surface mapping" table, extracting every
 * backtick-quoted OSM `surface=*` value from the table's second column.
 * Table rows are `| Game surface | OSM surface values | highway fallback |`;
 * this stops at the first line after the header that no longer starts with
 * `|`.
 */
function osmSurfaceValuesFromDocTable(doc: string): string[] {
  const lines = doc.split("\n");
  const headerIndex = lines.findIndex(
    (line) => line.includes("Game surface") && line.includes("OSM `surface=*` values"),
  );
  if (headerIndex === -1) {
    throw new Error(
      'docs/schemas/road-graph.v1.md contains no "OSM -> game surface mapping" table header',
    );
  }
  const values: string[] = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cols.length < 2) continue;
    const codeValues = [...cols[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    values.push(...codeValues);
  }
  return values;
}

const SURFACES = surfaceEnumFromDoc(schemaDoc);
const DOC_OSM_SURFACE_VALUES = new Set(osmSurfaceValuesFromDocTable(schemaDoc));
const DELIBERATELY_UNMAPPED = new Set(["cobblestone", "unhewn_cobblestone"]);

describe("mapSurface — explicit surface tag mapping", () => {
  it('maps "asphalt" + "residential" to tarmac, not from fallback', () => {
    expect(mapSurface("asphalt", "residential")).toEqual({
      surface: "tarmac",
      fromFallback: false,
    });
  });

  for (const value of [
    "concrete",
    "concrete:plates",
    "paved",
    "chipseal",
    "paving_stones",
    "sett",
  ]) {
    it(`maps "${value}" to tarmac`, () => {
      expect(mapSurface(value, "residential").surface).toBe("tarmac");
      expect(mapSurface(value, "residential").fromFallback).toBe(false);
    });
  }

  for (const value of ["gravel", "fine_gravel", "pebblestone"]) {
    it(`maps "${value}" to gravel`, () => {
      expect(mapSurface(value, "residential").surface).toBe("gravel");
    });
  }

  for (const value of ["compacted", "dirt", "earth", "ground", "unpaved"]) {
    it(`maps "${value}" to dirt_road`, () => {
      expect(mapSurface(value, "residential").surface).toBe("dirt_road");
    });
  }

  it('maps "grass" and "grass_paver" to grass', () => {
    expect(mapSurface("grass", "residential").surface).toBe("grass");
    expect(mapSurface("grass_paver", "residential").surface).toBe("grass");
  });

  it('maps "sand" to sand', () => {
    expect(mapSurface("sand", "residential").surface).toBe("sand");
  });

  it('maps "mud" to mud', () => {
    expect(mapSurface("mud", "residential").surface).toBe("mud");
  });
});

describe("mapSurface — absent-surface highway-class fallback", () => {
  for (const highway of [
    "residential",
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "service",
  ]) {
    it(`falls back to tarmac for highway="${highway}" with no surface tag`, () => {
      expect(mapSurface(undefined, highway)).toEqual({ surface: "tarmac", fromFallback: true });
    });
  }

  it('falls back to dirt_road for highway="track" with no surface tag', () => {
    expect(mapSurface(undefined, "track")).toEqual({ surface: "dirt_road", fromFallback: true });
  });
});

describe("mapSurface — recognised-but-deliberately-unmapped values", () => {
  it('throws on "cobblestone", naming it and pointing at the schema doc without suggesting tarmac', () => {
    let caught: unknown;
    try {
      mapSurface("cobblestone", "residential");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("cobblestone");
    expect(message).toContain("road-graph.v1.md");
    expect(message).not.toContain("tarmac");
  });

  it('throws on "unhewn_cobblestone" with a message distinguishing it from an unmapped value', () => {
    let caught: unknown;
    try {
      mapSurface("unhewn_cobblestone", "residential");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("unhewn_cobblestone");
    // Distinguishing message: recognised-but-unmapped, not "not a mapped value".
    expect(message).not.toContain("is not a mapped value");
  });
});

describe("mapSurface — genuinely unmapped values fail loudly", () => {
  it('throws on "wood", naming it as an unmapped OSM surface value', () => {
    expect(() => mapSurface("wood", "residential")).toThrow(/wood/);
  });

  it('throws on highway="footway" with no surface tag, naming it as a road class with no fallback', () => {
    expect(() => mapSurface(undefined, "footway")).toThrow(/footway/);
  });
});

describe("mapSurface — result is always a member of the closed enum", () => {
  it("every value mapSurface can return is one of SURFACE_TYPES", () => {
    const explicitValues = [
      "asphalt",
      "concrete",
      "concrete:plates",
      "paved",
      "chipseal",
      "paving_stones",
      "sett",
      "gravel",
      "fine_gravel",
      "pebblestone",
      "compacted",
      "dirt",
      "earth",
      "ground",
      "unpaved",
      "grass",
      "grass_paver",
      "sand",
      "mud",
    ];
    for (const value of explicitValues) {
      expect(SURFACES).toContain(mapSurface(value, "residential").surface);
    }
    for (const highway of ["residential", "track"]) {
      expect(SURFACES).toContain(mapSurface(undefined, highway).surface);
    }
  });
});

describe("surfaceCoverage", () => {
  it("aggregates per-road-class explicit/fallback counts and an overall fallback ratio", () => {
    const report = surfaceCoverage([
      { roadClass: "residential", fromFallback: false },
      { roadClass: "residential", fromFallback: false },
      { roadClass: "residential", fromFallback: true },
      { roadClass: "service", fromFallback: true },
      { roadClass: "service", fromFallback: true },
    ]);

    expect(report.byRoadClass.residential.explicit).toBe(2);
    expect(report.byRoadClass.residential.fallback).toBe(1);
    expect(report.byRoadClass.residential.fallbackRatio).toBeCloseTo(1 / 3);

    expect(report.byRoadClass.service.explicit).toBe(0);
    expect(report.byRoadClass.service.fallback).toBe(2);
    expect(report.byRoadClass.service.fallbackRatio).toBe(1);

    expect(report.overall.explicit).toBe(2);
    expect(report.overall.fallback).toBe(3);
    expect(report.overall.fallbackRatio).toBeCloseTo(3 / 5);
  });
});

describe("surface-mapping — doc-parity drift guard", () => {
  it("returns only surfaces that are a subset of the doc's SURFACE_ENUM", () => {
    // Exercised indirectly via the "always a member of the closed enum" describe
    // block above; this test additionally asserts the doc's enum itself has not
    // silently shrunk below the six values every other test assumes.
    expect(SURFACES).toEqual(["tarmac", "gravel", "dirt_road", "grass", "sand", "mud"]);
  });

  it("maps exactly the OSM surface=* values the doc's table lists, minus the deliberately-unmapped pair", () => {
    const expectedMapped = [...DOC_OSM_SURFACE_VALUES].filter(
      (value) => !DELIBERATELY_UNMAPPED.has(value),
    );
    for (const value of expectedMapped) {
      // Every doc-listed value must map without throwing.
      expect(() => mapSurface(value, "residential")).not.toThrow();
    }
    // And mapSurface must not silently accept anything the doc doesn't list
    // (other than the deliberately-unmapped pair, which throw their own way).
    expect(expectedMapped.length).toBeGreaterThan(0);
  });
});
