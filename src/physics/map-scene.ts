/**
 * `MapScene`: the compiled-area physics scene -- one Rapier trimesh collider
 * per road edge and per junction (registered into a `SurfaceMap` with its own
 * entry's surface), one cuboid collider per building from the collision
 * sidecar, and exactly one `Vehicle` spawned on the road (plan 04-08).
 *
 * Mirrors `src/physics/surface-scene.ts`'s structure closely -- it is the
 * shipped structural analog, and matching its shape (the `bodies`/`vehicle`/
 * `surfaces`/`preTick`/`applyInput`/`setTuning`/`setSurfaceProfiles`/
 * `dispose` contract) keeps `src/main.ts`'s wiring and `startLoop`'s contract
 * unchanged -- nothing downstream needs a `MapScene`-specific special case.
 *
 * SUPERSEDES `src/physics/surface-scene.ts` at the composition root ONLY.
 * `surface-scene.ts`, `vehicle-scene.ts` and `debug-scene.ts` (and their
 * render-side counterparts) all remain in place as regression fixtures that
 * tests import and must NOT be deleted -- exactly the note `surface-scene.ts`
 * itself already carries about its own Phase 1/2 predecessors.
 *
 * D-P24: `createMapScene` takes an ALREADY-PARSED `RoadGraph` and
 * `MapCollision` -- fetching and parsing the compiled map artifacts is the
 * composition root's job (`src/main.ts`), not this file's. `src/physics/`
 * must not touch the DOM or any network API (`tests/layering.test.ts` polices
 * this mechanically), and keeping the fetch in `src/main.ts` also keeps this
 * factory synchronous and directly testable in Node against real, already-
 * read fixture text.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
import * as RAPIER from "@dimforge/rapier3d";
import { sampleHeightfieldBilinear } from "../core/heightfield-sample";
import type { InputFrame } from "../core/input-tape";
import type {
  MapCollision,
  MapCollisionBuilding,
  MapCollisionHeightfield,
} from "../core/map-collision";
import {
  buildRoadGeometry,
  buildRoadShoulders,
  MIN_SHOULDER_WIDTH_M,
  SHOULDER_BUILDING_SAFETY_MARGIN_M,
  TARGET_SHOULDER_WIDTH_M,
} from "../core/road-geometry";
import type { RoadGraph } from "../core/road-graph";
import {
  buildingBoundingRadius,
  type ClearanceBuilding,
  resolvePointShoulderWidth,
} from "../core/shoulder-clearance";
import type { SurfaceProfiles } from "../core/surface-tuning";
import type { VehicleTuning } from "../core/vehicle-tuning";
import { createSurfaceMap, type SurfaceContext, type SurfaceMap } from "./surface";
import { createVehicle, type Vehicle } from "./vehicle";

/**
 * How far above the spawn node's authored `y` the chassis spawns, metres --
 * matches `surface-scene.ts`'s `SURFACE_SCENE_SPAWN` (0.6 m): the suspension
 * settles the rest of the way down on the first few ticks.
 */
const SPAWN_CLEARANCE_M = 0.6;

/**
 * Building-collider friction matches the chassis collider's own friction
 * (`src/physics/vehicle.ts`, 0.8) so a collision reads as a wall, not ice --
 * the same value and reasoning `surface-scene.ts`'s `buildBuilding` documents.
 */
const BUILDING_FRICTION = 0.8;

/**
 * Road-collider friction is a DELIBERATE constant, the SAME value on every
 * road collider regardless of surface type -- grip differences come from
 * per-wheel friction in `src/physics/vehicle.ts`, never from the ground
 * collider's own coefficient. A reader must not mistake this uniform value
 * for an oversight (verbatim reasoning from `surface-scene.ts`'s
 * `buildSurfaceZone`).
 */
const ROAD_FRICTION = 1.0;

/** The one spawn id `createMapScene` looks for (plan 04-08's `<action>`; other named spawns are reserved for future mode-specific starts, not this plan). */
const DEFAULT_SPAWN_ID = "default";

/**
 * Mirrors `SurfaceScene`'s contract (`src/physics/surface-scene.ts`) exactly,
 * so `src/main.ts` and `startLoop` need no structural change to consume a
 * `MapScene` in place of a `SurfaceScene`.
 */
export interface MapScene {
  /** Every body the render layer draws, in dense index order. Chassis only -- road and building bodies have no mesh counterpart of their own here (the compiled `.glb` is loaded and rendered separately), the same exclusion `SurfaceScene.bodies`/`VehicleScene.bodies` document (threat T-01-16). */
  readonly bodies: readonly RAPIER.RigidBody[];

  /** The one vehicle this scene drives. */
  readonly vehicle: Vehicle;

  /** The surface map + grip-profile table `applyInput` feeds into `vehicle.tick`. */
  readonly surfaces: SurfaceContext;

  /** No-op, matching `SurfaceScene.preTick`'s own carried-forward note: the per-wheel surface lookup lives inside `vehicle.tick` (plan 03-03), not this hook. */
  preTick(tick: number): void;

  /** Apply this tick's latched input to the vehicle, WITH surface context. */
  applyInput(frame: InputFrame): void;

