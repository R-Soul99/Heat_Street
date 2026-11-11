/**
 * Authors `public/maps/newton-poppleford.routes.json` and `.medals.json` from
 * the compiled `newton-poppleford.map.json`: one p2p course (west-most to
 * east-most node, checkpoints spaced along the shortest road path) and one
 * 3-lap circuit (checkpoints at compass points around the village). Medal
 * splits are a flat-speed estimate, same as the grid-test authoring.
 *
 * Run after `compile-map`: `npm run author-newton-routes`
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCourseData } from "../../../src/core/course.ts";
import { yawFromTravelDirection } from "../../../src/core/heading.ts";
import {
  buildNavigationGraph,
  DEFECT_CLEARANCE_M,
  DEFECT_COORDINATES,
  findRoadPath,
  validateCourseRoutes,
} from "../../../src/core/navigation.ts";
import { parseRoadGraph, type RoadGraphNode } from "../../../src/core/road-graph.ts";

const AREA_FLAG = process.argv.indexOf("--area");
const AREA =
  AREA_FLAG === -1 ? "newton-poppleford" : (process.argv[AREA_FLAG + 1] ?? "newton-poppleford");
if (!/^[a-z0-9-]+$/.test(AREA)) throw new Error(`bad area id ${AREA}`);
const MAPS_DIR = path.join(import.meta.dirname, "..", "..", "..", "public", "maps");
const AVERAGE_SPEED_MPS = 14;
const MAX_CHECKPOINT_EDGE_WIDTH_M = 18;
const HANDLING_CONTENT_VERSION = "260920-sm2";
const P2P_MIN_SPACING_M = 100;
const P2P_MAX_CHECKPOINTS = 7;
const CIRCUIT_LAPS = 3;
const CIRCUIT_MAX_RADIUS_M = 700;
const pad = (n: number): string => String(n).padStart(2, "0");

async function run(): Promise<void> {
  const mapPath = path.join(MAPS_DIR, `${AREA}.map.json`);
  const graph = parseRoadGraph(await readFile(mapPath, "utf8"), mapPath);
  const navigation = buildNavigationGraph(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = graph.nodes.filter(
    (n) => !DEFECT_COORDINATES.some(([x, z]) => Math.hypot(n.x - x, n.z - z) < DEFECT_CLEARANCE_M),
  );
  const hasCheckpointEdge = (n: RoadGraphNode) =>
    graph.edges.some(
      (e) => (e.from === n.id || e.to === n.id) && e.widthM <= MAX_CHECKPOINT_EDGE_WIDTH_M,
    );
  const candidates = nodes.filter(hasCheckpointEdge);

  const edgeLen = (a: number, b: number) => navigation.graph.getLink(a, b)?.data.weight ?? 0;
  const pathOf = (a: number, b: number): readonly number[] => {
    const p = findRoadPath(navigation, a, b);
    if (p.length === 0) throw new Error(`no path ${a} -> ${b}`);
    return p;
  };
  const lengthOf = (p: readonly number[]) =>
    p.slice(1).reduce((sum, n, i) => sum + edgeLen(p[i] as number, n), 0);
  const nearest = (x: number, z: number) =>
    candidates.reduce((best, n) =>
      Math.hypot(n.x - x, n.z - z) < Math.hypot(best.x - x, best.z - z) ? n : best,
    );

  // p2p: west-most to east-most node, checkpoints every ~500 m along the path.
  const west = candidates.reduce((a, b) => (b.x < a.x ? b : a));
  const east = candidates.reduce((a, b) => (b.x > a.x ? b : a));
  const mainPath = pathOf(west.id, east.id);
  const p2pNodes: RoadGraphNode[] = [];
  let acc = 0;
  const spacing = Math.max(P2P_MIN_SPACING_M, lengthOf(mainPath) / (P2P_MAX_CHECKPOINTS - 1));
  let nextAt = spacing;
  mainPath.forEach((id, i) => {
    if (i > 0) acc += edgeLen(mainPath[i - 1] as number, id);
    const n = byId.get(id);
    if (n !== undefined && acc >= nextAt && id !== east.id && hasCheckpointEdge(n)) {
      p2pNodes.push(n);
      nextAt = acc + spacing;
    }
  });
  p2pNodes.push(east);

  // circuit: five points around the centroid of the road nodes.
  const xs = nodes.map((n) => n.x);
  const zs = nodes.map((n) => n.z);
  const cx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const cz = zs.reduce((s, v) => s + v, 0) / zs.length;
  const radius =
    0.5 * Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const ring = [0, 1, 2, 3, 4].map((k) => {
    const a = (k * Math.PI * 2) / 5;
    const r = Math.min(radius * 0.6, CIRCUIT_MAX_RADIUS_M);
    return nearest(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
  });
  const circuitStart = ring[0] as RoadGraphNode;
  const circuitNodes = ring.slice(1);

  const checkpointFor = (id: string, node: RoadGraphNode, routeNodes: readonly number[]) => {
    const incident = graph.edges.filter(
      (e) => (e.from === node.id || e.to === node.id) && e.widthM <= MAX_CHECKPOINT_EDGE_WIDTH_M,
    );
    const onRoute = incident.find((e) =>
      routeNodes.some((n, i) => {
        const next = routeNodes[i + 1];
        return (
          next !== undefined && ((e.from === n && e.to === next) || (e.to === n && e.from === next))
        );
      }),
    );
    const edge = onRoute ?? incident[0];
    if (edge === undefined) throw new Error(`node ${node.id} has no checkpoint-capable edge`);
    return {
      id,
      nodeId: node.id,
      edgeId: edge.id,
      position: [node.x, 0, node.z],
      sensor: { widthM: 20, depthM: 20, heightM: 10 },
    };
  };

  const buildCourse = (
    mode: "p2p" | "circuit",
    prefix: string,
    start: RoadGraphNode,
    cps: readonly RoadGraphNode[],
  ) => {
    const sequence = [start.id, ...cps.map((n) => n.id)];
    const legs: number[] = [];
    const routeNodes: number[] = [];
    for (let i = 0; i + 1 < sequence.length; i++) {
      const p = pathOf(sequence[i] as number, sequence[i + 1] as number);
      legs.push(lengthOf(p));
      routeNodes.push(...p);
    }
    const closure =
      mode === "circuit" ? lengthOf(pathOf(sequence[sequence.length - 1] as number, start.id)) : 0;
    const first = byId.get(pathOf(start.id, sequence[1] as number)[1] as number) as RoadGraphNode;
    const headingRad = yawFromTravelDirection(first.x - start.x, first.z - start.z);
    const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
    const usesDirt = [...sequence, ...(mode === "circuit" ? [start.id] : [])].some((id, i, seq) => {
      const next = seq[i + 1];
      if (next === undefined) return false;
      const leg = pathOf(id, next);
      return leg.slice(1).some((n, j) => {
        const edgeId = navigation.graph.getLink(leg[j] as number, n)?.data.edgeId;
        const surface = edgeId === undefined ? undefined : edgeById.get(edgeId)?.surface;
        return surface === "gravel" || surface === "dirt_road";
      });
    });
    const checkpoints = cps.map((n, i) => checkpointFor(`${prefix}-${pad(i + 1)}`, n, routeNodes));
    return { start, checkpoints, legs, closure, headingRad, usesDirt };
  };

  // Each course must touch a gravel/dirt_road edge: swap one middle checkpoint
  // for a node on a dirt road (nearest first) until the route includes one.
  const dirtEdges = graph.edges.filter((e) => e.surface === "gravel" || e.surface === "dirt_road");
  const dirtNodes = candidates.filter((n) =>
    dirtEdges.some((e) => e.from === n.id || e.to === n.id),
  );
  const withDirt = (
    mode: "p2p" | "circuit",
    prefix: string,
    start: RoadGraphNode,
    cps: readonly RoadGraphNode[],
    swapIndex: number,
  ) => {
    const plain = buildCourse(mode, prefix, start, cps);
    // An all-tarmac map (e.g. a traced editor map) has no dirt to visit: the
    // dirt-road rule is a variety preference, not a reason to fail the compile.
    if (plain.usesDirt || dirtNodes.length === 0) return plain;
    const anchor = cps[swapIndex] as RoadGraphNode;
    const sorted = [...dirtNodes].sort(
      (a, b) =>
        Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z),
    );
    for (const d of sorted) {
      try {
        const swapped = cps.map((n, i) => (i === swapIndex ? d : n));
        const course = buildCourse(mode, prefix, start, swapped);
        if (course.usesDirt) return course;
      } catch {
        // unreachable candidate; try the next one
      }
    }
    throw new Error(`no dirt-road checkpoint makes the ${mode} course use a dirt road`);
  };
  const p2p = withDirt("p2p", "p2p", west, p2pNodes, Math.floor(p2pNodes.length / 2));
  const circuit = withDirt("circuit", "circuit", circuitStart, circuitNodes, 1);

  const routes = {
    schemaVersion: 1,
    areaId: AREA,
    courses: [
      {
        id: `${AREA}-valley-run`,
        name: "Valley Run",
        mode: "p2p",
        checkpoints: p2p.checkpoints,
        start: { nodeId: p2p.start.id, headingRad: p2p.headingRad },
        authoring: "West-to-east run along the main road through the village.",
      },
      {
        id: `${AREA}-village-loop`,
        name: "Village Loop",
        mode: "circuit",
        laps: CIRCUIT_LAPS,
        checkpoints: circuit.checkpoints,
        start: { nodeId: circuit.start.id, headingRad: circuit.headingRad },
        authoring: "Loop through five points around the village.",
      },
    ],
  };
  const routesText = `${JSON.stringify(routes, null, 2)}\n`;
  const parsed = parseCourseData(routesText, `${AREA}.routes.json`, graph);
  const failures = validateCourseRoutes(parsed, graph);
  if (failures.length > 0) throw new Error(`route validation failed:\n${failures.join("\n")}`);

  const splitsFor = (
    prefix: string,
    legs: readonly number[],
    closure: number,
    laps: number,
    count: number,
  ) => {
    const lapLen = legs.reduce((a, b) => a + b, 0) + closure;
    const splits: unknown[] = [];
    let previous = 0;
    let hitOrder = 0;
    for (let lap = 1; lap <= laps; lap++) {
      let sum = (lap - 1) * lapLen;
      for (let i = 0; i < count; i++) {
        sum += legs[i] as number;
        const cumulative = Math.max(previous + 1, Math.ceil(sum / AVERAGE_SPEED_MPS));
        splits.push({
          checkpointId: `${prefix}-${pad(i + 1)}`,
          lap,
          authoredIndex: i,
          hitOrder: hitOrder++,
          cumulativeTimeSec: cumulative,
        });
        previous = cumulative;
      }
    }
    return { splits, total: previous };
  };
  const p2pSplits = splitsFor("p2p", p2p.legs, 0, 1, p2p.checkpoints.length);
  const circuitSplits = splitsFor(
    "circuit",
    circuit.legs,
    circuit.closure,
    CIRCUIT_LAPS,
    circuit.checkpoints.length,
  );
  const medals = {
    kind: "heat-street.medal-reference",
    version: 1,
    areaId: AREA,
    contractVersion: 1,
    handlingContentVersion: HANDLING_CONTENT_VERSION,
    courses: [
      {
        courseId: `${AREA}-valley-run`,
        mode: "p2p",
        laps: 1,
        totalTimeSec: p2pSplits.total,
        splits: p2pSplits.splits,
      },
      {
        courseId: `${AREA}-village-loop`,
        mode: "circuit",
        laps: CIRCUIT_LAPS,
        totalTimeSec: circuitSplits.total,
        splits: circuitSplits.splits,
      },
    ],
  };
  await writeFile(path.join(MAPS_DIR, `${AREA}.routes.json`), routesText, "utf8");
  await writeFile(
    path.join(MAPS_DIR, `${AREA}.medals.json`),
    `${JSON.stringify(medals, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `author-newton-routes: OK p2p=${p2p.checkpoints.length} cps/${p2pSplits.total}s, circuit=${circuit.checkpoints.length} cps/${circuitSplits.total}s x${CIRCUIT_LAPS}`,
  );
}

run().catch((err: unknown) => {
  console.error(`author-newton-routes: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
