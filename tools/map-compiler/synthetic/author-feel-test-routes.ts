/**
 * Authors `public/maps/feel-test.routes.json` and `feel-test.medals.json` from
 * the compiled `feel-test.map.json`. The proving ground exists for free
 * handling tests (see `proving-ground.ts`); these two courses just satisfy the
 * game's course contract by running the perimeter ring road (one side of which
 * is gravel, as the route validator requires).
 *
 * Run: `node tools/map-compiler/synthetic/author-feel-test-routes.ts`
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCourseData } from "../../../src/core/course.ts";
import {
  buildNavigationGraph,
  DEFECT_CLEARANCE_M,
  DEFECT_COORDINATES,
  findRoadPath,
  validateCourseRoutes,
} from "../../../src/core/navigation.ts";
import {
  parseRoadGraph,
  type RoadGraph,
  type RoadGraphNode,
} from "../../../src/core/road-graph.ts";
import { DEPTH_M, WIDTH_M } from "./proving-ground.ts";

const MAPS_DIR = path.join(import.meta.dirname, "..", "..", "..", "public", "maps");
const AVERAGE_SPEED_MPS = 14;
const MAX_CHECKPOINT_EDGE_WIDTH_M = 18;
const HANDLING_CONTENT_VERSION = "260920-sm2";

/** A target in local layout coordinates (x east, z south). */
type Target = readonly [x: number, z: number];

// Ring road joints (see proving-ground.ts): clockwise from the west side.
const P2P_START: Target = [30, 640];
const P2P_CHECKPOINTS: readonly Target[] = [
  [30, 330],
  [30, 130],
  [575, 30],
  [1370, 100],
  [1300, 810],
  [575, 810],
];
const CIRCUIT_START: Target = [575, 30];
const CIRCUIT_CHECKPOINTS: readonly Target[] = [
  [1370, 100],
  [1300, 810],
  [575, 810],
  [30, 640],
  [30, 330],
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function run(): Promise<void> {
  const mapPath = path.join(MAPS_DIR, "feel-test.map.json");
  const graph: RoadGraph = parseRoadGraph(await readFile(mapPath, "utf8"), mapPath);
  const navigation = buildNavigationGraph(graph);
  const dx = WIDTH_M / 2;
  const dz = DEPTH_M / 2;

  const pickNode = (target: Target): RoadGraphNode => {
    const wx = target[0] - dx;
    const wz = target[1] - dz;
    let best: RoadGraphNode | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const node of graph.nodes) {
      const d = Math.hypot(node.x - wx, node.z - wz);
      if (d >= bestD) continue;
      if (
        DEFECT_COORDINATES.some(([x, z]) => Math.hypot(node.x - x, node.z - z) < DEFECT_CLEARANCE_M)
      )
        continue;
      best = node;
      bestD = d;
    }
    if (best === undefined || bestD > 5) {
      throw new Error(`no node within 5 m of target ${JSON.stringify(target)}`);
    }
    return best;
  };

  const pathLength = (from: number, to: number): number => {
    const nodes = findRoadPath(navigation, from, to);
    if (nodes.length === 0) throw new Error(`no path ${from} -> ${to}`);
    let total = 0;
    for (let i = 0; i + 1 < nodes.length; i++) {
      total += navigation.graph.getLink(nodes[i], nodes[i + 1])?.data.weight ?? 0;
    }
    return total;
  };

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
    startTarget: Target,
    cpTargets: readonly Target[],
  ) => {
    const startNode = pickNode(startTarget);
    const cpNodes = cpTargets.map(pickNode);
    const sequence = [startNode.id, ...cpNodes.map((n) => n.id)];
    const legs: number[] = [];
    const routeNodes: number[] = [];
    for (let i = 0; i + 1 < sequence.length; i++) {
      legs.push(pathLength(sequence[i], sequence[i + 1]));
      routeNodes.push(...findRoadPath(navigation, sequence[i], sequence[i + 1]));
    }
    const closure = mode === "circuit" ? pathLength(sequence[sequence.length - 1], sequence[0]) : 0;
    const firstPath = findRoadPath(navigation, sequence[0], sequence[1]);
    const next = graph.nodes[firstPath[1]];
    const headingRad = Math.atan2(next.x - startNode.x, -(next.z - startNode.z));
    const checkpoints = cpNodes.map((node, i) =>
      checkpointFor(`${prefix}-${pad(i + 1)}`, node, routeNodes),
    );
    return { startNode, checkpoints, legs, closure, headingRad };
  };

  const p2p = buildCourse("p2p", "p2p", P2P_START, P2P_CHECKPOINTS);
  const circuit = buildCourse("circuit", "circuit", CIRCUIT_START, CIRCUIT_CHECKPOINTS);

  const routes = {
    schemaVersion: 1,
    areaId: "feel-test",
    courses: [
      {
        id: "feel-test-ring-run",
        name: "Ring Run",
        mode: "p2p",
        checkpoints: p2p.checkpoints,
        start: { nodeId: p2p.startNode.id, headingRad: p2p.headingRad },
        authoring:
          "Runs the perimeter ring road of the proving ground, finishing along the gravel south side.",
      },
      {
        id: "feel-test-ring-loop",
        name: "Ring Loop",
        mode: "circuit",
        laps: 3,
        checkpoints: circuit.checkpoints,
        start: { nodeId: circuit.startNode.id, headingRad: circuit.headingRad },
        authoring: "Three laps of the proving ground ring road, including its gravel south side.",
      },
    ],
  };
  const routesText = `${JSON.stringify(routes, null, 2)}\n`;
  const parsed = parseCourseData(routesText, "feel-test.routes.json", graph);
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
      let acc = (lap - 1) * lapLen;
      for (let i = 0; i < count; i++) {
        acc += legs[i];
        const cumulative = Math.max(previous + 1, Math.ceil(acc / AVERAGE_SPEED_MPS));
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
  const p2pSplits = splitsFor("p2p", p2p.legs, 0, 1, P2P_CHECKPOINTS.length);
  const circuitSplits = splitsFor(
    "circuit",
    circuit.legs,
    circuit.closure,
    3,
    CIRCUIT_CHECKPOINTS.length,
  );
  const medals = {
    kind: "heat-street.medal-reference",
    version: 1,
    areaId: "feel-test",
    contractVersion: 1,
    handlingContentVersion: HANDLING_CONTENT_VERSION,
    courses: [
      {
        courseId: "feel-test-ring-run",
        mode: "p2p",
        laps: 1,
        totalTimeSec: p2pSplits.total,
        splits: p2pSplits.splits,
      },
      {
        courseId: "feel-test-ring-loop",
        mode: "circuit",
        laps: 3,
        totalTimeSec: circuitSplits.total,
        splits: circuitSplits.splits,
      },
    ],
  };

  await writeFile(path.join(MAPS_DIR, "feel-test.routes.json"), routesText, "utf8");
  await writeFile(
    path.join(MAPS_DIR, "feel-test.medals.json"),
    `${JSON.stringify(medals, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `author-feel-test-routes: OK p2p=${p2pSplits.total}s circuit=${circuitSplits.total}s (3 laps), routes validated`,
  );
}

run().catch((err: unknown) => {
  console.error(`author-feel-test-routes: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
