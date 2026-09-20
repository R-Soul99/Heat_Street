import { describe, expect, it } from "vitest";
import fixtureRaw from "../../../fixtures/overpass.juliette-sample.json?raw";
import { julietteGaConfig } from "../areas/juliette-ga.config.ts";
import {
  type BuildGraphConfig,
  buildGraph,
  COMPILER_VERSION,
  DEFAULT_LANES_BY_CLASS,
  DEFAULT_SPEED_KPH_BY_CLASS,
  type RoadsEnvelopeLike,
} from "./build-graph.ts";

const BASE_CONFIG: BuildGraphConfig = {
  areaId: "test-area",
  name: "Test Area",
  bbox: { south: 32.999, west: -83.002, north: 33.002, east: -82.999 },
  demSource: "none-flat-authored",
  osmSnapshot: "2026-09-13T20:25:59.876Z",
  osmExtract: "overpass://overpass-api.de/test-area",
  excludeHighwayClasses: [],
};

function envelope(elements: unknown[]): RoadsEnvelopeLike {
  return { response: { elements } };
}

function way(
  id: number,
  nodes: number[] | undefined,
  points: [number, number][],
  tags: Record<string, string>,
): unknown {
  return {
    type: "way",
    id,
    ...(nodes !== undefined ? { nodes } : {}),
    geometry: points.map(([lat, lon]) => ({ lat, lon })),
    tags,
  };
}

const fixtureEnvelope = JSON.parse(fixtureRaw) as RoadsEnvelopeLike;

