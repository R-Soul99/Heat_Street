/**
 * The Three.js half of the Phase 2 vehicle scene: a chassis mesh, four wheel
 * meshes, and static ground/ramp visuals matching
 * `src/physics/vehicle-scene.ts`'s physics geometry.
 *
 * THE INDEX CONTRACT. `meshes[0]` is the chassis and maps onto
 * `VehicleScene.bodies[0]` -- the same dense-index hazard
 * `src/render/debug-scene.ts` documents for its own bodies (threat
 * T-01-16): a mismatch draws the chassis at another body's transform. The
 * WHEEL mesh array (private to this module, not part of `meshes`) has its
 * own index contract: `FL/FR/RL/RR = 0/1/2/3`, mirroring
 * `src/physics/vehicle.ts`'s exported wheel-index constants exactly -- a
 * mismatch there draws each wheel at another wheel's transform, which reads
 * as "the physics is broken" and is painful to diagnose after the fact.
 *
 * Layering: `src/render/` reads simulation state and never writes it.
 * UNLIKE `src/render/debug-scene.ts`, this file DOES read the Rapier
 * vehicle controller (`wheelSuspensionLength`, `wheelSteering`,
 * `wheelRotation`, `wheelAxleCs`, `wheelChassisConnectionPointCs`), so the
 * clause weakens from "touches Rapier not at all" to "reads Rapier, never
 * writes". `tests/layering.test.ts`'s `src/render/` block enforces only the
 * write ban (`world.step`/`applyImpulse`/`setTranslation`/`setRotation`/
 * `setNextKinematic`), and none of the wheel getters used below match that
 * pattern, so a read-only `vehicle-view.ts` passes as written. `import type
 * * as RAPIER` is used throughout (the `transform-cache.ts:19` precedent),
 * since this file only reads.
 */
import type * as RAPIER from "@dimforge/rapier3d";
import * as THREE from "three";

/**
 * Ground plane visual size, metres. MUST MATCH `GROUND_HALF_EXTENTS` in
 * `src/physics/vehicle-scene.ts` (200 x 400 half-extents -> 400 x 800 full
 * size), or the drawn ground will not line up with where the chassis
 * actually rests.
 */
const GROUND_SIZE = { width: 400, depth: 800 };

/**
 * Ramp visual geometry, metres. MUST MATCH the constants of the same name in
 * `src/physics/vehicle-scene.ts`'s `buildRamp` -- this file has no import
 * from `src/physics/vehicle-scene.ts` (it is a factory module, not a source
 * of static geometry types), following this plan's own reasoning for
 * `createVehicleView` taking wheel geometry as parameters rather than
 * importing `VehicleTuning`: it keeps this module a pure render concern and
 * puts the geometry contract at the composition-root call site
 * (`src/main.ts`, plan 02-08).
 */
const RAMP_HALF_WIDTH = 4;
const RAMP_LENGTH = 12;
const RAMP_HEIGHT = 1.6;
/** MUST MATCH `RAMP_APPROACH_Z` exported from `src/physics/vehicle-scene.ts`. */
const RAMP_APPROACH_Z = 10;
const RAMP_CREST_Z = RAMP_APPROACH_Z - RAMP_LENGTH;

const COLOUR_BACKGROUND = 0x141820;
const COLOUR_GROUND = 0x2b2b33;
const COLOUR_RAMP = 0x4a4a55;
const COLOUR_CHASSIS = 0xb5321f;
const COLOUR_WHEEL = 0x151515;
const COLOUR_GRID = 0x50505c;
const COLOUR_GRID_CENTER = 0x6a6a78;