  /** The tuning panel's write path (plan 02-09 precedent). Retunes the live vehicle. */
  setTuning(t: VehicleTuning): void;

  /** Swaps the `SurfaceProfiles` object `surfaces.profiles` holds, so the tuning panel can sweep grip live with no scene rebuild. */
  setSurfaceProfiles(p: SurfaceProfiles): void;

  /** Remove the vehicle controller from its world. */
  dispose(): void;
}

/** Builds a Y-axis rotation quaternion for angle `rad`, in the SAME convention `src/physics/vehicle.ts`'s `rotateVec` documents (local +X maps to world `(cos rad, 0, -sin rad)`). */
function yRotationQuat(rad: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(rad / 2), z: 0, w: Math.cos(rad / 2) };
}

/**
 * Builds the off-road ground (plan 04-10, D-P28/D-P29): one Rapier heightfield
 * collider on its own fixed body, registered in `surfaceMap` as `grass`. Built
 * BEFORE the road colliders (see `createMapScene` below) so the road
 * colliders are the later, winning contacts if the two ever coincide -- the
 * real guarantee against that is `heightfield.sinkM` (already baked into
 * every stored height by `tools/map-compiler/author/heightfield.ts`), this
 * ordering is belt-and-braces.
 *
 * Translation and scale follow `heightfield.ts`'s own documented Rapier
 * probe findings verbatim: the body's X/Z translation is the grid's own
 * centre (`originX + scaleX / 2`, `originZ + scaleZ / 2`), Y translation is
 * exactly `0` (heights are used literally, not internally centred by
 * Rapier), and `scale.y` stays `1.0` so a stored height IS its real-world
 * metre value. `heights` is converted to a `Float32Array` here, once, at
 * collider-construction time -- the parsed wire type is a plain `number[]`
 * (see `MapCollisionHeightfield`'s own doc comment in `src/core/map-collision.ts`
 * for why), and Rapier's constructor wants a typed array.
 */
function buildHeightfieldCollider(
  world: RAPIER.World,
  surfaceMap: SurfaceMap,
  heightfield: MapCollisionHeightfield,
): void {
  const centerX = heightfield.originX + heightfield.scaleX / 2;
  const centerZ = heightfield.originZ + heightfield.scaleZ / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, 0, centerZ),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.heightfield(
      heightfield.rows,
      heightfield.cols,
      new Float32Array(heightfield.heights),
      { x: heightfield.scaleX, y: 1, z: heightfield.scaleZ },
    ).setFriction(ROAD_FRICTION),
    body,
  );
  surfaceMap.register(collider.handle, "grass");
}

/**
 * Builds every road collider (one per edge, one per junction, per
 * `buildRoadGeometry`) onto a single shared fixed body at the world origin --
 * the geometry is already authored in world-space local ENU metres
 * (`src/core/road-geometry.ts`), so no per-collider translation is applied
 * anywhere. A single shared body (rather than one body per collider) is
 * chosen because none of these bodies ever move; Rapier's broadphase treats
 * many fixed colliders on one fixed body exactly as efficiently as many
 * single-collider bodies, and sharing one body avoids allocating 100 fixed
 * `RigidBody` WASM wrappers for a map this size.
 */
function buildRoadColliders(
  world: RAPIER.World,
  surfaceMap: SurfaceMap,
  graph: RoadGraph,
  heightfield: MapCollisionHeightfield | undefined,
  buildings: readonly MapCollisionBuilding[],
): void {
  const geometry = buildRoadGeometry(graph);
  const roadBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  for (const edge of geometry.edges) {
    const collider = world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        edge.positions,
        edge.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      ).setFriction(ROAD_FRICTION),
      roadBody,
    );
    surfaceMap.register(collider.handle, edge.surface);
  }

  for (const junction of geometry.junctions) {
    const collider = world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        junction.positions,
        junction.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      ).setFriction(ROAD_FRICTION),
      roadBody,
    );
    surfaceMap.register(collider.handle, junction.surface);
  }

  // Road-shoulder colliders (plan 04-11 grounding fix): the SAME ramp
  // geometry the compiled `.glb` ships, built here from the identical
  // `buildRoadShoulders` call over the identical heightfield grid, so the
  // physics floor under a car leaving the road always matches what it sees.
  // Skipped only when the compiled area shipped no heightfield block at all
  // (the same defensive optionality `buildHeightfieldCollider`'s own caller
  // above already applies).
  if (heightfield !== undefined) {
    const clearanceBuildings: ClearanceBuilding[] = buildings.map((b) => ({
      centerX: b.center.x,
      centerZ: b.center.z,
      radiusM: buildingBoundingRadius(b.halfExtents.x, b.halfExtents.z),
    }));
    const shoulders = buildRoadShoulders(
      graph,
      (x, z) => sampleHeightfieldBilinear(heightfield, x, z),
      (edge) => (x, z) =>
        resolvePointShoulderWidth(
          x,
          z,
          edge.widthM / 2,
          clearanceBuildings,
          TARGET_SHOULDER_WIDTH_M,
          MIN_SHOULDER_WIDTH_M,
          SHOULDER_BUILDING_SAFETY_MARGIN_M,
        ),
    );
    for (const shoulder of shoulders) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          shoulder.positions,
          shoulder.indices,
          RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        ).setFriction(ROAD_FRICTION),
        roadBody,
      );
      surfaceMap.register(collider.handle, shoulder.surface);
    }
  }
}

