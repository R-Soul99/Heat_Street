/**
 * Recolored AI car mesh sets, added directly into the EXISTING player scene
 * (plan 07-02, D-02/D-14). Never builds a `THREE.Scene`, ground or grid of
 * its own — RESEARCH.md Pitfall 6 / Anti-Pattern: calling `createVehicleView`
 * a 4th time per AI car would build 3 more orphaned scenes. This module
 * exists only because `buildCarMeshes` (factored out of
 * `src/render/vehicle-view.ts` by this same plan) needs a caller that adds
 * its result into a scene it does NOT own, one call per AI car, instead of
 * the one call `createVehicleView` itself makes for the player.
 *
 * Layering: `src/render/` reads simulation state and never writes it — this
 * file only reads a Rapier vehicle controller's wheel getters (via
 * `buildCarMeshes.updateWheels`) and writes meshes, the same contract
 * `vehicle-view.ts` already has.
 */
import type * as RAPIER from "@dimforge/rapier3d";
import type * as THREE from "three";
import { buildCarMeshes, type CarMeshes } from "./vehicle-view";

/**
 * `chassisMeshes[i]` <-> fleet car `i` <-> `colors[i]` (AI_PAINTS index),
 * mirroring `VehicleView.meshes`'s own single-entry "chassis carries its
 * wheels as children" shape, generalized to N cars — the same T-01-16
 * dense-index contract every other wheel/mesh array in this codebase
 * documents.
 */
export interface AiVehicleViews {
  readonly chassisMeshes: readonly THREE.Object3D[];
  /** Per-frame wheel rig for car `carIndex`. Reads that car's own controller, writes only that car's meshes. */
  updateWheels(carIndex: number, vc: RAPIER.DynamicRayCastVehicleController): void;
  /** Dispose every car's own geometry and materials. */
  dispose(): void;
}

/**
 * Builds `colors.length` AI car mesh sets (one `buildCarMeshes` call each,
 * one distinct paint each) and adds each chassis directly into `scene` — the
 * player's own, already-live `view.scene`, never a new one.
 */
export function createAiVehicleViews(
  scene: THREE.Scene,
  wheelRadius: number,
  halfTrack: number,
  halfWheelbase: number,
  chassisHalfExtents: { x: number; y: number; z: number },
  colors: readonly number[],
): AiVehicleViews {
  const cars: CarMeshes[] = colors.map((color) =>
    buildCarMeshes(wheelRadius, halfTrack, halfWheelbase, chassisHalfExtents, color),
  );
  for (const car of cars) {
    scene.add(car.chassis);
  }

  return {
    chassisMeshes: cars.map((car) => car.chassis),

    updateWheels(carIndex: number, vc: RAPIER.DynamicRayCastVehicleController): void {
      cars[carIndex]?.updateWheels(vc);
    },

    dispose(): void {
      for (const car of cars) {
        car.dispose();
      }
    },
  };
}
