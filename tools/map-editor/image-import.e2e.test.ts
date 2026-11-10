/**
 * End to end: committed sample PNG -> decodeGreyPng -> traced road graph ->
 * editor roads envelope -> the UNCHANGED map-compiler pipeline -> validateGraph.
 * Nothing is written to disk.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildRoadGeometry } from "../../src/core/road-geometry.ts";
import { parseRoadGraph } from "../../src/core/road-graph.ts";
import type { AreaConfig } from "../map-compiler/areas/juliette-ga.config.ts";
import { decodeGreyPng } from "../map-compiler/author/real-relief.ts";
import { buildGraph } from "../map-compiler/graph/build-graph.ts";
import { applyFlatElevation } from "../map-compiler/graph/elevation.ts";
import { validateGraph } from "../map-compiler/validate/validator.ts";
import { appendImportedRoads, importScale } from "./image-import.ts";
import { imageToRoadGraph, type RoadGraphPx } from "./image-trace.ts";
import { blankWorld, worldFromBbox } from "./world.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "samples");

function run(file: string, widthKm: number) {
  const img = decodeGreyPng(new Uint8Array(readFileSync(path.join(dir, file))));
  const lum = Array.from(img.values, (v) => v * 255);
  const graph: RoadGraphPx = imageToRoadGraph(lum, img.width, img.height);
  const scale = importScale({ imageW: img.width, imageH: img.height, widthKm });
  const { roads } = blankWorld(
    "img-e2e",
    widthKm,
    scale.heightM / 1000,
    "2026-01-01T00:00:00.000Z",
  );
  const world = worldFromBbox(roads.bbox);
  const ways = appendImportedRoads(roads, world.projector, graph, {
    imageH: img.height,
    mPerPx: scale.mPerPx,
    offset: { x: 0, y: 0 },
  });
  const config: AreaConfig = {
    areaId: "img-e2e",
    name: "Image import e2e",
    bbox: roads.bbox,
    demSource: "none-flat-authored",
    osmSnapshot: "2026-01-01T00:00:00.000Z",
    osmExtract: "authored://heat-street/img-e2e",
    excludeHighwayClasses: [],
    surfaceFallbackAcknowledged: true,
  };
  const { graph: g } = buildGraph(roads, config);
  const { graph: flat } = applyFlatElevation(g);
  parseRoadGraph(JSON.stringify(flat), "image-import e2e");
  const geometry = buildRoadGeometry(flat);
  const failures = validateGraph(flat, geometry);
  const local = ways.map((w) => w.geometry.map((p) => world.projector.toLocal(p)));
  return { graph, ways, local, failures };
}

/** Largest turn (degrees) at any interior vertex and shortest segment (m). */
function shape(pts: { x: number; y: number }[]): { maxTurn: number; minSeg: number } {
  let maxTurn = 0;
  let minSeg = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as { x: number; y: number };
    const b = pts[i] as { x: number; y: number };
    minSeg = Math.min(minSeg, Math.hypot(b.x - a.x, b.y - a.y));
    if (i < pts.length - 1) {
      const c = pts[i + 1] as { x: number; y: number };
      let d = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
      if (d > Math.PI) d = 2 * Math.PI - d;
      maxTurn = Math.max(maxTurn, (d * 180) / Math.PI);
    }
  }
  return { maxTurn, minSeg };
}

describe("image import end to end", () => {
  it.each([
    ["loop.png", 4],
    ["t-junction.png", 4],
    ["crossing.png", 4],
    ["curve.png", 4],
  ])("%s compiles with zero validation failures", (file, km) => {
    expect(run(file, km).failures).toEqual([]);
  });

  it("loop.png: clean graph, no dead ends, no stair-steps", () => {
    const r = run("loop.png", 4);
    const deg = (d: number) => r.graph.nodes.filter((n) => n.degree === d).length;
    expect(deg(1)).toBe(0);
    expect(deg(3)).toBe(4);
    expect(deg(4)).toBe(1);
    for (const pts of r.local) {
      const s = shape(pts);
      expect(s.maxTurn).toBeLessThanOrEqual(30);
      expect(s.minSeg).toBeGreaterThanOrEqual(1);
    }
  });

  it("t-junction.png has one degree-3 node; crossing.png one degree-4 node", () => {
    expect(run("t-junction.png", 4).graph.nodes.filter((n) => n.degree === 3).length).toBe(1);
    const c = run("crossing.png", 4).graph;
    expect(c.nodes.filter((n) => n.degree === 4).length).toBe(1);
    expect(c.nodes.filter((n) => n.degree === 3).length).toBe(0);
  });

  it("curve.png is one smooth way", () => {
    const r = run("curve.png", 4);
    expect(r.ways.length).toBe(1);
    expect(shape(r.local[0] ?? []).maxTurn).toBeLessThanOrEqual(30);
  });
});
