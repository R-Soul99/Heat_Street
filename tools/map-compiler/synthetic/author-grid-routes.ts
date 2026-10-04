/**
 * Authors `public/maps/grid-test.routes.json` and `grid-test.medals.json` from
 * the compiled `grid-test.map.json`: one p2p course ("Stagger Run") and one
 * 3-lap circuit ("Block Loop"). Checkpoints are placed by the layout's own
 * (street index, x) coordinates, snapped to the nearest graph node, and never
 * on the central motorway (that open strip is for free handling tests; it
 * would also exceed the 20 m checkpoint sensor width).
 *
 * Self-checks routes via `parseCourseData` + `validateCourseRoutes` and exits
 * non-zero on failure. The medal reference is validated in
 * `tests/grid-test-routes.test.ts` (medal-reference.ts uses extensionless
 * imports that Node type stripping cannot load).
 *
 * Run: `node tools/map-compiler/synthetic/author-grid-routes.ts`
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
import { buildGridLayout, GRID_TEST_LAYOUT_PARAMS as P } from "./grid-layout.ts";

const MAPS_DIR = path.join(import.meta.dirname, "..", "..", "..", "public", "maps");
const AVERAGE_SPEED_MPS = 14;
const MAX_CHECKPOINT_EDGE_WIDTH_M = 18;
const HANDLING_CONTENT_VERSION = "260920-sm2";

/** A target in layout terms: x along horizontal street index `street`. */
type Target = readonly [x: number, street: number];

const P2P_START: Target = [0, 3];
const P2P_CHECKPOINTS: readonly Target[] = [
  [0, 1],
  [200, 1],
  [300, 3],
  [450, 2],
  [570, 3],
  [520, 5],
  [650, 7],
];
const CIRCUIT_START: Target = [0, 6];
const CIRCUIT_CHECKPOINTS: readonly Target[] = [
  [0, 2],
  [330, 1],
  [420, 3],
  [400, 5],
  [300, 7],
];

const layout = buildGridLayout(P);
const motorwayZ = layout.horizontals[P.motorwayStreetIndex].z;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function run(): Promise<void> {
  const mapPath = path.join(MAPS_DIR, "grid-test.map.json");
  const graph: RoadGraph = parseRoadGraph(await readFile(mapPath, "utf8"), mapPath);
  const navigation = buildNavigationGraph(graph);
  const dx = P.widthM / 2;
  const dz = layout.depthM / 2;

  const pickNode = (target: Target): RoadGraphNode => {
    const street = layout.horizontals[target[1]];
    if (street.index === P.motorwayStreetIndex) {
      throw new Error("targets must not be on the motorway");
    }
    const wx = target[0] - dx;
    const wz = street.z - dz;
    let best: RoadGraphNode | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    for (const node of graph.nodes) {
      const d = Math.hypot(node.x - wx, node.z - wz);
      if (d >= bestD) continue;
      if (Math.abs(node.z - (motorwayZ - dz)) < 1) continue;
      if (
        DEFECT_COORDINATES.some(([x, z]) => Math.hypot(node.x - x, node.z - z) < DEFECT_CLEARANCE_M)
      )
        continue;
      best = node;
      bestD = d;
    }
    if (best === undefined) throw new Error(`no node for target ${JSON.stringify(target)}`);
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
    areaId: "grid-test",
    courses: [
      {
        id: "grid-test-stagger-run",
        name: "Stagger Run",
        mode: "p2p",
        checkpoints: p2p.checkpoints,
        start: { nodeId: p2p.startNode.id, headingRad: p2p.headingRad },
        authoring:
          "Zig-zags across block rows through staggered T-junctions and doglegs, crosses the central motorway, starts on the gravel west alley.",
      },
      {
        id: "grid-test-block-loop",
        name: "Block Loop",
        mode: "circuit",
        laps: 3,
        checkpoints: circuit.checkpoints,
        start: { nodeId: circuit.startNode.id, headingRad: circuit.headingRad },
        authoring:
          "Three-lap loop that runs the gravel west alley, crosses the motorway and weaves through the staggered grid.",
      },
    ],
  };
  const routesText = `${JSON.stringify(routes, null, 2)}\n`;
  const parsed = parseCourseData(routesText, "grid-test.routes.json", graph);
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
    areaId: "grid-test",
    contractVersion: 1,
    handlingContentVersion: HANDLING_CONTENT_VERSION,
    courses: [
      {
        courseId: "grid-test-stagger-run",
        mode: "p2p",
        laps: 1,
        totalTimeSec: p2pSplits.total,
        splits: p2pSplits.splits,
      },
      {
        courseId: "grid-test-block-loop",
        mode: "circuit",
        laps: 3,
        totalTimeSec: circuitSplits.total,
        splits: circuitSplits.splits,
      },
    ],
  };

  await writeFile(path.join(MAPS_DIR, "grid-test.routes.json"), routesText, "utf8");
  await writeFile(
    path.join(MAPS_DIR, "grid-test.medals.json"),
    `${JSON.stringify(medals, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `author-grid-routes: OK p2p=${p2pSplits.total}s circuit=${circuitSplits.total}s (3 laps), routes validated`,
  );
}

run().catch((err: unknown) => {
  console.error(`author-grid-routes: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
