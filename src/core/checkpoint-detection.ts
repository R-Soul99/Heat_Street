import type { CourseCheckpoint, LocalPoint } from "./course";

export interface CheckpointDetectionResult {
  readonly hit: boolean;
  readonly inside: boolean;
}

function isFinitePoint(point: readonly number[]): point is LocalPoint {
  return point.length === 3 && point.every((component) => Number.isFinite(component));
}

/** Returns whether a post-step chassis point is inside the checkpoint's full sensor volume. */
export function containsCheckpoint(
  position: readonly number[],
  checkpoint: CourseCheckpoint,
): boolean {
  if (!isFinitePoint(position)) return false;
  const { position: center, sensor } = checkpoint;
  if (![...center, sensor.widthM, sensor.depthM, sensor.heightM].every(Number.isFinite)) {
    return false;
  }
  if (sensor.widthM <= 0 || sensor.depthM <= 0 || sensor.heightM <= 0) return false;
  return (
    Math.abs(position[0] - center[0]) <= sensor.widthM / 2 &&
    Math.abs(position[1] - center[1]) <= sensor.heightM / 2 &&
    Math.abs(position[2] - center[2]) <= sensor.depthM / 2
  );
}

/** Converts sustained sensor occupancy into one fixed-tick hit event. */
export function detectCheckpointHit(
  position: readonly number[],
  checkpoint: CourseCheckpoint,
  wasInside: boolean,
): CheckpointDetectionResult {
  const inside = containsCheckpoint(position, checkpoint);
  return { hit: inside && !wasInside, inside };
}