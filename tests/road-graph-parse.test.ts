import { describe, expect, it } from "vitest";
import { parseRoadGraph } from "../src/core/road-graph";

// Read through Vite's `?raw` transform, matching
// `tests/road-graph-schema.test.ts`'s existing idiom.
import fixtureRaw from "../fixtures/road-graph.sample.json?raw";

/** A fresh, independent deep clone of the fixture, safe to mutate per test case. */
function cloneFixture(): Record<string, unknown> {
  return JSON.parse(fixtureRaw) as Record<string, unknown>;
}

const REQUIRED_TOP_LEVEL = [
  "schemaVersion",
  "areaId",
  "name",
  "source",
  "attribution",
  "origin",
  "bounds",
  "nodes",
  "edges",
] as const;

const REQUIRED_SOURCE = ["osmExtract", "osmSnapshot", "demSource", "compilerVersion"] as const;
const REQUIRED_ATTRIBUTION = ["osm", "osmLicense", "osmLicenseUrl", "dem"] as const;

describe("parseRoadGraph — accepts the conforming fixture", () => {
  it("returns a fully typed RoadGraph with 4 nodes and 4 edges", () => {
    const graph = parseRoadGraph(fixtureRaw, "fixtures/road-graph.sample.json");
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(graph.schemaVersion).toBe(1);
    expect(graph.areaId).toBe("sample-square");
  });
});

describe("parseRoadGraph — schemaVersion", () => {
  it("throws naming schemaVersion when absent", () => {
    const clone = cloneFixture();
    delete clone.schemaVersion;
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/schemaVersion/);
  });

  it("throws naming schemaVersion when not the integer 1", () => {
    const clone = cloneFixture();
    clone.schemaVersion = 2;
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/schemaVersion/);
  });

  it("throws naming schemaVersion when it is the string \"1\"", () => {
    const clone = cloneFixture();
    clone.schemaVersion = "1";
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/schemaVersion/);
  });
});

describe("parseRoadGraph — required top-level keys", () => {
  for (const key of REQUIRED_TOP_LEVEL) {
    it(`throws naming "${key}" when missing from the top level`, () => {
      const clone = cloneFixture();
      delete clone[key];
      expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(new RegExp(key));
    });
  }
});

describe("parseRoadGraph — required source keys", () => {
  for (const key of REQUIRED_SOURCE) {
    it(`throws naming "${key}" when missing from source`, () => {
      const clone = cloneFixture();
      delete (clone.source as Record<string, unknown>)[key];
      expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(new RegExp(key));
    });
  }
});

describe("parseRoadGraph — required attribution keys", () => {
  for (const key of REQUIRED_ATTRIBUTION) {
    it(`throws naming "${key}" when missing from attribution`, () => {
      const clone = cloneFixture();
      delete (clone.attribution as Record<string, unknown>)[key];
      expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(new RegExp(key));
    });
  }
});

describe("parseRoadGraph — edge surface", () => {
  it("throws naming the offending edge id when surface is not one of the six SURFACE_TYPES", () => {
    const clone = cloneFixture();
    (clone.edges as Record<string, unknown>[])[0].surface = "cobblestone";
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/id=0/);
  });
});

describe("parseRoadGraph — edge points", () => {
  it("throws naming the offending edge id when points has fewer than 2 entries", () => {
    const clone = cloneFixture();
    (clone.edges as Record<string, unknown>[])[0].points = [[0, 0, 0]];
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/id=0/);
  });

  it("throws naming the offending edge id when a points entry is not a 3-number tuple", () => {
    const clone = cloneFixture();
    (clone.edges as Record<string, unknown>[])[0].points = [
      [0, 0],
      [100, 0.5, 0],
    ];
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/id=0/);
  });

  it("throws naming the offending edge id when points[0] does not equal the from node's coordinates", () => {
    const clone = cloneFixture();
    const edge = (clone.edges as Record<string, unknown>[])[0];
    const points = edge.points as number[][];
    points[0] = [999, 0, 0];
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/id=0/);
  });

  it("throws naming the offending edge id when the last point does not equal the to node's coordinates", () => {
    const clone = cloneFixture();
    const edge = (clone.edges as Record<string, unknown>[])[0];
    const points = edge.points as number[][];
    points[points.length - 1] = [999, 0, 0];
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/id=0/);
  });
});

describe("parseRoadGraph — edge from/to references", () => {
  it("throws naming the offending edge id when from is not an existing node id", () => {
    const clone = cloneFixture();
    (clone.edges as Record<string, unknown>[])[0].from = 99;
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/id=0/);
  });

  it("throws naming the offending edge id when to is not an existing node id", () => {
    const clone = cloneFixture();
    (clone.edges as Record<string, unknown>[])[0].to = 99;
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/id=0/);
  });
});

describe("parseRoadGraph — dense contiguous node ids", () => {
  it("throws naming the first gap when node ids are not dense/contiguous from 0", () => {
    const clone = cloneFixture();
    (clone.nodes as Record<string, unknown>[])[1].id = 9;
    expect(() => parseRoadGraph(JSON.stringify(clone), "x")).toThrow(/\b1\b/);
  });
});

describe("parseRoadGraph — malformed top-level JSON shapes", () => {
  it("throws on valid JSON that is not an object: null", () => {
    expect(() => parseRoadGraph("null", "x")).toThrow();
  });

  it("throws on valid JSON that is not an object: []", () => {
    expect(() => parseRoadGraph("[]", "x")).toThrow();
  });

  it("throws on valid JSON that is not an object: 7", () => {
    expect(() => parseRoadGraph("7", "x")).toThrow();
  });

  it("throws on input that is not valid JSON at all, naming the artifact rather than a bare SyntaxError", () => {
    let caught: unknown;
    try {
      parseRoadGraph("{not json", "my-artifact-label");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("my-artifact-label");
    expect(message).not.toContain("SyntaxError");
  });
});

describe("parseRoadGraph — prototype pollution resistance", () => {
  it("a __proto__ key in the input cannot reach the returned object or Object.prototype", () => {
    const clone = cloneFixture();
    // `Object.defineProperty` (not literal assignment) is used deliberately —
    // assigning `clone.__proto__ = ...` or using `{ __proto__: ... }` object
    // literal syntax would trigger the real accessor and actually change
    // `clone`'s prototype in THIS test file, which is not what a hostile JSON
    // blob on disk looks like. `JSON.parse` never triggers that accessor
    // (it uses CreateDataPropertyOrThrow internally), so defineProperty here
    // is what faithfully reproduces the on-disk attack shape.
    Object.defineProperty(clone, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    });
    const raw = JSON.stringify(clone);
    expect(raw).toContain("__proto__");

    const graph = parseRoadGraph(raw, "x");
    expect(Object.getPrototypeOf(graph)).toBe(Object.prototype);
    expect((graph as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("a constructor key in the input cannot reach the returned object", () => {
    const clone = cloneFixture();
    (clone as Record<string, unknown>).constructor = { polluted: true };
    const raw = JSON.stringify(clone);

    const graph = parseRoadGraph(raw, "x");
    expect((graph as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(graph)).toBe(Object.prototype);
  });
});
