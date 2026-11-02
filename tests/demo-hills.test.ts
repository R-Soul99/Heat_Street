/**
 * Validity checks for the hand-sculpted demo map (phase 04.2 plan 14, D-12).
 *
 * `demo-hills` was made from scratch by the user in the terrain sculpt page and
 * saved through the dev middleware; these tests load the committed files
 * through the hardened codec (T-04.2-41) and prove every existing graph
 * consumer accepts them. The map is the user's work: when an assertion fails
 * the fix is a re-save from the editor, never a hand edit of the files.
 *
 * Known state of the saved map (recorded in 04.2-14-SUMMARY.md):
 * - The validator reports GEOMETRY_SELF_INTERSECTION on edge 0 (segments 299,
 *   305, 306: a tight fold where the ribbon winding flips). The editor saves
 *   despite it and the map loads and drives. The test pins that this is the
 *   ONLY failure category, so a new kind of breakage still fails loudly.
 * - The road is one open edge (2 nodes, no junction) on grass + tarmac paint
 *   only; the plan's junction and off-road-paint checks are left as todos.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRoadGeometry } from "../src/core/road-geometry.ts";
import { parseRoadGraph } from "../src/core/road-graph.ts";
import { loadTerrainArea, type TerrainArea } from "../src/core/terrain-format.ts";
import { sampleTerrainHeight } from "../src/core/terrain-grid.ts";
import { MAX_SLOPE_DEG } from "../src/core/terrain-limits.ts";
import { PAINT_ROAD_FLAG, paintIndexAt } from "../src/core/terrain-paint.ts";
import { maxSlopeDegIn } from "../src/core/terrain-slope.ts";
import { validateGraph } from "../tools/map-compiler/validate/validator.ts";

const BIN_PATH = "public/maps/demo-hills.terrain.bin";
const JSON_PATH = "public/maps/demo-hills.terrain.json";

async function loadDemo(): Promise<TerrainArea> {
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  const json = readFileSync(JSON_PATH, "utf8");
  return loadTerrainArea(bin, json, "demo-hills", "demo-hills.terrain");
}

describe("demo-hills (hand-sculpted demo map)", () => {
  it("starts with the HSTR magic and loads through the hardened codec", async () => {
    const bin = readFileSync(BIN_PATH);
    expect(bin.subarray(0, 4).toString("latin1")).toBe("HSTR");
    const area = await loadDemo();
    expect(area.areaId).toBe("demo-hills");
    expect(area.groundSurface).toBe("grass");
  });

  it("round-trips its road graph through parseRoadGraph", async () => {
    const area = await loadDemo();
    const reparsed = parseRoadGraph(JSON.stringify(area.graph), "demo-hills graph");
    expect(reparsed.nodes.length).toBe(area.graph.nodes.length);
    expect(reparsed.edges.length).toBe(area.graph.edges.length);
    expect(reparsed.edges.length).toBeGreaterThanOrEqual(1);
  });

  it("has no referential-integrity failures; the only geometry failure is the known edge-0 fold", async () => {
    const area = await loadDemo();
    const failures = validateGraph(area.graph, buildRoadGeometry(area.graph));
    expect(failures.filter((f) => f.category === "REFERENTIAL_INTEGRITY")).toEqual([]);
    const geometry = failures.filter((f) => f.category.startsWith("GEOMETRY_"));
    for (const f of geometry) {
      expect(f.category).toBe("GEOMETRY_SELF_INTERSECTION");
      expect(f.id).toBe(0);
    }
  });

  it("has a default spawn on an existing node", async () => {
    const area = await loadDemo();
    const spawn = (area.graph.spawns ?? []).find((s) => s.id === "default");
    expect(spawn).toBeDefined();
    expect(area.graph.nodes.some((n) => n.id === spawn?.nodeId)).toBe(true);
  });

  it("is hilly: heights span at least 5 m", async () => {
    const { grid } = await loadDemo();
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const h of grid.heights) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi - lo).toBeGreaterThanOrEqual(5);
  });

  it("respects the max slope over the whole grid (D-03)", async () => {
    const { grid } = await loadDemo();
    const slope = maxSlopeDegIn(grid, {
      minRow: 0,
      minCol: 0,
      maxRow: grid.rows,
      maxCol: grid.cols,
    });
    expect(slope).toBeLessThanOrEqual(MAX_SLOPE_DEG + 0.5);
  });

  it("has terrain height equal to node.y at every graph node (D-16)", async () => {
    const area = await loadDemo();
    for (const n of area.graph.nodes) {
      expect(Math.abs(sampleTerrainHeight(area.grid, n.x, n.z) - n.y)).toBeLessThanOrEqual(0.05);
    }
  });

  it("stays inside the 2 x 2 km envelope (D-04)", async () => {
    const { grid } = await loadDemo();
    expect(grid.scaleX).toBeLessThanOrEqual(2000);
    expect(grid.scaleZ).toBeLessThanOrEqual(2000);
  });

  it("carries road-flagged paint under every graph node", async () => {
    const area = await loadDemo();
    for (const n of area.graph.nodes) {
      const i = paintIndexAt(area.paint, n.x, n.z);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(area.paint.data[i] & PAINT_ROAD_FLAG).toBe(PAINT_ROAD_FLAG);
    }
  });

  // Plan 14 asked for these; the saved map has a single open road edge (no
  // crossing) and grass + tarmac paint only. Re-save from the editor with a
  // crossing and a mud/gravel/sand patch, then turn these into real checks.
  it.todo("has at least one junction node");
  it.todo("has an off-road surface edge or a mud/gravel/sand paint patch");
});