/**
 * Default half-extents/spacing of the ground reference grid, metres. A
 * featureless flat plane gives a driver no way to judge speed or lateral
 * slide from a chase camera -- this is a cheap, no-asset-pipeline fix (hand-
 * built `LineSegments`, not a texture) added after the plan 02-10 feel
 * session found the bare ground unreadable. 10 m lines are coarse enough not
 * to moire at speed and fine enough to read a slide against.
 *
 * These are the DEFAULTS used when a caller does not pass
 * `options.groundExtents` -- they match the Phase 2 flat-plane fixture's
 * footprint (a 400 x 400 m square, i.e. 200 m half-extents both axes) and
 * exist so every pre-Phase-3 call site keeps its exact prior grid unchanged.
 */
const GRID_HALF_EXTENT_DEFAULT = 200;
const GRID_SPACING = 10;

/** Half-width of the area the shadow camera frames, metres. */
const SHADOW_AREA_HALF = 30;

/**
 * Build the six triangles (18 non-indexed vertices) of the ramp wedge, in the
 * SAME point layout `src/physics/vehicle-scene.ts`'s `buildRamp` uses for its
 * `ColliderDesc.convexHull` points -- see that function's doc comment for the
 * cross-section reasoning. Non-indexed so each triangle keeps its own flat
 * face normal after `computeVertexNormals()`, rather than blending normals
 * across the wedge's sharp edges. The bottom face is omitted: it sits flush
 * against the ground plane and is never visible.
 */
function buildRampGeometry(): THREE.BufferGeometry {
  const a = new THREE.Vector3(-RAMP_HALF_WIDTH, 0, RAMP_APPROACH_Z); // knife edge, left
  const b = new THREE.Vector3(RAMP_HALF_WIDTH, 0, RAMP_APPROACH_Z); // knife edge, right
  const c = new THREE.Vector3(-RAMP_HALF_WIDTH, 0, RAMP_CREST_Z); // crest back-base, left
  const d = new THREE.Vector3(RAMP_HALF_WIDTH, 0, RAMP_CREST_Z); // crest back-base, right
  const e = new THREE.Vector3(-RAMP_HALF_WIDTH, RAMP_HEIGHT, RAMP_CREST_Z); // crest top, left
  const f = new THREE.Vector3(RAMP_HALF_WIDTH, RAMP_HEIGHT, RAMP_CREST_Z); // crest top, right

  // Winding chosen so each triangle's right-hand-rule normal points outward
  // (verified by hand against the physics wedge's own outward faces): the
  // sloped top (driving surface), the two side walls, and the vertical back
  // face the car launches over.
  const triangles: readonly THREE.Vector3[] = [
    a,
    b,
    f, // top slope
    a,
    f,
    e, // top slope
    a,
    e,
    c, // left side
    b,
    d,
    f, // right side
    c,
    f,
    d, // back
    c,
    e,
    f, // back
  ];

  const positions = new Float32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    positions[i * 3] = triangles[i].x;
    positions[i * 3 + 1] = triangles[i].y;
    positions[i * 3 + 2] = triangles[i].z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Index-aligned with `VehicleScene.bodies` (chassis is index 0, per THE
 * INDEX CONTRACT above). Fed to `applyAllInterpolated`.
 */
export interface VehicleView {
  readonly scene: THREE.Scene;

  /**
   * `meshes[0]` is the chassis. There is exactly one entry -- the wheels are
   * children of the chassis mesh (see `createVehicleView`) and are never
   * independently interpolated, so they are not part of this array.
   */
  readonly meshes: readonly THREE.Object3D[];

  /**
   * Per-frame wheel rig: suspension travel, steer angle, roll. Reads the
   * controller, writes only meshes.
   */
  updateWheels(vc: RAPIER.DynamicRayCastVehicleController): void;

  /**
   * The four wheel meshes, `FL/FR/RL/RR = 0/1/2/3` -- THE SAME index
   * contract `updateWheels` above and `src/physics/vehicle.ts`'s exported
   * wheel-index constants already honour (see THE INDEX CONTRACT in this
   * file's header comment). Added for plan 03-10's `surface-fx.ts`, which
   * needs each wheel's world position to spawn particles/decals at; a
   * mismatch here draws FX at another wheel's location, the same hazard
   * threat T-01-16 already names for meshes/bodies.
   */
  readonly wheelMeshes: readonly THREE.Object3D[];

  /** Dispose every geometry and material this module created. */
  dispose(): void;
}

/** World-space up axis, reused as the steer rotation axis (module scratch, T-02-16). */
const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** Reused per-wheel scratch objects so `updateWheels` allocates nothing per call. */
const SCRATCH_AXLE = new THREE.Vector3();
const SCRATCH_STEER_QUAT = new THREE.Quaternion();
const SCRATCH_ROLL_QUAT = new THREE.Quaternion();
const SCRATCH_COMPOSED_QUAT = new THREE.Quaternion();

/**
 * Build a rectangular reference grid bounded to exactly `[-halfX, halfX]` x
 * `[-halfZ, halfZ]`, at `spacing`-metre intervals, with the two centreline
 * segments (x = 0 and z = 0) drawn in `colorCenter` and every other line in
 * `colorLine`. Replaces a plain `THREE.GridHelper` (which is always square,
 * `size` x `size`) because a square grid drawn wider than the actual
 * drivable floor reads as "the ground continues here" when it does not --
 * found during plan 03-08's human go/no-go session, where a driver fell off
 * the six-surface scene's 120 m-wide floor while the grid still showed lines
 * out to 400 m. One `LineSegments` with a per-vertex `color` attribute,
 * mirroring `THREE.GridHelper`'s own internal construction so `dispose()`
 * below (`grid.geometry.dispose()` / `(grid.material as
 * THREE.Material).dispose()`) needs no change.
 */
function buildReferenceGrid(
  halfX: number,
  halfZ: number,
  spacing: number,
  colorCenter: number,
  colorLine: number,
): THREE.LineSegments {
  const center = new THREE.Color(colorCenter);
  const line = new THREE.Color(colorLine);

  const positions: number[] = [];
  const colors: number[] = [];

  const pushSegment = (x1: number, z1: number, x2: number, z2: number, c: THREE.Color): void => {
    positions.push(x1, 0, z1, x2, 0, z2);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };

  // Lines parallel to Z (running the length of the floor), stepped across X.
  for (let x = -halfX; x <= halfX + 1e-6; x += spacing) {
    pushSegment(x, -halfZ, x, halfZ, x === 0 ? center : line);
  }
  // Lines parallel to X (running the width of the floor), stepped across Z.
  for (let z = -halfZ; z <= halfZ + 1e-6; z += spacing) {
    pushSegment(-halfX, z, halfX, z, z === 0 ? center : line);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false });
  return new THREE.LineSegments(geometry, material);
}

