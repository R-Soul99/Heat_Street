/**
 * Flat test areas (the `feel-test` proving ground): the off-road ground is
 * dead-flat tarmac instead of grass-covered relief, so leaving a painted road
 * line never changes the grip a handling test is measuring. Read by BOTH
 * `tools/map-compiler/cli.ts` (flat heightfield, ground colour) and
 * `src/physics/map-scene.ts` (ground / shoulder / crest surface), so the
 * baked mesh and the runtime colliders agree.
 *
 * Layering: pure data. No three, no Rapier, no DOM, no filesystem.
 */
import type { SurfaceType } from "./surface-types.ts";

const FLAT_TEST_AREAS: readonly string[] = ["feel-test"];

export function isFlatTestArea(areaId: string): boolean {
  return FLAT_TEST_AREAS.includes(areaId);
}

/** The surface of the off-road ground, shoulders and crest domes. */
export function groundSurfaceForArea(areaId: string): SurfaceType {
  return isFlatTestArea(areaId) ? "tarmac" : "grass";
}

/** Render colour of the ground in a flat test area: lighter than the road tarmac so roads read as drawn lines. */
export const FLAT_TEST_GROUND_HEX = 0x70747a;
