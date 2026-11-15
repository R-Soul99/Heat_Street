/**
 * 07.1.3 stage 4: the ONE scenery renderer, shared by the game and the editor (D-13).
 *
 * Draw-call layout (D-09, at most 11 drawables): one InstancedMesh each for tree trunks, cone
 * canopies, sphere canopies, bushes and "unit boxes" (every hedge segment, fence rail/panel and
 * fence post), plus one merged mesh per building style present and one for style-less buildings.
 * Nothing casts or receives shadows (D-19). Palette buildings are NOT exposed as `buildingMeshes`;
 * the car x-ray covers visibility (D-17).
 *
 * `heightAt` is always supplied by the consumer (game physics grid, editor area grid) so the
 * scenery sits on exactly the ground the consumer shows.
 *
 * Layering: three + pure src/core only, never Rapier, no physics mutation.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { resolveBuildingStyle, resolveVariant } from "../core/scenery-catalog.ts";
import {
  type BuildingBox,
  buildingBoxes,
  featureInstances,
  type HeightSampler,
  type InstanceTransform,
  sceneryTriangles,
} from "../core/scenery-geometry.ts";
import type { TerrainBuilding, TerrainFeature } from "../core/terrain-format.ts";

export interface SceneryViewOptions {
  /** Draw buildings that have no style (terrain-native maps; D-11). */
  readonly drawStyleless: boolean;
}

export interface SceneryView {
  readonly group: THREE.Group;
  setFeatures(next: readonly TerrainFeature[]): void;
  setBuildings(next: readonly TerrainBuilding[]): void;
  /** Rebuilds every transform against a new ground sampler (after sculpting). */
  reseat(heightAt: HeightSampler): void;
  dispose(): void;
}

export interface PreviewOptions {
  readonly opacity: number;
  readonly tint?: number;
}

interface Item {
  readonly m: THREE.Matrix4;
  readonly color: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const STYLELESS_WALL = 0x9a9a98;
const STYLELESS_ROOF = 0x707070;

function transform(
  x: number,
  y: number,
  z: number,
  rotationY: number,
  sx: number,
  sy: number,
  sz: number,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, rotationY);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}

function makeMaterial(opts: { vertexColors?: boolean; preview?: PreviewOptions }) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.preview?.tint ?? 0xffffff,
    roughness: 0.9,
    metalness: 0,
    vertexColors: opts.vertexColors === true,
  });
  if (opts.preview !== undefined) {
    mat.transparent = true;
    mat.opacity = opts.preview.opacity;
    mat.depthWrite = false;
  }
  return mat;
}