/**
 * One car's chassis + four wheel meshes, with no `THREE.Scene`, ground, grid
 * or lights of its own (plan 07-02, factored out of `createVehicleView`).
 * `FL/FR/RL/RR = 0/1/2/3` order, mirroring `src/physics/vehicle.ts`'s wheel
 * index constants exactly — the same T-01-16 dense-index hazard as every
 * other wheel array in this codebase.
 */
export interface CarMeshes {
  readonly chassis: THREE.Mesh;
  /** `FL/FR/RL/RR = 0/1/2/3`. Children of `chassis` — see `createVehicleView`'s own reasoning for why wheels are parented rather than independently interpolated. */
  readonly wheelMeshes: readonly THREE.Mesh[];
  /** Per-frame wheel rig: suspension travel, steer angle, roll. Reads the controller, writes only meshes. */
  updateWheels(vc: RAPIER.DynamicRayCastVehicleController): void;
  /** Dispose this car's own geometry and materials (never shared with another `buildCarMeshes` call). */
  dispose(): void;
}

/**
 * Builds ONE car's chassis + wheel meshes and nothing else — no `THREE.Scene`,
 * ground, grid or lights (RESEARCH.md Pitfall 6 / Anti-Pattern: calling
 * `createVehicleView` a 4th time for AI cars would build 3 more orphaned
 * scenes). `createVehicleView` below calls this once for the player, with
 * `COLOUR_CHASSIS`, and adds the returned `chassis` to its OWN scene;
 * `src/render/ai-vehicle-view.ts` calls this once per AI car, with a
 * distinct paint colour, adding each `chassis` directly into the EXISTING
 * player scene it is handed.
 *
 * @param wheelRadius Wheel visual radius, metres. Must be a positive finite number.
 * @param halfTrack Half the left-right wheel spacing, metres. Must be a positive finite number.
 * @param halfWheelbase Half the front-rear wheel spacing, metres. Must be a positive finite number.
 * @param chassisHalfExtents Chassis box half-extents, metres. Every component must be a positive finite number.
 * @param chassisColor This car's chassis paint, a `0xRRGGBB` hex integer.
 */
