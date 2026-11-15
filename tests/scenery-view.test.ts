import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { sceneryTriangles } from "../src/core/scenery-geometry";
import type { TerrainBuilding, TerrainFeature } from "../src/core/terrain-format";
import {
  buildFeaturePreview,
  createSceneryView,
  estimateSceneryTriangles,
} from "../src/render/scenery-view";
import { DENSE_BUILDINGS, DENSE_FEATURES } from "./fixtures/dense-scenery";

const flat = () => 0;

function drawables(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) {
      if (o.count > 0) out.push(o);
    } else if (o instanceof THREE.Mesh) out.push(o);
  });
  return out;
}

function builtTriangles(root: THREE.Object3D): number {
  let total = 0;
  for (const m of drawables(root)) {
    const g = m.geometry;
    const per = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    total += per * (m instanceof THREE.InstancedMesh ? m.count : 1);
  }
  return total;
}

function pt(kind: "tree" | "bush", variant: string): TerrainFeature {
  return { id: "p", kind, variant, x: 1, z: 2, rotationY: 0, scale: 1 };
}

function building(style?: string): TerrainBuilding {
  return {
    center: { x: 0, y: 2, z: 0 },
    halfExtents: { x: 2, y: 2, z: 2 },
    rotationY: 0,
    ...(style === undefined ? {} : { style }),
  };
}

const ALL_FEATURES: TerrainFeature[] = [
  pt("tree", "pine"),
  pt("tree", "oak"),
  pt("tree", "dead"),
  pt("bush", "round"),
  pt("bush", "scrub"),
  {
    id: "h",
    kind: "hedge",
    variant: "box",
    points: [
      [0, 0],
      [20, 0],
    ],
    heightM: 1.5,
  },
  {
    id: "f1",
    kind: "fence",
    variant: "post-rail",
    points: [
      [0, 5],
      [20, 5],
    ],
    heightM: 1.2,
  },
  {
    id: "f2",
    kind: "fence",
    variant: "picket",
    points: [
      [0, 8],
      [20, 8],
    ],
    heightM: 1.2,
  },
  {
    id: "f3",
    kind: "fence",
    variant: "chainlink",
    points: [
      [0, 11],
      [20, 11],
    ],
    heightM: 1.8,
  },
];
const ALL_BUILDINGS = ["shed", "house", "barn", "shop", "block", undefined].map(building);

describe("scenery view budget", () => {
  it("every catalog variant fits in 12 drawables", () => {
    const v = createSceneryView(ALL_FEATURES, ALL_BUILDINGS, flat, { drawStyleless: true });
    expect(drawables(v.group).length).toBeLessThanOrEqual(12);
    v.dispose();
  });

  it("dense fixture draws exactly 37,900 triangles in <= 12 draws", () => {
    const opts = { drawStyleless: false };
    const v = createSceneryView(DENSE_FEATURES, DENSE_BUILDINGS, flat, opts);
    expect(drawables(v.group).length).toBeLessThanOrEqual(12);
    expect(builtTriangles(v.group)).toBe(37900);
    expect(estimateSceneryTriangles(DENSE_FEATURES, DENSE_BUILDINGS, opts)).toBe(37900);
    expect(sceneryTriangles(DENSE_FEATURES, DENSE_BUILDINGS, { includeStyleless: false })).toBe(
      37900,
    );
    v.dispose();
  });
});

describe("per-instance triangle counts", () => {
  const cases: [string, TerrainFeature[], TerrainBuilding[], number][] = [
    ["dead tree (trunk)", [pt("tree", "dead")], [], 10],
    ["pine = trunk + cone", [pt("tree", "pine")], [], 15],
    ["oak = trunk + sphere", [pt("tree", "oak")], [], 30],
    ["bush", [pt("bush", "round")], [], 20],
    [
      "hedge 8 m = one unit box",
      [
        {
          id: "h",
          kind: "hedge",
          variant: "box",
          points: [
            [0, 0],
            [8, 0],
          ],
          heightM: 1.5,
        },
      ],
      [],
      12,
    ],
    ["pitched building", [], [building("house")], 20],
    ["flat building", [], [building("shop")], 24],
    ["style-less building", [], [building()], 12],
  ];
  for (const [name, f, b, tris] of cases) {
    it(name, () => {
      const v = createSceneryView(f, b, flat, { drawStyleless: true });
      expect(builtTriangles(v.group)).toBe(tris);
      v.dispose();
    });
  }
});

