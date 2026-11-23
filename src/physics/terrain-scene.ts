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
import { buildingBoxes, featureColliders, lineBoxQuat } from "../core/scenery-geometry";
import type { SurfaceProfiles } from "../core/surface-tuning";
import type { SurfaceType } from "../core/surface-types";
import { type BermBox, buildEdgeBerm } from "../core/terrain-edge-berm";
import type { TerrainBuilding, TerrainFeature } from "../core/terrain-format";
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
  yRotationQuat,
} from "./map-scene";
import {
  createPaintLookup,
  createSurfaceMap,
  type SurfaceMap,
  type SurfacePaintLookup,
} from "./surface";
import { type CreateVehicleOptions, createVehicle, type VehiclePose } from "./vehicle";
import {
  createWheelRayPatch,
  type WheelRayPatch,
  type WheelRayPatchTarget,
} from "./wheel-ray-patch";

export interface TerrainSceneInput {
  readonly areaId: string;
  readonly grid: TerrainGrid;
  readonly paint: PaintMap;
  readonly graph: RoadGraph;
  readonly buildings: readonly (MapCollisionBuilding | TerrainBuilding)[];
  /** 07.1.3 D-10: scenery (trees, bushes, hedges, fences). Absent = none. */
  readonly features?: readonly TerrainFeature[];
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
  /**
   * Scenery colliders that pursuit line of sight passes through (tree trunks, fences). Add these to
   * the ignore set given to `lineOfSightClear`; hedges and buildings stay blocking (D-10).
   */
  readonly sightTransparentHandles: ReadonlySet<number>;
  /**
   * A fresh wheel-ray patch over this scene's terrain grids (see
   * wheel-ray-patch.ts). The player's vehicle already carries one; AI cars
   * built into the same world get theirs by passing this to `createAiFleet`.
   */
  createWheelRayPatch(): WheelRayPatch;
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
      // 07.1.3 D-04: no spawn and no start point -> grid centre, heading 0 (never throw).
      x = input.grid.originX + input.grid.scaleX / 2;
      z = input.grid.originZ + input.grid.scaleZ / 2;
      headingRad = 0;
    } else {
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
  }
  return { x, y: sampleTerrainHeight(input.grid, x, z) + SPAWN_CLEARANCE_M, z, headingRad };
}

export function createTerrainScene(
  world: RAPIER.World,
  input: TerrainSceneInput,
  tuning: VehicleTuning,
  profiles: SurfaceProfiles,
  frontDriveShare = 0,
  vehicleOptions?: CreateVehicleOptions,
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

  // 07.1.3 D-10: scenery and styled buildings share ONE fixed body. Style-less buildings keep
  // the existing per-building path.
  const sightTransparentHandles = new Set<number>();
  let sceneryBodyRef: RAPIER.RigidBody | undefined;
  const sceneryBody = (): RAPIER.RigidBody => {
    sceneryBodyRef ??= world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    return sceneryBodyRef;
  };
  const registerScenery = (collider: RAPIER.Collider): void => {
    // A wheel standing on top of a piece reads ground (research Pitfall 6).
    surfaceMap.register(collider.handle, input.groundSurface);
  };
  for (const building of input.buildings) {
    if ("style" in building && building.style !== undefined) continue;
    buildBuildingCollider(world, building);
  }
  const styled = input.buildings.filter(
    (b): b is TerrainBuilding => "style" in b && b.style !== undefined,
  );
  for (const boxes of Object.values(buildingBoxes(styled, { includeStyleless: false }))) {
    for (const b of boxes) {
      registerScenery(
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
            .setTranslation(b.x, b.y, b.z)
            .setRotation(yRotationQuat(b.rotationY))
            .setFriction(BUILDING_FRICTION)
            .setRestitution(0),
          sceneryBody(),
        ),
      );
    }
  }
  for (const spec of featureColliders(input.features ?? [], (x, z) =>
    sampleTerrainHeight(input.grid, x, z),
  )) {
    const desc =
      spec.shape === "cylinder"
        ? RAPIER.ColliderDesc.cylinder(spec.halfHeight, spec.radius)
        : RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, spec.hz).setRotation(
            lineBoxQuat(spec.rotationY, spec.pitch),
          );
    const collider = world.createCollider(
      desc.setTranslation(spec.x, spec.y, spec.z).setFriction(BUILDING_FRICTION).setRestitution(0),
      sceneryBody(),
    );
    registerScenery(collider);
    if (!spec.blocksSight) sightTransparentHandles.add(collider.handle);
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

  const patchTargets: WheelRayPatchTarget[] = [
    { grid: input.grid, paint: terrain.paint, map: surfaceMap, groundSurface: input.groundSurface },
  ];
  if (input.extraTerrain !== undefined && extra !== undefined) {
    patchTargets.push({
      grid: input.extraTerrain.grid,
      paint: extra.paint,
      map: surfaceMap,
      groundSurface: input.groundSurface,
    });
  }

  const spawn = resolveTerrainSpawn(input);
  const vehicle = createVehicle(world, tuning, spawn, frontDriveShare, vehicleOptions);
  vehicle.attachWheelRayPatch(createWheelRayPatch(world, patchTargets));
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
    sightTransparentHandles,

    createWheelRayPatch(): WheelRayPatch {
      return createWheelRayPatch(world, patchTargets);
    },

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