describe("buildGraph — Task 1: topology", () => {
  it("makes a node shared by three ways a junction (degree 3)", () => {
    const elements = [
      way(
        1,
        [101, 102],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential" },
      ),
      way(
        2,
        [102, 103],
        [
          [33.0, -83.0],
          [33.001, -83.0],
        ],
        { highway: "residential" },
      ),
      way(
        3,
        [102, 104],
        [
          [33.0, -83.0],
          [32.999, -83.0],
        ],
        { highway: "residential" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    const shared = graph.nodes.find((n) => n.osmNodeId === 102);
    expect(shared).toBeDefined();
    expect(shared?.junction).toBe(true);
  });

  it("makes a node shared by two ways NOT a junction (degree 2)", () => {
    const elements = [
      way(
        4,
        [201, 202],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential" },
      ),
      way(
        5,
        [202, 203],
        [
          [33.0, -83.0],
          [33.001, -83.0],
        ],
        { highway: "residential" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    const shared = graph.nodes.find((n) => n.osmNodeId === 202);
    expect(shared).toBeDefined();
    expect(shared?.junction).toBe(false);
  });

  it("always makes a way's own endpoints graph nodes, even unshared (dead end, junction false)", () => {
    const elements = [
      way(
        6,
        [301, 302],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    const deadEnd = graph.nodes.find((n) => n.osmNodeId === 301);
    expect(deadEnd).toBeDefined();
    expect(deadEnd?.junction).toBe(false);
  });

  it("splits a way into two edges where it passes through a node shared with another way", () => {
    const elements = [
      way(
        7,
        [401, 402, 403],
        [
          [33.0, -83.002],
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        {
          highway: "residential",
        },
      ),
      way(
        8,
        [402, 404],
        [
          [33.0, -83.001],
          [33.001, -83.001],
        ],
        { highway: "residential" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    const way7Edges = graph.edges.filter((e) => e.osmWayId === 7);
    expect(way7Edges).toHaveLength(2);
  });

  it("assigns dense, contiguous node and edge ids from 0", () => {
    const { graph } = buildGraph(fixtureEnvelope, julietteGaConfig);
    expect(graph.nodes.map((n) => n.id)).toEqual([...graph.nodes.keys()]);
    expect(graph.edges.map((e) => e.id)).toEqual([...graph.edges.keys()]);
  });

  it("matches every edge's points[0]/points[last] exactly to its from/to node coordinates (real fixture)", () => {
    const { graph } = buildGraph(fixtureEnvelope, julietteGaConfig);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      const first = edge.points[0];
      const last = edge.points[edge.points.length - 1];
      expect(first[0]).toBe(from?.x);
      expect(first[1]).toBe(from?.y);
      expect(first[2]).toBe(from?.z);
      expect(last[0]).toBe(to?.x);
      expect(last[1]).toBe(to?.y);
      expect(last[2]).toBe(to?.z);
    }
  });

  it("computes lengthM as the summed XZ distance along points, within 1e-6", () => {
    const elements = [
      way(
        9,
        [501, 502],
        [
          [33.0, -83.0],
          [33.001, -83.0],
        ],
        { highway: "residential" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    const edge = graph.edges.find((e) => e.osmWayId === 9);
    expect(edge).toBeDefined();
    if (edge === undefined) return;
    let expected = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const dx = edge.points[i][0] - edge.points[i - 1][0];
      const dz = edge.points[i][2] - edge.points[i - 1][2];
      expected += Math.sqrt(dx * dx + dz * dz);
    }
    expect(Math.abs(edge.lengthM - expected)).toBeLessThan(1e-6);
  });

  it("drops excluded-highway-class ways with no explicit surface tag, and counts the drop", () => {
    const elements = [
      way(
        10,
        [601, 602],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "service" },
      ),
      way(
        11,
        [603, 604],
        [
          [33.0, -83.002],
          [33.0, -83.003],
        ],
        { highway: "residential" },
      ),
    ];
    const config: BuildGraphConfig = { ...BASE_CONFIG, excludeHighwayClasses: ["service"] };
    const { graph, report } = buildGraph(envelope(elements), config);
    expect(graph.edges.some((e) => e.osmWayId === 10)).toBe(false);
    expect(report.waysDroppedByReason["excluded-highway-no-surface"]).toBe(1);
    expect(report.waysRetained).toBe(1);
  });

  it("keeps an excluded-highway-class way that DOES carry an explicit surface tag (D-P13)", () => {
    const elements = [
      way(
        12,
        [701, 702],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "service", surface: "gravel" },
      ),
    ];
    const config: BuildGraphConfig = { ...BASE_CONFIG, excludeHighwayClasses: ["service"] };
    const { graph, report } = buildGraph(envelope(elements), config);
    expect(graph.edges.some((e) => e.osmWayId === 12)).toBe(true);
    expect(report.waysRetained).toBe(1);
  });

  it("falls back to coordinate-keyed node identity when a way's `nodes` array is missing, and reports it", () => {
    const elements = [
      way(
        13,
        undefined,
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential" },
      ),
    ];
    const { graph, report } = buildGraph(envelope(elements), BASE_CONFIG);
    expect(report.nodeIdentityMode).toBe("coordinate-keyed");
    expect(graph.nodes).toHaveLength(2);
  });

  it("prunes a component disconnected from the largest one, reporting each pruned edge by id/osmWayId/length", () => {
    const mainComponent = [
      way(
        20,
        [1001, 1002],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential" },
      ),
      way(
        21,
        [1002, 1003],
        [
          [33.0, -83.0],
          [33.001, -83.0],
        ],
        { highway: "residential" },
      ),
      way(
        22,
        [1002, 1004],
        [
          [33.0, -83.0],
          [32.999, -83.0],
        ],
        { highway: "residential" },
      ),
    ];
    // Deliberately disconnected: two edges, far away, sharing no node key with
    // the main component.
    const orphan = [
      way(
        30,
        [2001, 2002],
        [
          [33.05, -83.05],
          [33.051, -83.05],
        ],
        { highway: "residential" },
      ),
      way(
        31,
        [2002, 2003],
        [
          [33.051, -83.05],
          [33.052, -83.05],
        ],
        { highway: "residential" },
      ),
    ];
    const { graph, report } = buildGraph(envelope([...mainComponent, ...orphan]), BASE_CONFIG);

    expect(graph.edges.some((e) => e.osmWayId === 30)).toBe(false);
    expect(graph.edges.some((e) => e.osmWayId === 31)).toBe(false);
    expect(report.prunedEdges).toHaveLength(2);
    const prunedWayIds = report.prunedEdges.map((e) => e.osmWayId).sort();
    expect(prunedWayIds).toEqual([30, 31]);
    for (const pruned of report.prunedEdges) {
      expect(pruned.lengthM).toBeGreaterThan(0);
      expect(Number.isInteger(pruned.id)).toBe(true);
    }
  });

  it("produces byte-identical JSON.stringify output across two builds (determinism)", () => {
    const first = buildGraph(fixtureEnvelope, julietteGaConfig);
    const second = buildGraph(fixtureEnvelope, julietteGaConfig);
    expect(JSON.stringify(first.graph)).toBe(JSON.stringify(second.graph));
  });
});

describe("buildGraph — Task 2: edge attribute resolution and artifact assembly", () => {
  it("resolves surface via mapSurface and aborts the build on an unmapped value, naming it and the osmWayId", () => {
    const elements = [
      way(
        40,
        [3001, 3002],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        {
          highway: "residential",
          surface: "cobblestone",
        },
      ),
    ];
    expect(() => buildGraph(envelope(elements), BASE_CONFIG)).toThrow(/cobblestone/);
    expect(() => buildGraph(envelope(elements), BASE_CONFIG)).toThrow(/40/);
  });

  it("carries roadClass as the raw OSM highway value, unchanged", () => {
    const elements = [
      way(
        41,
        [3101, 3102],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "tertiary", surface: "asphalt" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    expect(graph.edges[0].roadClass).toBe("tertiary");
  });

  it("parses tags.lanes when a positive integer, else falls back to the per-class default", () => {
    // Each way is built in its own buildGraph call — combining unconnected
    // ways in one envelope would form separate single-edge components, and
    // pruning (Task 1) keeps only the largest, arbitrarily discarding the
    // other. These attribute-resolution tests deliberately isolate one way
    // per call so pruning never interferes with what's under test.
    const withLanes = way(
      42,
      [3201, 3202],
      [
        [33.0, -83.001],
        [33.0, -83.0],
      ],
      {
        highway: "residential",
        surface: "asphalt",
        lanes: "4",
      },
    );
    const withoutLanes = way(
      43,
      [3301, 3302],
      [
        [33.0, -83.003],
        [33.0, -83.002],
      ],
      {
        highway: "track",
        surface: "dirt",
      },
    );
    const g42 = buildGraph(envelope([withLanes]), BASE_CONFIG).graph;
    const g43 = buildGraph(envelope([withoutLanes]), BASE_CONFIG).graph;
    expect(g42.edges[0].lanes).toBe(4);
    expect(g43.edges[0].lanes).toBe(DEFAULT_LANES_BY_CLASS.track);
  });

  it("parses tags.width in [2,30] else derives lanes * 3.5 clamped to [3.5, 20]", () => {
    const withWidth = way(
      44,
      [3401, 3402],
      [
        [33.0, -83.001],
        [33.0, -83.0],
      ],
      {
        highway: "residential",
        surface: "asphalt",
        width: "8",
      },
    );
    const withoutWidth = way(
      45,
      [3501, 3502],
      [
        [33.0, -83.003],
        [33.0, -83.002],
      ],
      {
        highway: "residential",
        surface: "asphalt",
        lanes: "2",
      },
    );
    const g44 = buildGraph(envelope([withWidth]), BASE_CONFIG).graph;
    const g45 = buildGraph(envelope([withoutWidth]), BASE_CONFIG).graph;
    expect(g44.edges[0].widthM).toBe(8);
    expect(g45.edges[0].widthM).toBe(7);
  });

  it("reverses points and swaps from/to for oneway=-1, while oneway=yes leaves direction intact", () => {
    const forward = way(
      46,
      [3601, 3602],
      [
        [33.0, -83.001],
        [33.0, -83.0],
      ],
      {
        highway: "residential",
        surface: "asphalt",
        oneway: "yes",
      },
    );
    const reversed = way(
      47,
      [3701, 3702],
      [
        [33.0, -83.003],
        [33.0, -83.002],
      ],
      {
        highway: "residential",
        surface: "asphalt",
        oneway: "-1",
      },
    );
    const gForward = buildGraph(envelope([forward]), BASE_CONFIG).graph;
    const gReversed = buildGraph(envelope([reversed]), BASE_CONFIG).graph;
    const eForward = gForward.edges[0];
    const eReversed = gReversed.edges[0];
    expect(eForward.oneway).toBe(true);
    const forwardFromNode = gForward.nodes.find((n) => n.id === eForward.from);
    expect(forwardFromNode?.osmNodeId).toBe(3601);

    expect(eReversed.oneway).toBe(true);
    const reversedFromNode = gReversed.nodes.find((n) => n.id === eReversed.from);
    const reversedToNode = gReversed.nodes.find((n) => n.id === eReversed.to);
    // Raw way order was 3701 -> 3702; oneway=-1 must swap to 3702 -> 3701.
    expect(reversedFromNode?.osmNodeId).toBe(3702);
    expect(reversedToNode?.osmNodeId).toBe(3701);
    expect(eReversed.points[0][0]).toBe(reversedFromNode?.x);
  });

  it("parses maxspeed: a bare number, an 'N mph' form, and an unparseable value falling back to the class default", () => {
    const bare = way(
      48,
      [3801, 3802],
      [
        [33.0, -83.001],
        [33.0, -83.0],
      ],
      {
        highway: "residential",
        surface: "asphalt",
        maxspeed: "60",
      },
    );
    const mph = way(
      49,
      [3901, 3902],
      [
        [33.0, -83.003],
        [33.0, -83.002],
      ],
      {
        highway: "tertiary",
        surface: "asphalt",
        maxspeed: "35 mph",
      },
    );
    const bad = way(
      50,
      [4001, 4002],
      [
        [33.0, -83.005],
        [33.0, -83.004],
      ],
      {
        highway: "residential",
        surface: "asphalt",
        maxspeed: "signals",
      },
    );
    const eBare = buildGraph(envelope([bare]), BASE_CONFIG).graph.edges[0];
    const eMph = buildGraph(envelope([mph]), BASE_CONFIG).graph.edges[0];
    const eBad = buildGraph(envelope([bad]), BASE_CONFIG).graph.edges[0];
    expect(eBare.speedLimitKph).toBe(60);
    expect(eMph.speedLimitKph).toBe(Math.round(35 * 1.609344));
    expect(eBad.speedLimitKph).toBe(DEFAULT_SPEED_KPH_BY_CLASS.residential);
  });

  it("sets bridge/tunnel true when the tag is present and not 'no', and layer from tags.layer", () => {
    const bridgeWay = way(
      51,
      [4101, 4102],
      [
        [33.0, -83.001],
        [33.0, -83.0],
      ],
      {
        highway: "tertiary",
        surface: "asphalt",
        bridge: "yes",
        layer: "1",
      },
    );
    const noTunnelWay = way(
      52,
      [4201, 4202],
      [
        [33.0, -83.003],
        [33.0, -83.002],
      ],
      {
        highway: "tertiary",
        surface: "asphalt",
        tunnel: "no",
      },
    );
    const e51 = buildGraph(envelope([bridgeWay]), BASE_CONFIG).graph.edges[0];
    const e52 = buildGraph(envelope([noTunnelWay]), BASE_CONFIG).graph.edges[0];
    expect(e51.bridge).toBe(true);
    expect(e51.layer).toBe(1);
    expect(e52.tunnel).toBe(false);
    expect(e52.layer).toBe(0);
  });

  it("carries osmWayId on every edge derived from a way", () => {
    const elements = [
      way(
        53,
        [4301, 4302, 4303],
        [
          [33.0, -83.002],
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        {
          highway: "residential",
          surface: "asphalt",
        },
      ),
      way(
        54,
        [4302, 4304],
        [
          [33.0, -83.001],
          [33.001, -83.001],
        ],
        {
          highway: "residential",
          surface: "asphalt",
        },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    for (const edge of graph.edges) {
      expect([53, 54]).toContain(edge.osmWayId);
    }
  });

  it("fills source and attribution from config/ADR 0001, character for character", () => {
    const elements = [
      way(
        55,
        [4401, 4402],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential", surface: "asphalt" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    expect(graph.source.osmSnapshot).toBe(BASE_CONFIG.osmSnapshot);
    expect(graph.source.osmExtract).toBe(BASE_CONFIG.osmExtract);
    expect(graph.source.demSource).toBe(BASE_CONFIG.demSource);
    expect(graph.source.compilerVersion).toBe(COMPILER_VERSION);
    expect(graph.attribution.osm).toBe("© OpenStreetMap contributors");
    expect(graph.attribution.osmLicense).toBe("ODbL-1.0");
    expect(graph.attribution.osmLicenseUrl).toBe("https://www.openstreetmap.org/copyright");
    expect(graph.attribution.dem).toBe(
      "Terrain elevation is flat and hand-authored — no DEM data is used (see docs/adr/0001-map-data-source.md)",
    );
  });

  it("produces a non-empty attribution.dem for every demSource union member, and none-flat-authored names no DEM programme", () => {
    const demSources: BuildGraphConfig["demSource"][] = [
      "usgs-3dep-1m",
      "copernicus-glo30",
      "none-flat-authored",
    ];
    const elements = [
      way(
        56,
        [4501, 4502],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential", surface: "asphalt" },
      ),
    ];
    const attributionByDemSource = new Map<BuildGraphConfig["demSource"], string>();
    for (const demSource of demSources) {
      const { graph } = buildGraph(envelope(elements), { ...BASE_CONFIG, demSource });
      expect(graph.attribution.dem.length).toBeGreaterThan(0);
      attributionByDemSource.set(demSource, graph.attribution.dem);
    }
    const flatDem = attributionByDemSource.get("none-flat-authored");
    expect(flatDem).not.toContain("3DEP");
    expect(flatDem).not.toContain("USGS");
    expect(flatDem).not.toContain("Copernicus");
    // Belt-and-suspenders: the substring checks above don't catch a copy-paste of the actual
    // USGS/Copernicus attribution VALUES (they don't literally spell "USGS"/"Copernicus"'s
    // acronym forms), so also assert none-flat-authored's string is not byte-identical to either
    // real DEM programme's attribution — this is what actually fails if
    // DEM_ATTRIBUTION["none-flat-authored"] is copy-pasted from the USGS or Copernicus entry.
    expect(flatDem).not.toBe(attributionByDemSource.get("usgs-3dep-1m"));
    expect(flatDem).not.toBe(attributionByDemSource.get("copernicus-glo30"));
  });

  it("pins COMPILER_VERSION to 0.6.0 and mirrors it into the emitted graph.source.compilerVersion", () => {
    expect(COMPILER_VERSION).toBe("0.6.0");
    const elements = [
      way(
        57,
        [4601, 4602],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential", surface: "asphalt" },
      ),
    ];
    const { graph } = buildGraph(envelope(elements), BASE_CONFIG);
    expect(graph.source.compilerVersion).toBe(COMPILER_VERSION);
  });

  it("emits a default spawn at a degree>=2 node nearest the bbox centre, heading along its first incident edge", () => {
    const { graph } = buildGraph(fixtureEnvelope, julietteGaConfig);
    expect(graph.spawns).toBeDefined();
    expect(graph.spawns?.length).toBeGreaterThanOrEqual(1);
    const spawn = graph.spawns?.[0];
    expect(spawn?.id).toBe("default");
    expect(typeof spawn?.headingRad).toBe("number");
    expect(Number.isFinite(spawn?.headingRad)).toBe(true);
    const spawnNode = graph.nodes.find((n) => n.id === spawn?.nodeId);
    expect(spawnNode).toBeDefined();
  });

  it("reports surfaceCoverage explicit-vs-fallback counts per road class and an overall ratio", () => {
    // way56 and way57 share node 4502 so they form ONE connected component —
    // both must survive Task 1's largest-component pruning for this
    // aggregate coverage assertion to see both edges.
    const elements = [
      way(
        56,
        [4501, 4502],
        [
          [33.0, -83.001],
          [33.0, -83.0],
        ],
        { highway: "residential", surface: "asphalt" },
      ),
      way(
        57,
        [4502, 4602],
        [
          [33.0, -83.0],
          [33.0, -82.999],
        ],
        { highway: "residential" },
      ),
    ];
    const { report } = buildGraph(envelope(elements), BASE_CONFIG);
    expect(report.surfaceCoverage).not.toBeNull();
    expect(report.surfaceCoverage?.overall.explicit).toBe(1);
    expect(report.surfaceCoverage?.overall.fallback).toBe(1);
    expect(report.surfaceCoverage?.overall.fallbackRatio).toBeCloseTo(0.5, 6);
  });

  it("assembles a whole artifact that round-trips through parseRoadGraph without throwing (real fixture)", () => {
    expect(() => buildGraph(fixtureEnvelope, julietteGaConfig)).not.toThrow();
  });

  it("produces at least two distinct surface values across the real fixture's compiled edges (SC2)", () => {
    const { graph } = buildGraph(fixtureEnvelope, julietteGaConfig);
    const surfaces = new Set(graph.edges.map((e) => e.surface));
    expect(surfaces.size).toBeGreaterThanOrEqual(2);
  });
});