function makeInstanced(
  geo: THREE.BufferGeometry,
  items: readonly Item[],
  preview: PreviewOptions | undefined,
): THREE.InstancedMesh | undefined {
  if (items.length === 0) {
    geo.dispose();
    return undefined;
  }
  const mesh = new THREE.InstancedMesh(geo, makeMaterial({ preview }), items.length);
  const c = new THREE.Color();
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    mesh.setColorAt(i, c.setHex(it.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Cylinder of radius 1, height 1, base at y = 0: 10 triangles. */
function trunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

/** Cone of radius 1, height 1, base at y = 0: 5 triangles. */
function coneGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, 5, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

/** Feature meshes (trees, bushes, hedges, fences): at most 5 drawables. */
function buildFeatureMeshes(
  features: readonly TerrainFeature[],
  heightAt: HeightSampler,
  preview?: PreviewOptions,
): THREE.InstancedMesh[] {
  const inst = featureInstances(features, heightAt);
  const trunks: Item[] = [];
  const cones: Item[] = [];
  const spheres: Item[] = [];
  const bushes: Item[] = [];
  const boxes: Item[] = [];

  for (const g of inst.trees) {
    const v = resolveVariant("tree", g.variant);
    if (v === undefined) continue;
    for (const t of g.transforms as InstanceTransform[]) {
      const s = t.scale;
      const trunkH = v.trunkHeightM * s;
      trunks.push({
        m: transform(t.x, t.y, t.z, t.rotationY, v.trunkRadiusM * s, trunkH, v.trunkRadiusM * s),
        color: v.trunkColor,
      });
      if (v.canopy.shape === "cone") {
        cones.push({
          m: transform(
            t.x,
            t.y + trunkH,
            t.z,
            t.rotationY,
            v.canopy.radiusM * s,
            v.canopy.heightM * s,
            v.canopy.radiusM * s,
          ),
          color: v.canopyColor,
        });
      } else if (v.canopy.shape === "sphere") {
        const h = v.canopy.heightM * s;
        spheres.push({
          m: transform(
            t.x,
            t.y + trunkH + h / 2,
            t.z,
            t.rotationY,
            v.canopy.radiusM * s,
            h / 2,
            v.canopy.radiusM * s,
          ),
          color: v.canopyColor,
        });
      }
    }
  }
  for (const g of inst.bushes) {
    const v = resolveVariant("bush", g.variant);
    if (v === undefined) continue;
    for (const t of g.transforms) {
      const s = t.scale;
      bushes.push({
        m: transform(
          t.x,
          t.y + (v.heightM * s) / 2,
          t.z,
          t.rotationY,
          v.radiusM * s,
          (v.heightM * s) / 2,
          v.radiusM * s,
        ),
        color: v.color,
      });
    }
  }
  for (const h of inst.hedges) {
    const v = resolveVariant("hedge", h.variant);
    if (v === undefined) continue;
    boxes.push({
      m: transform(h.x, h.y, h.z, h.rotationY, h.lengthM, h.heightM, h.widthM),
      color: v.color,
    });
  }
  for (const r of inst.fenceRails) {
    const v = resolveVariant("fence", r.variant);
    if (v === undefined) continue;
    boxes.push({
      m: transform(r.x, r.y, r.z, r.rotationY, r.lengthM, r.heightM, r.widthM),
      color: v.color,
    });
  }
  for (const p of inst.fencePosts) {
    const v = resolveVariant("fence", p.variant);
    if (v === undefined) continue;
    boxes.push({
      m: transform(p.x, p.y + p.heightM / 2, p.z, 0, p.sizeM, p.heightM, p.sizeM),
      color: v.color,
    });
  }

  const out: THREE.InstancedMesh[] = [];
  const push = (m: THREE.InstancedMesh | undefined) => {
    if (m !== undefined) out.push(m);
  };
  push(makeInstanced(trunkGeometry(), trunks, preview));
  push(makeInstanced(coneGeometry(), cones, preview));
  push(makeInstanced(new THREE.IcosahedronGeometry(1, 0), spheres, preview));
  push(makeInstanced(new THREE.IcosahedronGeometry(1, 0), bushes, preview));
  push(makeInstanced(new THREE.BoxGeometry(1, 1, 1), boxes, preview));
  return out;
}

function colorAttribute(count: number, hex: number): THREE.BufferAttribute {
  const c = new THREE.Color().setHex(hex);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  return new THREE.BufferAttribute(arr, 3);
}

/** Non-indexed unit box (12 triangles) with only position, normal and colour. */
function coloredBox(m: THREE.Matrix4, hex: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  g.deleteAttribute("uv");
  g.applyMatrix4(m);
  g.setAttribute("color", colorAttribute(g.getAttribute("position").count, hex));
  return g;
}

/** Closed triangular prism (8 triangles), ridge along local X, base at y = 0. */
function coloredPrism(
  hx: number,
  hz: number,
  h: number,
  m: THREE.Matrix4,
  hex: number,
): THREE.BufferGeometry {
  const L0 = [-hx, 0, -hz];
  const L1 = [hx, 0, -hz];
  const L2 = [hx, 0, hz];
  const L3 = [-hx, 0, hz];
  const R0 = [-hx, h, 0];
  const R1 = [hx, h, 0];
  const tris = [
    [L3, L2, R1],
    [L3, R1, R0],
    [L1, L0, R0],
    [L1, R0, R1],
    [L2, L1, R1],
    [L0, L3, R0],
    [L0, L1, L2],
    [L0, L2, L3],
  ];
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((tri, i) => {
    tri.forEach((v, j) => {
      pos[i * 9 + j * 3] = v[0];
      pos[i * 9 + j * 3 + 1] = v[1];
      pos[i * 9 + j * 3 + 2] = v[2];
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.applyMatrix4(m);
  g.setAttribute("color", colorAttribute(tris.length * 3, hex));
  return g;
}

function buildingGeometry(
  b: BuildingBox,
  wallColor: number,
  roofColor: number,
  styleless: boolean,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    coloredBox(transform(b.x, b.y, b.z, b.rotationY, b.hx * 2, b.hy * 2, b.hz * 2), wallColor),
  );
  if (styleless) return parts;
  const top = b.y + b.hy;
  if (b.roof === "pitched") {
    // Rotation about the building centre's vertical axis: build around the origin then place.
    const m = new THREE.Matrix4()
      .makeTranslation(b.x, top, b.z)
      .multiply(new THREE.Matrix4().makeRotationY(b.rotationY));
    parts.push(coloredPrism(b.hx, b.hz, Math.max(0.5, b.hz * 0.6), m, roofColor));
  } else {
    parts.push(
      coloredBox(
        transform(b.x, top + 0.15, b.z, b.rotationY, b.hx * 2 + 0.4, 0.3, b.hz * 2 + 0.4),
        roofColor,
      ),
    );
  }
  return parts;
}

function buildBuildingMeshes(
  buildings: readonly TerrainBuilding[],
  opts: SceneryViewOptions,
  styleColors: (style: string) => { wall: number; roof: number } | undefined,
): THREE.Mesh[] {
  const groups = buildingBoxes(buildings, { includeStyleless: opts.drawStyleless });
  const out: THREE.Mesh[] = [];
  for (const [style, boxes] of Object.entries(groups)) {
    const styleless = style === "";
    const colors = styleless ? { wall: STYLELESS_WALL, roof: STYLELESS_ROOF } : styleColors(style);
    if (colors === undefined || boxes.length === 0) continue;
    const parts: THREE.BufferGeometry[] = [];
    for (const b of boxes) {
      parts.push(...buildingGeometry(b, colors.wall, colors.roof, styleless));
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (merged === null) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, makeMaterial({ vertexColors: true }));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    out.push(mesh);
  }
  return out;
}

function styleColors(style: string): { wall: number; roof: number } | undefined {
  const s = resolveBuildingStyle(style);
  return s === undefined ? undefined : { wall: s.wallColor, roof: s.roofColor };
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const mat = mesh.material;
  if (Array.isArray(mat)) for (const m of mat) m.dispose();
  else mat.dispose();
  if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
}

export function createSceneryView(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  heightAt: HeightSampler,
  opts: SceneryViewOptions,
): SceneryView {
  const group = new THREE.Group();
  const featureGroup = new THREE.Group();
  const buildingGroup = new THREE.Group();
  group.add(featureGroup, buildingGroup);
  let currentFeatures = features;
  let currentBuildings = buildings;
  let currentHeightAt = heightAt;

  function clear(g: THREE.Group): void {
    for (const child of [...g.children]) {
      g.remove(child);
      disposeMesh(child as THREE.Mesh);
    }
  }
  function rebuildFeatures(): void {
    clear(featureGroup);
    for (const m of buildFeatureMeshes(currentFeatures, currentHeightAt)) featureGroup.add(m);
  }
  function rebuildBuildings(): void {
    clear(buildingGroup);
    for (const m of buildBuildingMeshes(currentBuildings, opts, styleColors)) buildingGroup.add(m);
  }
  rebuildFeatures();
  rebuildBuildings();

  return {
    group,
    setFeatures(next): void {
      currentFeatures = next;
      rebuildFeatures();
    },
    setBuildings(next): void {
      currentBuildings = next;
      rebuildBuildings();
    },
    reseat(nextHeightAt): void {
      currentHeightAt = nextHeightAt;
      rebuildFeatures();
      rebuildBuildings();
    },
    dispose(): void {
      clear(featureGroup);
      clear(buildingGroup);
    },
  };
}

/** Same counting rule the editor's hard 40,000 limit uses (src/core/scenery-geometry.ts). */
export function estimateSceneryTriangles(
  features: readonly TerrainFeature[],
  buildings: readonly TerrainBuilding[],
  opts: SceneryViewOptions,
): number {
  return sceneryTriangles(features, buildings, { includeStyleless: opts.drawStyleless });
}

/** Translucent ghost of one feature for the editor, built from the same geometry builders (D-13). */
export function buildFeaturePreview(
  feature: TerrainFeature,
  heightAt: HeightSampler,
  preview: PreviewOptions,
): THREE.Group {
  const g = new THREE.Group();
  for (const m of buildFeatureMeshes([feature], heightAt, preview)) {
    m.renderOrder = 1;
    g.add(m);
  }
  return g;
}
