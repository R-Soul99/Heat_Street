/**
 * Terrain physics scene: ONE heightfield collider for the whole area (flagged
 * FIX_INTERNAL_EDGES, ROAD_FRICTION), plus building cuboids and authored crest
 * trimeshes. Returns the same `MapScene` contract `createMapScene` does, so the
 * composition root needs no special case.
 *
 * A single terrain collider has a single handle, so per-wheel surface comes
 * from the paint map at the wheel's contact point (`SurfaceContext.paint`),
 * not from the collider handle.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three`, touch the DOM, fetch, or read a wall clock.
 */
import * as RAPIER from "@dimforge/rapier3d";
import { type AuthoredCrest, buildCrestGeometry } from "../core/crest-geometry";
import { sampleHeightfieldBilinear } from "../core/heightfield-sample";
import type { InputFrame } from "../core/input-tape";
import type { MapCollisionBuilding } from "../core/map-collision";
import type { RoadGraph } from "../core/road-graph";
import type { SurfaceProfiles } from "../core/surface-tuning";
import type { SurfaceType } from "../core/surface-types";
import { type BermBox, buildEdgeBerm } from "../core/terrain-edge-berm";
import { sampleTerrainHeight, type TerrainGrid } from "../core/terrain-grid";
import type { PaintMap } from "../core/terrain-paint";
import type { VehicleTuning } from "../core/vehicle-tuning";
import {
  BUILDING_FRICTION,
  buildBuildingCollider,
  DEFAULT_SPAWN_ID,
  type MapScene,
  ROAD_FRICTION,
  SPAWN_CLEARANCE_M,
} from "./map-scene";
import {
  createPaintLookup,
  createSurfaceMap,
  type SurfaceMap,
  type SurfacePaintLookup,
} from "./surface";
import { createVehicle, type VehiclePose } from "./vehicle";

export interface TerrainSceneInput {
  readonly areaId: string;
  readonly grid: TerrainGrid;
  readonly paint: PaintMap;
  readonly graph: RoadGraph;
  readonly buildings: readonly MapCollisionBuilding[];
  readonly crests: readonly AuthoredCrest[];
  readonly groundSurface: SurfaceType;
  readonly spawnOverride?: { x: number; z: number; headingRad: number };
  /**
   * Optional second painted heightfield that must not overlap `grid` (the
   * 04.2 prototype gate course beside feel-test, debug `&gate` only). Absent =
   * scene unchanged.
   */
  readonly extraTerrain?: { readonly grid: TerrainGrid; readonly paint: PaintMap };
}

/** The MapScene contract plus the berm boxes the view builds its mesh from. */
export interface TerrainScene extends MapScene {
  readonly edgeBerm: readonly BermBox[];
}

/**
 * One fixed body at the grid centre (Y translation exactly 0: heights are
 * literal metres) carrying one heightfield collider. Translation/scale follow
 * `buildHeightfieldCollider` in map-scene.ts.
 */
export function buildTerrainCollider(
  world: RAPIER.World,
  grid: TerrainGrid,
  paint: PaintMap,
  groundSurface: SurfaceType,
  next?: SurfacePaintLookup,
): { collider: RAPIER.Collider; paint: SurfacePaintLookup } {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      grid.originX + grid.scaleX / 2,
      0,
      grid.originZ + grid.scaleZ / 2,
    ),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.heightfield(
      grid.rows,
      grid.cols,
      grid.heights,
      { x: grid.scaleX, y: 1, z: grid.scaleZ },
      RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
    ).setFriction(ROAD_FRICTION),
    body,
  );
  return { collider, paint: createPaintLookup(collider.handle, paint, groundSurface, next) };
}