export function buildCarMeshes(
  wheelRadius: number,
  halfTrack: number,
  halfWheelbase: number,
  chassisHalfExtents: { x: number; y: number; z: number },
  chassisColor: number,
): CarMeshes {
  if (!Number.isFinite(wheelRadius) || wheelRadius <= 0) {
    throw new RangeError(`wheelRadius must be a positive finite number, got ${wheelRadius}`);
  }
  if (!Number.isFinite(halfTrack) || halfTrack <= 0) {
    throw new RangeError(`halfTrack must be a positive finite number, got ${halfTrack}`);
  }
  if (!Number.isFinite(halfWheelbase) || halfWheelbase <= 0) {
    throw new RangeError(`halfWheelbase must be a positive finite number, got ${halfWheelbase}`);
  }
  for (const axis of ["x", "y", "z"] as const) {
    const v = chassisHalfExtents[axis];
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`chassisHalfExtents.${axis} must be a positive finite number, got ${v}`);
    }
  }

  const chassisGeometry = new THREE.BoxGeometry(
    chassisHalfExtents.x * 2,
    chassisHalfExtents.y * 2,
    chassisHalfExtents.z * 2,
  );
  const chassisMaterial = new THREE.MeshStandardMaterial({ color: chassisColor, roughness: 0.5 });
  const chassis = new THREE.Mesh(chassisGeometry, chassisMaterial);
  chassis.castShadow = true;
  chassis.receiveShadow = true;

  // One shared geometry/material across THIS car's four wheels only (never
  // shared across cars) — see `createVehicleView`'s matching comment for the
  // frame-budget reasoning.
  const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelRadius * 0.6, 20);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_WHEEL, roughness: 0.7 });

  const connectionsXZ: readonly { x: number; z: number }[] = [
    { x: -halfTrack, z: -halfWheelbase }, // FL
    { x: halfTrack, z: -halfWheelbase }, // FR
    { x: -halfTrack, z: halfWheelbase }, // RL
    { x: halfTrack, z: halfWheelbase }, // RR
  ];

  const wheelMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.castShadow = true;
    wheel.position.set(connectionsXZ[i].x, 0, connectionsXZ[i].z);
    chassis.add(wheel);
    wheelMeshes.push(wheel);
  }

  return {
    chassis,
    wheelMeshes,

    updateWheels(vc: RAPIER.DynamicRayCastVehicleController): void {
      for (let i = 0; i < 4; i++) {
        const connectionY = vc.wheelChassisConnectionPointCs(i)?.y ?? 0;
        const suspensionLength = vc.wheelSuspensionLength(i) ?? 0;
        wheelMeshes[i].position.y = connectionY - suspensionLength;

        const steerRad = vc.wheelSteering(i) ?? 0;
        const rollRad = vc.wheelRotation(i) ?? 0;
        const axle = vc.wheelAxleCs(i);
        SCRATCH_AXLE.set(axle?.x ?? -1, axle?.y ?? 0, axle?.z ?? 0);
        SCRATCH_AXLE.normalize();

        SCRATCH_STEER_QUAT.setFromAxisAngle(UP_AXIS, steerRad);
        SCRATCH_ROLL_QUAT.setFromAxisAngle(SCRATCH_AXLE, rollRad);
        SCRATCH_COMPOSED_QUAT.multiplyQuaternions(SCRATCH_STEER_QUAT, SCRATCH_ROLL_QUAT);
        wheelMeshes[i].quaternion.copy(SCRATCH_COMPOSED_QUAT);
      }
    },

    dispose(): void {
      chassisGeometry.dispose();
      chassisMaterial.dispose();
      wheelGeometry.dispose();
      wheelMaterial.dispose();
    },
  };
}

