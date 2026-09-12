/**
 * Surface zone visual planes + placeholder building meshes matching
 * `src/physics/surface-scene.ts`'s physics geometry.
 *
 * MUST MATCH every zone half-extent/centre and every building half-extent/
 * position declared in `src/physics/surface-scene.ts` -- this file has NO
 * import from that module (pure render concern, mirroring
 * `vehicle-view.ts`'s own hardcoded-ground/ramp convention at its lines
 * 39-54): every literal below carries its own MUST MATCH comment naming the
 * specific physics constant it mirrors. Cross-importing geometry constants
 * between the physics and render tiers is a convention this project
 * deliberately does not use.
 *
 * Layering: `src/render/` reads simulation state and never writes it. This
 * file goes further than `vehicle-view.ts` -- it reads no Rapier state at
 * all (no controller, no wheel getters) and does not import
 * `@dimforge/rapier3d` in any form, `import type` or otherwise.
 */
import * as THREE from "three";

/** MUST MATCH `ZONE_HALF_X` * 2 / `ZONE_HALF_Y` * 2 / `ZONE_HALF_Z` * 2 in
 * `src/physics/surface-scene.ts`: 120 x 2 x 80 m full-size band. */
const ZONE_SIZE = { width: 120, height: 2, depth: 80 };

/** MUST MATCH `ZONE_HALF_Y` in `src/physics/surface-scene.ts` -- every
 * band's top face sits at y = 0, so the mesh centre sits one half-thickness
 * below it, exactly as the physics body is translated. */
const ZONE_HALF_Y = 1;

const COLOUR_TARMAC = 0x2b2b33; // deliberately identical to vehicle-view.ts's COLOUR_GROUND -- tarmac is the unchanged Phase 2 baseline.
const COLOUR_GRAVEL = 0xa89a78;
const COLOUR_DIRT_ROAD = 0x8a6a4a;
const COLOUR_GRASS = 0x3f6b3a;
const COLOUR_SAND = 0xd9c48f;
const COLOUR_MUD = 0x4a3626;
const COLOUR_BUILDING = 0x6b6f7a;

/**
 * One placeholder building's placement, duplicated verbatim from
 * `src/physics/surface-scene.ts`'s `BuildingPlacement` shape (not imported
 * -- see this file's header comment).
 */
interface BuildingVisual {
  readonly x: number;
  readonly z: number;
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
}

/** MUST MATCH `SPARSE_BUILDINGS` in `src/physics/surface-scene.ts`. */
const SPARSE_BUILDINGS: readonly BuildingVisual[] = [
  { x: 34, z: 170, halfExtents: { x: 6, y: 10, z: 6 } },
  { x: 48, z: 110, halfExtents: { x: 6, y: 10, z: 6 } },
  { x: 30, z: 55, halfExtents: { x: 6, y: 10, z: 6 } },
  { x: 50, z: 0, halfExtents: { x: 6, y: 10, z: 6 } },
];

/** MUST MATCH `DENSE_BUILDINGS` in `src/physics/surface-scene.ts`. */
const DENSE_BUILDINGS: readonly BuildingVisual[] = [
  { x: -41, z: 30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: 10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: -10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: -30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -41, z: -50, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: 30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: 10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: -10, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: -30, halfExtents: { x: 5, y: 14, z: 9 } },
  { x: -21, z: -50, halfExtents: { x: 5, y: 14, z: 9 } },
];

/**
 * Build one zone's mesh from the shared band geometry, positioned to match
 * its physics counterpart (top face at y = 0). Boxes rather than planes so
 * the band edges are visible from the helicopter camera's high angle, which
 * is what makes a surface transition legible on screen.
 */
function buildZoneMesh(
  geometry: THREE.BoxGeometry,
  material: THREE.Material,
  centerZ: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, -ZONE_HALF_Y, centerZ);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Build one cluster's building meshes from a shared geometry and a shared
 * BASE material, cloning the material per instance -- plan 03-08's fade
 * mitigation needs PER-BUILDING opacity, so each mesh gets its own
 * `material.clone()` even though every clone starts identical. This comment
 * is what stops a future "optimisation" back to one shared material
 * instance from silently breaking that fade.
 */