/**
 * Builds one building's static collider from the collision sidecar.
 * Deliberately NOT registered in the `SurfaceMap` (matching `surface-scene.ts`'s
 * `buildBuilding` and its documented T-03-16 acceptance): a wheel that
 * somehow ends up on a roof resolves to the map's own default surface.
 * `center`/`halfExtents`/`rotationY` are exactly `src/core/map-collision.ts`'s
 * documented contract -- `center` is the box's vertical MIDPOINT, so the body
 * translation IS `building.center` with no adjustment.
 */
function buildBuildingCollider(world: RAPIER.World, building: MapCollisionBuilding): void {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(building.center.x, building.center.y, building.center.z)
      .setRotation(yRotationQuat(building.rotationY)),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      building.halfExtents.x,
      building.halfExtents.y,
      building.halfExtents.z,
    ).setFriction(BUILDING_FRICTION),
    body,
  );
}

interface ResolvedSpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingRad: number;
}

/**
 * Resolves the graph's `"default"` spawn to a concrete position/heading, or
 * throws naming the area id -- a map with nowhere to start is a build defect
 * that must surface as a loud load failure, never as a car quietly placed at
 * the origin under the terrain (T-04-31).
 */
function resolveSpawn(graph: RoadGraph): ResolvedSpawn {
  const spawn = graph.spawns?.find((s) => s.id === DEFAULT_SPAWN_ID);
  if (spawn === undefined) {
    throw new Error(
      `createMapScene: area "${graph.areaId}" has no "${DEFAULT_SPAWN_ID}" spawn -- cannot place the vehicle`,
    );
  }
  // parseRoadGraph already validates every spawn.nodeId references a real
  // node id, so this lookup cannot fail against a graph that passed parsing
  // -- but a caller could hand-build a graph object bypassing that parser
  // (as this file's own tests do, deliberately, for the missing-spawn case),
  // so this is defended anyway with a named error rather than dereferencing
  // `undefined`.
  const node = graph.nodes.find((n) => n.id === spawn.nodeId);
  if (node === undefined) {
    throw new Error(
      `createMapScene: area "${graph.areaId}" spawn "${DEFAULT_SPAWN_ID}" references unknown node id ${spawn.nodeId}`,
    );
  }
  return { x: node.x, y: node.y + SPAWN_CLEARANCE_M, z: node.z, headingRad: spawn.headingRad };
}

/**
 * Builds the compiled area into `world`: every road edge/junction collider
 * (registered into a fresh `SurfaceMap`), every building collider from
 * `collision`, and exactly one `createVehicle(world, tuning, spawn)` at the
 * graph's `"default"` spawn node, heading applied as a post-construction Y
 * rotation on the chassis body.
 */
export function createMapScene(
  world: RAPIER.World,
  graph: RoadGraph,
  collision: MapCollision,
  tuning: VehicleTuning,
  profiles: SurfaceProfiles,
): MapScene {
  const surfaceMap = createSurfaceMap();

  // Off-road ground BEFORE road colliders (see buildHeightfieldCollider's own
  // doc comment) -- optional at the type level so a hypothetical future area
  // with no heightfield block still builds a scene, with road colliders only.
  if (collision.heightfield !== undefined) {
    buildHeightfieldCollider(world, surfaceMap, collision.heightfield);
  }

  buildRoadColliders(world, surfaceMap, graph, collision.heightfield, collision.buildings);

  for (const building of collision.buildings) {
    buildBuildingCollider(world, building);
  }

  const spawn = resolveSpawn(graph);
  const vehicle = createVehicle(world, tuning, spawn);
  vehicle.body.setRotation(yRotationQuat(spawn.headingRad), true);
  let currentTuning = tuning;

  // The single mutable object `applyInput` hands to `vehicle.tick` every
  // tick. `setSurfaceProfiles` swaps `.profiles` in place, never reallocates
  // `.map` -- matching `SurfaceMap`'s own "allocate once, mutate in place"
  // discipline (src/physics/surface.ts), same as surface-scene.ts.
  const surfaceContext: { map: SurfaceMap; profiles: SurfaceProfiles } = {
    map: surfaceMap,
    profiles,
  };

  // `bodies` contains the chassis body and NOTHING else -- road and building
  // bodies are all fixed with no mesh counterpart tracked here (the compiled
  // `.glb` is loaded and rendered independently), the same exclusion
  // `SurfaceScene.bodies` documents (threat T-01-16).
  const bodies: readonly RAPIER.RigidBody[] = [vehicle.body];

  return {
    bodies,
    vehicle,
    surfaces: surfaceContext,

    preTick(_tick: number): void {
      // No-op -- see the doc comment on `MapScene.preTick` above.
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

    dispose(): void {
      vehicle.dispose();
    },
  };
}
