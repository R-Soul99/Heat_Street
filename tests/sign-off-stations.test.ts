import { describe, expect, it } from "vitest";
import gridTestStationsRaw from "../public/maps/grid-test.stations.json?raw";
import gridTestSidecarRaw from "../public/maps/grid-test.terrain.json?raw";
import julietteStationsRaw from "../public/maps/juliette-ga.stations.json?raw";
import julietteSidecarRaw from "../public/maps/juliette-ga.terrain.json?raw";
import { parseTerrainSidecar } from "../src/core/terrain-format";
import { parseStations, type TestStation } from "../src/debug/test-stations";

// The grid extent is the graph bounds to within one cell (loadTerrainArea
// enforces that), so the sidecar is enough to check pads without the .bin.
interface Maps {
  readonly stations: readonly TestStation[];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly edges: readonly { points: readonly (readonly number[])[] }[];
}

function load(id: string, stationsRaw: string, sidecarRaw: string): Maps {
  const sidecar = parseTerrainSidecar(sidecarRaw, id, `${id}.terrain.json`);
  return {
    stations: parseStations(stationsRaw, id),
    bounds: sidecar.graph.bounds,
    edges: sidecar.graph.edges,
  };
}

const MAPS: Record<string, Maps> = {
  "juliette-ga": load("juliette-ga", julietteStationsRaw, julietteSidecarRaw),
  "grid-test": load("grid-test", gridTestStationsRaw, gridTestSidecarRaw),
};

/** Nearest road centreline point to (x, z): distance and the segment's travel heading options. */
function nearestRoad(m: Maps, x: number, z: number): { dist: number; headings: number[] } {
  let best = Number.POSITIVE_INFINITY;
  let headings: number[] = [];
  for (const e of m.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const [ax, , az] = e.points[i - 1];
      const [bx, , bz] = e.points[i];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best - 1e-6) {
        best = d;
        headings = [];
      }
      if (Math.abs(d - best) <= 1e-6) {
        const h = Math.atan2(-dx, -dz);
        headings.push(h, h + Math.PI);
      }
    }
  }
  return { dist: best, headings };
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

/** Metres from the pad along its heading to the grid boundary. */
function distanceToEdge(m: Maps, s: TestStation): number {
  const fx = -Math.sin(s.headingRad);
  const fz = -Math.cos(s.headingRad);
  const ts: number[] = [];
  if (fx > 1e-9) ts.push((m.bounds.maxX - s.x) / fx);
  if (fx < -1e-9) ts.push((m.bounds.minX - s.x) / fx);
  if (fz > 1e-9) ts.push((m.bounds.maxZ - s.z) / fz);
  if (fz < -1e-9) ts.push((m.bounds.minZ - s.z) / fz);
  return Math.min(...ts);
}

// Pads that are on a road on purpose but whose heading is allowed to differ:
// none. Every pad below is on a centreline facing along it; the edge pad's
// heading is the road's own, and it is the road that runs at the edge.
describe.each(Object.keys(MAPS))("sign-off stations: %s", (id) => {
  const m = MAPS[id];

  it("has unique digit keys and named, noted stations", () => {
    const keys = m.stations.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of m.stations) {
      expect(s.key).toMatch(/^[0-9]$/);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.note.length).toBeGreaterThan(0);
    }
  });

  it("puts every pad inside the grid, on a road centreline, facing along the road", () => {
    for (const s of m.stations) {
      expect(s.x).toBeGreaterThan(m.bounds.minX);
      expect(s.x).toBeLessThan(m.bounds.maxX);
      expect(s.z).toBeGreaterThan(m.bounds.minZ);
      expect(s.z).toBeLessThan(m.bounds.maxZ);
      const road = nearestRoad(m, s.x, s.z);
      expect(road.dist, `${s.id} distance to road`).toBeLessThan(2);
      const off = Math.min(...road.headings.map((h) => angleDiff(h, s.headingRad)));
      expect(off, `${s.id} heading off the road direction`).toBeLessThan((10 * Math.PI) / 180);
    }
  });
});

describe("juliette-ga sign-off stations", () => {
  const m = MAPS["juliette-ga"];
  const byId = (sid: string): TestStation => {
    const s = m.stations.find((q) => q.id === sid);
    if (s === undefined) throw new Error(`no station ${sid}`);
    return s;
  };

  it("keys 1-4, 6 and 7 are present (no jump near an edge, so no 5)", () => {
    expect(m.stations.map((s) => s.key).sort()).toEqual(["1", "2", "3", "4", "6", "7"]);
  });

  it("station 4 faces the map edge, 100-200 m away", () => {
    const edge = byId("edge-berm");
    expect(edge.key).toBe("4");
    const d = distanceToEdge(m, edge);
    expect(d).toBeGreaterThanOrEqual(100);
    expect(d).toBeLessThanOrEqual(200);
  });

  it("stations 2 and 3 state their run-up", () => {
    expect(byId("gentle-bend").featureAheadM).toBe(200);
    expect(byId("tight-corner").featureAheadM).toBe(150);
  });

  it("stations 1 and 7 are different roads far apart", () => {
    const a = byId("fast-straight");
    const b = byId("area-crossing");
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(500);
  });
});