function buildClusterMeshes(
  geometry: THREE.BoxGeometry,
  baseMaterial: THREE.MeshStandardMaterial,
  placements: readonly BuildingVisual[],
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  for (const placement of placements) {
    const material = baseMaterial.clone();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(placement.x, placement.halfExtents.y, placement.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * Six coloured zone planes and two building clusters as one disposable
 * group, plus the flat `buildingMeshes` array plan 03-08's `THREE.Raycaster`
 * occlusion probe passes to `intersectObjects`.
 */
export interface SurfaceWorldView {
  readonly group: THREE.Group;

  /**
   * Every building mesh in both clusters, sparse-then-dense order -- exactly
   * the array plan 03-08's occlusion probe consumes.
   */
  readonly buildingMeshes: readonly THREE.Mesh[];

  /** Dispose every geometry and material this module created. */
  dispose(): void;
}

/**
 * Build the six zone meshes and both building clusters. Takes no
 * parameters -- every dimension is a duplicated literal mirroring
 * `src/physics/surface-scene.ts` (see this file's header comment), so
 * there is nothing for a caller to pass in.
 */
export function createSurfaceWorld(): SurfaceWorldView {
  const group = new THREE.Group();

  // Six zone meshes: ONE shared geometry, one MeshStandardMaterial PER
  // SURFACE (docs/frame-budget.md's draw-call/triangle discipline, the same
  // reasoning vehicle-view.ts states for its wheels at lines 246-254).
  const zoneGeometry = new THREE.BoxGeometry(ZONE_SIZE.width, ZONE_SIZE.height, ZONE_SIZE.depth);
  const tarmacMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_TARMAC, roughness: 0.95 });
  const gravelMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_GRAVEL, roughness: 0.95 });
  const dirtRoadMaterial = new THREE.MeshStandardMaterial({
    color: COLOUR_DIRT_ROAD,
    roughness: 0.95,
  });
  const grassMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_GRASS, roughness: 0.95 });
  const sandMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_SAND, roughness: 0.95 });
  const mudMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_MUD, roughness: 0.95 });

  // MUST MATCH SURFACE_ZONE_ORDER's z = 200 - i * 80 band-centre formula in
  // src/physics/surface-scene.ts: tarmac at +200 down to mud at -200.
  group.add(buildZoneMesh(zoneGeometry, tarmacMaterial, 200));
  group.add(buildZoneMesh(zoneGeometry, gravelMaterial, 120));
  group.add(buildZoneMesh(zoneGeometry, dirtRoadMaterial, 40));
  group.add(buildZoneMesh(zoneGeometry, grassMaterial, -40));
  group.add(buildZoneMesh(zoneGeometry, sandMaterial, -120));
  group.add(buildZoneMesh(zoneGeometry, mudMaterial, -200));

  // Building meshes: ONE shared geometry PER CLUSTER (the two clusters have
  // different half-extents -- MUST MATCH SPARSE_BUILDINGS' {6,10,6} and
  // DENSE_BUILDINGS' {5,14,9} in src/physics/surface-scene.ts) and ONE
  // shared BASE material across all buildings, cloned per instance -- see
  // `buildClusterMeshes`'s doc comment.
  const sparseGeometry = new THREE.BoxGeometry(12, 20, 12);
  const denseGeometry = new THREE.BoxGeometry(10, 28, 18);
  const buildingBaseMaterial = new THREE.MeshStandardMaterial({
    color: COLOUR_BUILDING,
    roughness: 0.85,
    transparent: true,
  });

  const sparseMeshes = buildClusterMeshes(sparseGeometry, buildingBaseMaterial, SPARSE_BUILDINGS);
  const denseMeshes = buildClusterMeshes(denseGeometry, buildingBaseMaterial, DENSE_BUILDINGS);
  // Sparse-then-dense order -- see `SurfaceWorldView.buildingMeshes`' own doc comment.
  const buildingMeshes: readonly THREE.Mesh[] = [...sparseMeshes, ...denseMeshes];
  for (const mesh of buildingMeshes) {
    group.add(mesh);
  }

  return {
    group,
    buildingMeshes,

    dispose(): void {
      zoneGeometry.dispose();
      tarmacMaterial.dispose();
      gravelMaterial.dispose();
      dirtRoadMaterial.dispose();
      grassMaterial.dispose();
      sandMaterial.dispose();
      mudMaterial.dispose();
      sparseGeometry.dispose();
      denseGeometry.dispose();
      buildingBaseMaterial.dispose();
      for (const mesh of buildingMeshes) {
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}