describe("scenery view behaviour", () => {
  it("instance counts, bounding spheres and shadows", () => {
    const f = [pt("tree", "pine"), pt("tree", "pine"), pt("tree", "pine")];
    const v = createSceneryView(f, [], flat, { drawStyleless: true });
    const inst = drawables(v.group).filter(
      (m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh,
    );
    expect(inst.length).toBe(2);
    for (const m of inst) {
      expect(m.count).toBe(3);
      expect(m.boundingSphere).not.toBeNull();
    }
    v.setFeatures([pt("tree", "pine")]);
    for (const m of drawables(v.group)) {
      expect(m.castShadow).toBe(false);
      if (m instanceof THREE.InstancedMesh) {
        expect(m.count).toBe(1);
        expect(m.boundingSphere).not.toBeNull();
      }
    }
    v.dispose();
  });

  it("drawStyleless false hides style-less buildings only", () => {
    const b = [building(), building("house")];
    const v = createSceneryView([], b, flat, { drawStyleless: false });
    expect(builtTriangles(v.group)).toBe(20);
    v.dispose();
  });

  it("exposes no buildingMeshes (D-17)", () => {
    const v = createSceneryView([], [building("house")], flat, { drawStyleless: true });
    expect("buildingMeshes" in v).toBe(false);
    v.dispose();
  });

  it("dispose releases geometry, material and instanced meshes", () => {
    const v = createSceneryView(ALL_FEATURES, ALL_BUILDINGS, flat, { drawStyleless: true });
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    for (const m of drawables(v.group)) {
      spies.push(vi.spyOn(m.geometry, "dispose"));
      spies.push(vi.spyOn(m.material as THREE.Material, "dispose"));
      if (m instanceof THREE.InstancedMesh) spies.push(vi.spyOn(m, "dispose"));
    }
    v.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });

  it("setFeatures rebuilds only feature meshes; setBuildings only building meshes", () => {
    const v = createSceneryView([pt("tree", "pine")], [building("house")], flat, {
      drawStyleless: true,
    });
    const [featureGroup, buildingGroup] = v.group.children;
    const buildingMesh = buildingGroup.children[0];
    const featureMesh = featureGroup.children[0];
    v.setFeatures([pt("tree", "oak")]);
    expect(buildingGroup.children[0]).toBe(buildingMesh);
    expect(featureGroup.children[0]).not.toBe(featureMesh);
    const featureMesh2 = featureGroup.children[0];
    v.setBuildings([building("shop")]);
    expect(featureGroup.children[0]).toBe(featureMesh2);
    expect(buildingGroup.children[0]).not.toBe(buildingMesh);
    v.dispose();
  });

  it("reseat moves instances to the new ground", () => {
    const v = createSceneryView([pt("bush", "round")], [], flat, { drawStyleless: true });
    const mesh = drawables(v.group)[0] as THREE.InstancedMesh;
    const m0 = new THREE.Matrix4();
    mesh.getMatrixAt(0, m0);
    const y0 = new THREE.Vector3().setFromMatrixPosition(m0).y;
    v.reseat(() => 10);
    const mesh2 = drawables(v.group)[0] as THREE.InstancedMesh;
    const m1 = new THREE.Matrix4();
    mesh2.getMatrixAt(0, m1);
    expect(new THREE.Vector3().setFromMatrixPosition(m1).y).toBeCloseTo(y0 + 10, 5);
    v.dispose();
  });

  it("feature preview is translucent at the given opacity", () => {
    const g = buildFeaturePreview(pt("tree", "pine"), flat, { opacity: 0.5, tint: 0x00ff00 });
    const meshes = drawables(g);
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBe(0.5);
    }
  });

  it("feature preview tint replaces every instance colour", () => {
    const g = buildFeaturePreview(pt("tree", "pine"), flat, { opacity: 0.5, tint: 0xff6b6b });
    for (const m of drawables(g)) {
      const inst = m as THREE.InstancedMesh;
      const c = new THREE.Color();
      inst.getColorAt(0, c);
      expect(c.getHex()).toBe(0xff6b6b);
      expect((inst.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
    }
  });
});