function resolveTerrainSpawn(input: TerrainSceneInput): VehiclePose {
  let x: number;
  let z: number;
  let headingRad: number;
  if (input.spawnOverride !== undefined) {
    ({ x, z, headingRad } = input.spawnOverride);
  } else {
    const spawn = input.graph.spawns?.find((s) => s.id === DEFAULT_SPAWN_ID);
    if (spawn === undefined) {
      throw new Error(
        `createTerrainScene: area "${input.areaId}" has no "${DEFAULT_SPAWN_ID}" spawn -- cannot place the vehicle`,
      );
    }
    const node = input.graph.nodes.find((n) => n.id === spawn.nodeId);
    if (node === undefined) {
      throw new Error(
        `createTerrainScene: area "${input.areaId}" spawn "${DEFAULT_SPAWN_ID}" references unknown node id ${spawn.nodeId}`,
      );
    }
    x = node.x;
    z = node.z;
    headingRad = spawn.headingRad;
  }
  return { x, y: sampleTerrainHeight(input.grid, x, z) + SPAWN_CLEARANCE_M, z, headingRad };
}

export function createTerrainScene(
  world: RAPIER.World,
  input: TerrainSceneInput,
  tuning: VehicleTuning,
  profiles: SurfaceProfiles,
  frontDriveShare = 0,
): TerrainScene {
  const surfaceMap = createSurfaceMap();
  const terrain = buildTerrainCollider(world, input.grid, input.paint, input.groundSurface);
  surfaceMap.register(terrain.collider.handle, input.groundSurface);
  // Optional second painted heightfield (gate course): its lookup chains to
  // the main one, so wheels on either collider read the right paint map.
  const extra =
    input.extraTerrain === undefined
      ? undefined
      : buildTerrainCollider(
          world,
          input.extraTerrain.grid,
          input.extraTerrain.paint,
          input.groundSurface,
          terrain.paint,
        );
  if (extra !== undefined) surfaceMap.register(extra.collider.handle, input.groundSurface);
  const paintLookup = extra?.paint ?? terrain.paint;

  // Crests keep the bilinear rim sampler so feel-test crests are identical
  // (D-07); on a flat grid bilinear and triangle sampling coincide.
  if (input.crests.length > 0) {
    const crestBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const crests = buildCrestGeometry(input.crests, (x, z) =>
      sampleHeightfieldBilinear(input.grid, x, z),
    );
    for (const crest of crests) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          crest.positions,
          crest.indices,
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        ).setFriction(ROAD_FRICTION),
        crestBody,
      );
      surfaceMap.register(collider.handle, input.groundSurface);
    }
  }

  for (const building of input.buildings) {
    buildBuildingCollider(world, building);
  }

  // Edge berm (04.3 D-06..D-10): thick fixed cuboids around the grid bounds on
  // ONE body. A plain solid like a building: no respawn, no teleport.
  const edgeBerm = buildEdgeBerm(input.grid);
  const bermBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const box of edgeBerm) {
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
        .setTranslation(box.cx, box.cy, box.cz)
        .setFriction(BUILDING_FRICTION)
        .setRestitution(0),
      bermBody,
    );
    surfaceMap.register(collider.handle, input.groundSurface);
  }

  const spawn = resolveTerrainSpawn(input);
  const vehicle = createVehicle(world, tuning, spawn, frontDriveShare);
  const defaultSpawnPose: VehiclePose = spawn;
  vehicle.resetPose(defaultSpawnPose);
  let currentTuning = tuning;

  const surfaceContext: { map: SurfaceMap; profiles: SurfaceProfiles; paint: SurfacePaintLookup } =
    { map: surfaceMap, profiles, paint: paintLookup };

  const bodies: readonly RAPIER.RigidBody[] = [vehicle.body];

  return {
    bodies,
    vehicle,
    defaultSpawnPose,
    surfaces: surfaceContext,
    edgeBerm,

    preTick(_tick: number): void {
      // No-op, as MapScene.preTick.
    },

    applyInput(frame: InputFrame): void {
      vehicle.tick(frame, currentTuning, surfaceContext);
    },

    setTuning(t: VehicleTuning): void {
      currentTuning = t;
      vehicle.applyTuning(t);
    },

    setSurfaceProfiles(p: SurfaceProfiles): void {
      surfaceContext.profiles = p;
    },

    resetVehicle(pose: VehiclePose): void {
      vehicle.resetPose(pose);
    },

    dispose(): void {
      vehicle.dispose();
    },
  };
}