/**
 * Build the chassis mesh, four wheel meshes and static ground/ramp visuals.
 *
 * @param wheelRadius Wheel visual radius, metres. Must be a positive finite number.
 * @param halfTrack Half the left-right wheel spacing, metres. Must be a positive finite number.
 * @param halfWheelbase Half the front-rear wheel spacing, metres. Must be a positive finite number.
 * @param chassisHalfExtents Chassis box half-extents, metres. Every component must be a positive finite number.
 * @param options.includePhase2Ground When `false`, skips the Phase 2 ground
 *   plane and ramp meshes (and their disposal) -- plan 03-05's composition
 *   root uses this to swap in `src/render/surface-view.ts`'s zone/building
 *   visuals instead without dragging the Phase 2 flat-ground/ramp geometry
 *   along underneath them. Defaults to `true` so every existing call site
 *   keeps working with no change.
 * @param options.groundExtents Half-extents (metres) the reference grid is
 *   bounded to, `{ x, z }`. Defaults to `{ x: GRID_HALF_EXTENT_DEFAULT, z:
 *   GRID_HALF_EXTENT_DEFAULT }` (the Phase 2 400 x 400 m square) so every
 *   pre-Phase-3 call site is pixel-identical to before this option existed.
 *   Phase 3's composition root (`src/main.ts`) passes the six-surface
 *   scene's actual floor half-extents here -- see this function's own
 *   `buildReferenceGrid` doc comment for why a mismatch matters. The grid is
 *   built on BOTH branches of `includePhase2Ground` regardless -- plan
 *   02-10's feel session found a featureless ground made speed and slip
 *   impossible to judge, and SC4's speed-legibility gate needs it more than
 *   that session did.
 */
