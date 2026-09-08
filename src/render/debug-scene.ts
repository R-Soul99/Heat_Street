/**
 * The Three.js half of the Phase 1 debug scene.
 *
 * Mirrors `src/physics/debug-scene.ts`: one ground plane, six falling boxes and
 * one never-sleeping spinner. Deliberately no vehicle-shaped placeholder — that
 * is Phase 2's job (D-01).
 *
 * THE INDEX CONTRACT. `meshes` MUST be built in the same dense index order as
 * `DebugScene.bodies`, because `applyAllInterpolated` maps target index `i` onto
 * buffer offset `i * XFORM_STRIDE`. A mismatch draws every body at another
 * body's transform, which reads as "the physics is broken" and is painful to
 * diagnose after the fact (threat T-01-16).
 *
 * `bodyCount` and `spinnerIndex` are parameters rather than an import from
 * `src/physics/`, so this module stays a pure render concern and the ordering
 * contract is stated explicitly at the composition root in `src/main.ts`.
 *
 * Layering: `src/render/` reads simulation state and never writes it. Nothing
 * here touches Rapier at all.
 */
import * as THREE from "three";

/** Full extent of the ground, matching the 50 m half-extent physics cuboid. */
const GROUND_SIZE = 100;

/**
 * The physics ground is a cuboid centred on the origin with a 0.5 m half-height,
 * so its top face — the surface the boxes actually land on — is at y = 0.5. Draw
 * the plane anywhere else and every box will appear to float or sink.
 */
const GROUND_TOP_Y = 0.5;

/** Matches the 0.5 m half-extent box colliders. */
const BOX_SIZE = 1;

/** Matches the 1.5 / 0.15 / 0.15 half-extents of the kinematic spinner. */
const SPINNER_SIZE = { x: 3, y: 0.3, z: 0.3 };

/** Half-width of the area the shadow camera frames, in metres. */
const SHADOW_AREA_HALF = 12;

const COLOUR_BACKGROUND = 0x101014;
const COLOUR_GROUND = 0x2b2b33;
const COLOUR_BOX = 0xd9793a;
const COLOUR_SPINNER = 0x49c6b0;

export interface DebugRenderScene {
  readonly scene: THREE.Scene;

  /**
   * One mesh per physics body, in the SAME dense index order as
   * `DebugScene.bodies`. Excludes the ground, which is not a tracked body.
   */
  readonly meshes: readonly THREE.Mesh[];
}

/**
 * Build the lit, shadowed debug scene for `bodyCount` bodies.
 *
 * @param bodyCount Length of `DebugScene.bodies`. `meshes` will have exactly
 *   this length.
 * @param spinnerIndex Index of the never-sleeping kinematic spinner, drawn as a
 *   distinctly coloured bar so the SC2 judder check has something to watch once
 *   the six boxes have gone to sleep.
 */
export function createDebugRenderScene(bodyCount: number, spinnerIndex: number): DebugRenderScene {
  if (!Number.isInteger(bodyCount) || bodyCount < 1) {
    throw new RangeError(`bodyCount must be a positive integer, got ${bodyCount}`);
  }
  if (!Number.isInteger(spinnerIndex) || spinnerIndex < 0 || spinnerIndex >= bodyCount) {
    throw new RangeError(
      `spinnerIndex must be an index into ${bodyCount} bodies, got ${spinnerIndex}`,
    );
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOUR_BACKGROUND);

  // Baked into the geometry rather than set on the mesh, so this file contains
  // no mesh transform at all and the "the interpolator owns every pose" rule
  // below has no exception to argue about.
  const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
  groundGeometry.rotateX(-Math.PI / 2);
  groundGeometry.translate(0, GROUND_TOP_Y, 0);
  const ground = new THREE.Mesh(
    groundGeometry,
    new THREE.MeshStandardMaterial({ color: COLOUR_GROUND, roughness: 0.95 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);
  // The ground is deliberately NOT pushed into `meshes`: it is not in
  // `DebugScene.bodies`, so including it would shift every subsequent mesh one
  // index off its body. That off-by-one is the single most likely way the index
  // contract gets broken, which is why it is called out here.

  // One shared geometry and one shared material across all six identical boxes,
  // keeping the scene inside the Phase 1 targets of under 20 draw calls and
  // under 10,000 triangles (docs/frame-budget.md).
  const boxGeometry = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
  const boxMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_BOX, roughness: 0.6 });
  const spinnerGeometry = new THREE.BoxGeometry(SPINNER_SIZE.x, SPINNER_SIZE.y, SPINNER_SIZE.z);
  const spinnerMaterial = new THREE.MeshStandardMaterial({
    color: COLOUR_SPINNER,
    roughness: 0.4,
    emissive: new THREE.Color(COLOUR_SPINNER).multiplyScalar(0.15),
  });

  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < bodyCount; i++) {
    const isSpinner = i === spinnerIndex;
    const mesh = new THREE.Mesh(
      isSpinner ? spinnerGeometry : boxGeometry,
      isSpinner ? spinnerMaterial : boxMaterial,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // No pose is set here. Every body mesh transform is owned by
    // `applyAllInterpolated` and written on the first rendered frame; seeding a
    // pose would be overwritten immediately and would hide an ordering bug on
    // frame one behind a plausible-looking layout.
    scene.add(mesh);
    meshes.push(mesh);
  }

  const hemisphere = new THREE.HemisphereLight(0x8fa6c4, 0x2a2620, 1.1);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffe9cf, 2.6);
  sun.position.set(12, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Frame the shadow camera to the roughly 20 x 20 m active area. Left at the
  // default 5 m box the boxes fall outside it and cast no shadow at all; opened
  // up to the full 100 m ground the texel density collapses and every shadow
  // turns to mush.
  sun.shadow.camera.left = -SHADOW_AREA_HALF;
  sun.shadow.camera.right = SHADOW_AREA_HALF;
  sun.shadow.camera.top = SHADOW_AREA_HALF;
  sun.shadow.camera.bottom = -SHADOW_AREA_HALF;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  if (meshes.length !== bodyCount) {
    throw new Error(`mesh/body count mismatch: ${meshes.length} meshes for ${bodyCount} bodies`);
  }

  return { scene, meshes };
}
