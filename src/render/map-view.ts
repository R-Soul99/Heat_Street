/**
 * `MapWorldView`: the compiled-area render scene, loaded from the map
 * compiler's own `.glb` (`tools/map-compiler/author/gltf.ts`) via
 * `GLTFLoader`. This is the runtime's first use of `GLTFLoader` in the repo.
 *
 * SUPERSEDES `src/render/surface-view.ts` at the composition root ONLY
 * (D-P26, mirroring `src/physics/map-scene.ts`'s own supersession note for
 * `surface-scene.ts`): `surface-view.ts` remains in place, unmodified, as a
 * regression fixture its own tests still import. Deleting it is a separately
 * planned task, never a side effect of this plan.
 *
 * `roadMeshes`/`roadSurfaces` are parallel arrays -- the exact shape
 * `src/render/surface-fx.ts`'s `createSurfaceFx(zoneMeshes, zoneSurfaces)`
 * already consumes for `surface-view.ts`'s `zoneMeshes`/`SURFACE_ZONE_ORDER`,
 * so plan 04-09's composition-root wiring is a drop-in swap. `buildingMeshes`
 * is the same flat array shape `createOcclusionProbe`/`createOcclusionController`
 * already consume.
 *
 * The compiler (`tools/map-compiler/author/gltf.ts`) emits one node per
 * surface type PRESENT, named `roads-<surface>`, plus one `buildings` node
 * when any building exists -- each node's mesh has exactly one primitive, so
 * `GLTFLoader` assigns the compiled node's own name directly onto the
 * resulting `THREE.Mesh` (no wrapping `THREE.Group`), verified by reading
 * `GLTFLoader.js`'s `_loadNodeShallow`/`createMesh` (a node with a single
 * mesh dependency becomes that mesh object itself, then the NODE's name
 * overwrites the mesh's own glTF-mesh name). This module still falls back to
 * a mesh's PARENT name defensively, per this plan's own `<action>` text, in
 * case a future compiler emits nested groups.
 *
 * Building materials are switched to `THREE.DoubleSide` here -- a deliberate,
 * targeted fix, not a stray tweak. Quick task `260913-epf` and
 * `docs/adr/0003-occlusion-mitigation.md` both record that `FrontSide`-only
 * building materials drop the occlusion probe's fan rays as culled back-face
 * exits when a ray originates inside a building's box, which is why
 * `occludedFanRayCount` always read 0/5 in the placeholder test canyon and
 * why the steepen mitigation could never be fairly judged. Real building
 * density arrives with this plan, so fixing the material side here is the
 * cheapest possible moment. Road materials stay `THREE.FrontSide` --
 * unchanged from the compiler's own default, set explicitly here anyway so a
 * reader never has to guess whether the omission was deliberate.
 *
 * Layering: `src/render/` reads simulation state and never writes it. This
 * file reads no Rapier state at all (no controller, no wheel getters) and
 * does not import `@dimforge/rapier3d` in any form -- the same "goes further
 * than vehicle-view.ts" property `surface-view.ts` already documents for
 * itself.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SURFACE_TYPES, type SurfaceType } from "../core/surface-types";

/** Every `roads-<surface>` node's compiler-emitted name prefix (`tools/map-compiler/author/gltf.ts`'s `meshName` convention). */
const ROAD_NODE_PREFIX = "roads-";

/** The compiler's single non-road node name (`tools/map-compiler/author/gltf.ts`). */
const BUILDINGS_NODE_NAME = "buildings";

/**
 * One compiled `.glb`, loaded and classified: `roadMeshes`/`roadSurfaces` are
 * PARALLEL arrays of equal length (mirroring `SurfaceWorldView.zoneMeshes`'
 * pairing with `SURFACE_ZONE_ORDER`), and `buildingMeshes` is every mesh
 * found under the `buildings` node (empty when that node is absent).
 */
export interface MapWorldView {
  readonly group: THREE.Group;

  /**
   * One entry per `roads-<surface>` node present in the `.glb`, in the order
   * `GLTFLoader`'s traversal encountered them. Parallel with `roadSurfaces`.
   */
  readonly roadMeshes: readonly THREE.Mesh[];

  /** `roadSurfaces[i]` is `roadMeshes[i]`'s own surface, parsed from its node name. */
  readonly roadSurfaces: readonly SurfaceType[];

  /** Every mesh found under the `buildings` node. Empty when that node is absent. */
  readonly buildingMeshes: readonly THREE.Mesh[];

  /** Dispose every geometry and material this module took ownership of. */
  dispose(): void;
}

type NodeClassification =
  | { readonly kind: "road"; readonly surface: SurfaceType }
  | { readonly kind: "building" }
  | { readonly kind: "ignored" };

