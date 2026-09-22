/**
 * Single, verified reset-pose helper shared by the player's respawn
 * (`src/gameplay/race-coordinator.ts`) and AI reset (plan 07-04, D-13: "the
 * same rule as the player's respawn").
 *
 * DEVIATION (Rule 1 — bug found and fixed, plan 07-04 Task 1): the function
 * this replaces (`race-coordinator.ts`'s former `poseForCheckpoint`) computed
 * `headingRad` as a BEARING (`Math.atan2(to.z - from.z, to.x - from.x)`) but
 * handed it to `Vehicle.resetPose`, which treats `headingRad` as a YAW
 * (`forward = (-sin h, -cos h)`, see `src/core/heading.ts`'s own documented
 * BEARING-vs-YAW distinction). These are different formulas, not the same
 * value under a different name — measured directly against both real
 * Juliette courses (`tests/checkpoint-pose.test.ts`'s own pre-fix
 * measurement): the old formula produced a forward vector that failed a
 * cos(30deg) down-course alignment check at EVERY SINGLE checkpoint (12 of
 * 12 across `juliette-backroads-run` and `juliette-three-lap-loop`), with
 * dot products ranging from -0.94 to +0.66 — never reliably facing
 * down-course. `checkpointResetPose` below uses `yawFromTravelDirection`
 * (the correct, round-trip-verified inverse of `resetPose`'s own forward
 * convention) instead, closing this bug for both the player's respawn and
 * every AI reset.
 *
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/`.
 */
import type { Course, CourseCheckpoint } from "./course";
import { yawFromTravelDirection } from "./heading";
import { findRoadPath, type NavigationGraph } from "./navigation";

/** Minimum distance along the first path edge's points to sample the road tangent from, metres. */
const ROAD_TANGENT_SAMPLE_M = 10;

/**
 * Road-tangent heading (YAW convention) at `fromNodeId`, walking toward
 * `toNodeId`: finds the first edge of `findRoadPath(fromNodeId, toNodeId)`,
 * orders its `points` in travel order (reversing when `edge.from !==
 * fromNodeId` — the edge was authored the opposite direction), and takes the
 * first point at least `ROAD_TANGENT_SAMPLE_M` of XZ distance from the node
 * as the tangent target. Returns `null` when no route exists or the sampled
 * direction is degenerate (a near-zero-length edge), so the caller can fall
 * back to `course.start.headingRad`.
 */
function roadTangentHeadingRad(
  fromNodeId: number,
  toNodeId: number,
  navigation: NavigationGraph,
): number | null {
  const path = findRoadPath(navigation, fromNodeId, toNodeId);
  if (path.length < 2) return null;
  const link = navigation.graph.getLink(path[0], path[1]);
  if (link === undefined) return null;
  const edge = navigation.edgesById.get(link.data.edgeId);
  if (edge === undefined) return null;

  const orderedPoints = edge.from === path[0] ? edge.points : [...edge.points].reverse();
  const node = orderedPoints[0];
  let target = orderedPoints[orderedPoints.length - 1];
  for (const point of orderedPoints) {
    const dx = point[0] - node[0];
    const dz = point[2] - node[2];
    if (Math.hypot(dx, dz) >= ROAD_TANGENT_SAMPLE_M) {
      target = point;
      break;
    }
  }

  const dx = target[0] - node[0];
  const dz = target[2] - node[2];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  return yawFromTravelDirection(dx / length, dz / length);
}

/**
 * The reset pose for `checkpoint`: position unchanged from the former
 * `poseForCheckpoint` (`checkpoint.position` x/z, y raised 0.6m for chassis
 * clearance), heading corrected to a verified, round-trip-consistent YAW
 * that faces down-course toward the NEXT checkpoint's road tangent (wrapping
 * to `course.checkpoints[0]` after the last one, matching the closed-loop
 * circuit convention `src/core/racing-line.ts` already uses). Falls back to
 * `course.start.headingRad` when no route to the next checkpoint exists or
 * the sampled tangent is degenerate.
 */
export function checkpointResetPose(
  checkpoint: CourseCheckpoint,
  course: Course,
  navigation: NavigationGraph,
): { x: number; y: number; z: number; headingRad: number } {
  const checkpointIndex = course.checkpoints.findIndex((item) => item.id === checkpoint.id);
  const next = course.checkpoints[(checkpointIndex + 1) % course.checkpoints.length];
  const headingRad =
    next === undefined
      ? course.start.headingRad
      : (roadTangentHeadingRad(checkpoint.nodeId, next.nodeId, navigation) ??
        course.start.headingRad);
  return {
    x: checkpoint.position[0],
    y: checkpoint.position[1] + 0.6,
    z: checkpoint.position[2],
    headingRad,
  };
}