export function createVehicleView(
  wheelRadius: number,
  halfTrack: number,
  halfWheelbase: number,
  chassisHalfExtents: { x: number; y: number; z: number },
  options?: {
    readonly includePhase2Ground?: boolean;
    readonly groundExtents?: { readonly x: number; readonly z: number };
  },
): VehicleView {
  if (!Number.isFinite(wheelRadius) || wheelRadius <= 0) {
    throw new RangeError(`wheelRadius must be a positive finite number, got ${wheelRadius}`);
  }
  if (!Number.isFinite(halfTrack) || halfTrack <= 0) {
    throw new RangeError(`halfTrack must be a positive finite number, got ${halfTrack}`);
  }
  if (!Number.isFinite(halfWheelbase) || halfWheelbase <= 0) {
    throw new RangeError(`halfWheelbase must be a positive finite number, got ${halfWheelbase}`);
  }
  for (const axis of ["x", "y", "z"] as const) {
    const v = chassisHalfExtents[axis];
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`chassisHalfExtents.${axis} must be a positive finite number, got ${v}`);
    }
  }

  const includePhase2Ground = options?.includePhase2Ground ?? true;
  const groundExtents = options?.groundExtents ?? {
    x: GRID_HALF_EXTENT_DEFAULT,
    z: GRID_HALF_EXTENT_DEFAULT,
  };
  for (const axis of ["x", "z"] as const) {
    const v = groundExtents[axis];
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`groundExtents.${axis} must be a positive finite number, got ${v}`);
    }
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOUR_BACKGROUND);

  // Ground and ramp visuals: static, not part of `meshes` (they have no
  // physics body counterpart, matching `src/render/debug-scene.ts`'s
  // exclusion of its own ground for exactly the same reason). Both are
  // nullable and built ONLY when `includePhase2Ground` is true, so
  // `dispose()` below can skip disposing resources that were never created.
  let groundGeometry: THREE.PlaneGeometry | null = null;
  let groundMaterial: THREE.MeshStandardMaterial | null = null;
  let rampGeometry: THREE.BufferGeometry | null = null;
  let rampMaterial: THREE.MeshStandardMaterial | null = null;

  if (includePhase2Ground) {
    groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE.width, GROUND_SIZE.depth);
    groundGeometry.rotateX(-Math.PI / 2);
    // Top surface at y = 0, matching the physics ground's top surface.
    groundMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_GROUND, roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Reference grid, sat a hair above y = 0 to avoid z-fighting with the
  // ground plane it shares a surface with. Centred at the world origin
  // (not on the chassis) and bounded to `groundExtents` -- see
  // `buildReferenceGrid`'s doc comment for why an unbounded grid is a bug,
  // not a feature. Built on BOTH branches of `includePhase2Ground` -- see
  // this function's own `options.includePhase2Ground` doc comment for why.
  const grid = buildReferenceGrid(
    groundExtents.x,
    groundExtents.z,
    GRID_SPACING,
    COLOUR_GRID_CENTER,
    COLOUR_GRID,
  );
  grid.position.y = 0.01;
  scene.add(grid);

  if (includePhase2Ground) {
    rampGeometry = buildRampGeometry();
    rampMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_RAMP, roughness: 0.8 });
    const ramp = new THREE.Mesh(rampGeometry, rampMaterial);
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    scene.add(ramp);
  }

  // The chassis mesh. No pose is set here -- every body mesh transform is
  // owned by `applyAllInterpolated` and written on the first rendered frame;
  // seeding a pose would be overwritten immediately and would hide an
  // ordering bug on frame one behind a plausible-looking layout
  // (`src/render/debug-scene.ts:117-120`'s rule, copied verbatim). This
  // does NOT apply to the wheel meshes below: their local transforms are
  // owned by `buildCarMeshes` and written every frame by `updateWheels`.
  //
  // `buildCarMeshes` (factored out, plan 07-02) builds the chassis + four
  // wheel meshes with no Scene/ground/grid of its own; this is the ONE call
  // site that owns the player's paint (`COLOUR_CHASSIS`) and adds the result
  // into THIS module's own scene. `src/render/ai-vehicle-view.ts` calls the
  // same function 3 more times, once per AI car, into the EXISTING scene
  // (RESEARCH.md Pitfall 6: never call `createVehicleView` a 4th time).
  const carMeshes = buildCarMeshes(
    wheelRadius,
    halfTrack,
    halfWheelbase,
    chassisHalfExtents,
    COLOUR_CHASSIS,
  );
  const { chassis, wheelMeshes } = carMeshes;
  scene.add(chassis);

  const hemisphere = new THREE.HemisphereLight(0x8fa6c4, 0x2a2620, 1.1);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffe9cf, 2.6);
  sun.position.set(20, 30, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_AREA_HALF;
  sun.shadow.camera.right = SHADOW_AREA_HALF;
  sun.shadow.camera.top = SHADOW_AREA_HALF;
  sun.shadow.camera.bottom = -SHADOW_AREA_HALF;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 150;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  return {
    scene,
    meshes: [chassis],
    wheelMeshes,

    updateWheels(vc: RAPIER.DynamicRayCastVehicleController): void {
      carMeshes.updateWheels(vc);
    },

    dispose(): void {
      groundGeometry?.dispose();
      groundMaterial?.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      rampGeometry?.dispose();
      rampMaterial?.dispose();
      carMeshes.dispose();
    },
  };
}