/**
 * Classifies a node/mesh name per this plan's `<behavior>`: `"buildings"`
 * maps to the building bucket, a `"roads-<surface>"` prefix maps to that
 * surface (throwing, naming `name`, when the suffix is not one of the six
 * `SURFACE_TYPES` -- the same closed-enum discipline
 * `src/core/road-graph.ts`'s `parseEdge` applies to the `surface` field),
 * and anything else is ignored.
 */
function classifyName(name: string): NodeClassification {
  if (name === BUILDINGS_NODE_NAME) {
    return { kind: "building" };
  }
  if (name.startsWith(ROAD_NODE_PREFIX)) {
    const suffix = name.slice(ROAD_NODE_PREFIX.length);
    if (!(SURFACE_TYPES as readonly string[]).includes(suffix)) {
      throw new Error(
        `loadMapView: node "${name}" has an unrecognised surface suffix "${suffix}" -- expected one of ${SURFACE_TYPES.join(", ")}`,
      );
    }
    return { kind: "road", surface: suffix as SurfaceType };
  }
  return { kind: "ignored" };
}

/** Sets `side` on `mesh.material`, whichever of the single-material/multi-material shapes it is. */
function applyMaterialSide(mesh: THREE.Mesh, side: THREE.Side): void {
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const m of material) m.side = side;
  } else {
    material.side = side;
  }
}

/** Disposes `mesh.geometry` and every material `mesh.material` holds (single or array). */
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const m of material) m.dispose();
  } else {
    material.dispose();
  }
}

/**
 * Classifies every `THREE.Mesh` under `scene` and builds a `MapWorldView`
 * from it. Split out from `loadMapView` so `tests/map-view.test.ts` can
 * exercise this classification/validation logic directly against a scene
 * produced by `GLTFLoader.parse`/`parseAsync` (no network, no DOM) --
 * mirroring `src/physics/map-scene.ts`'s own "factory takes already-parsed
 * data" split (D-P24), applied here to the render tier.
 */
export function buildMapWorldView(scene: THREE.Object3D): MapWorldView {
  const group = new THREE.Group();
  const roadMeshes: THREE.Mesh[] = [];
  const roadSurfaces: SurfaceType[] = [];
  const buildingMeshes: THREE.Mesh[] = [];
  let ignoredCount = 0;

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    // "its own or its parent node's name" (this plan's <action>): the
    // compiler's shape always names the mesh itself (see this file's header
    // comment), but a mesh with no name of its own defensively falls back to
    // its parent's.
    const name = obj.name.length > 0 ? obj.name : (obj.parent?.name ?? "");
    const classification = classifyName(name);
    switch (classification.kind) {
      case "road":
        applyMaterialSide(obj, THREE.FrontSide);
        roadMeshes.push(obj);
        roadSurfaces.push(classification.surface);
        break;
      case "building":
        // docs/adr/0003-occlusion-mitigation.md: DoubleSide is the targeted
        // fix for the fan-ray/back-face-cull bug that made
        // occludedFanRayCount always read 0/5 -- see this file's header.
        applyMaterialSide(obj, THREE.DoubleSide);
        buildingMeshes.push(obj);
        break;
      case "ignored":
        ignoredCount++;
        break;
    }
  });

  for (const mesh of roadMeshes) group.add(mesh);
  for (const mesh of buildingMeshes) group.add(mesh);

  if (ignoredCount > 0) {
    // One-line diagnostic report, per this plan's <action> -- never thrown,
    // an unrecognised-but-harmless node (e.g. an authoring-tool artifact) is
    // not a load failure.
    console.log(
      `loadMapView: ignored ${ignoredCount} node(s) matching neither "roads-<surface>" nor "buildings"`,
    );
  }

  return {
    group,
    roadMeshes,
    roadSurfaces,
    buildingMeshes,

    dispose(): void {
      for (const mesh of roadMeshes) disposeMesh(mesh);
      for (const mesh of buildingMeshes) disposeMesh(mesh);
    },
  };
}

/**
 * Loads `glbUrl` with `GLTFLoader` and builds a `MapWorldView` from its
 * scene. Rejects with an error naming `glbUrl` on either a fetch failure
 * (bad path, network error) or a parse/classification failure (malformed
 * `.glb`, unrecognised surface suffix) -- `src/main.ts`'s load-failure
 * handling (D-P27) depends on this message being traceable to the artifact
 * that failed, matching `parseRoadGraph`/`parseMapCollision`'s own
 * `sourceLabel` convention.
 */
export async function loadMapView(glbUrl: string): Promise<MapWorldView> {
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(glbUrl);
    return buildMapWorldView(gltf.scene);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`loadMapView: failed to load "${glbUrl}": ${message}`);
  }
}
