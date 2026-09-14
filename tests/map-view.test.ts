import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { buildMapWorldView, loadMapView } from "../src/render/map-view";
// Read directly (node:fs, not Vite's `?raw`) so a grep-style assertion can
// check the DoubleSide/import-path literals appear in the real shipped
// source, matching this plan's own acceptance criteria.
import mapViewSource from "../src/render/map-view.ts?raw";

/**
 * `GLTFLoader.parseAsync` needs no DOM for this repo's `.glb` shape (no
 * textures/images, only `baseColorFactor` materials -- see
 * `tools/map-compiler/author/gltf.ts`), so it runs fine under this project's
 * `environment: "node"` Vitest config with no jsdom (04-09-PLAN.md's own
 * `<action>` text). Reading the real committed artifact as bytes (rather than
 * `load()` against a URL) is what makes this possible: Node's `fetch` cannot
 * resolve a bare relative `/maps/...` URL with no page origin.
 */
async function loadRealGlbScene(): Promise<THREE.Group> {
  const buf = await readFile("public/maps/juliette-ga.glb");
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer as ArrayBuffer, "");
  return gltf.scene;
}

/** Builds a synthetic scene with one named mesh per entry in `names`, each with its own `THREE.MeshStandardMaterial` seeded to `THREE.BackSide` so a test can prove `buildMapWorldView` actually overwrites `.side` rather than merely reading an already-correct default. */
function buildSyntheticScene(names: readonly string[]): THREE.Group {
  const scene = new THREE.Group();
  for (const name of names) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ side: THREE.BackSide }),
    );
    mesh.name = name;
    scene.add(mesh);
  }
  return scene;
}

describe("buildMapWorldView: road mesh classification (behavior bullets 1-2)", () => {
  it("resolves parallel roadMeshes/roadSurfaces arrays, with roadSurfaces[i] parsed from roadMeshes[i]'s node name", () => {
    const scene = buildSyntheticScene(["roads-gravel", "roads-tarmac"]);
    const view = buildMapWorldView(scene);

    expect(view.roadMeshes.length).toBe(view.roadSurfaces.length);
    expect(view.roadMeshes.length).toBe(2);
    expect(view.roadMeshes[0].name).toBe("roads-gravel");
    expect(view.roadSurfaces[0]).toBe("gravel");
    expect(view.roadMeshes[1].name).toBe("roads-tarmac");
    expect(view.roadSurfaces[1]).toBe("tarmac");
  });

  it("group/roadMeshes/roadSurfaces/buildingMeshes are all present on a MapWorldView", () => {
    const scene = buildSyntheticScene(["roads-tarmac", "buildings"]);
    const view = buildMapWorldView(scene);

    expect(view.group).toBeInstanceOf(THREE.Group);
    expect(view.roadMeshes).toBeDefined();
    expect(view.roadSurfaces).toBeDefined();
    expect(view.buildingMeshes).toBeDefined();
  });
});

describe("buildMapWorldView: buildings and ignored nodes (behavior bullet 3)", () => {
  it("a node named 'buildings' is not classified as a road and does not throw", () => {
    const scene = buildSyntheticScene(["buildings"]);
    const view = buildMapWorldView(scene);

    expect(view.roadMeshes.length).toBe(0);
    expect(view.buildingMeshes.length).toBe(1);
  });

  it("a node whose name is not 'buildings' and does not start with 'roads-' is ignored — appears in neither array and does not throw", () => {
    const scene = buildSyntheticScene(["roads-sand", "decoration", "buildings"]);
    const view = buildMapWorldView(scene);

    expect(view.roadMeshes.length).toBe(1);
    expect(view.buildingMeshes.length).toBe(1);
    // "decoration" is neither a road mesh nor a building mesh.
    const allNames = [...view.roadMeshes, ...view.buildingMeshes].map((m) => m.name);
    expect(allNames).not.toContain("decoration");
  });
});

describe("buildMapWorldView: unknown surface suffix (behavior bullet 4)", () => {
  it("throws naming the offending node when a roads-<suffix> node's suffix is not one of the six SURFACE_TYPES", () => {
    const scene = buildSyntheticScene(["roads-asphalt"]);
    expect(() => buildMapWorldView(scene)).toThrow(/roads-asphalt/);
  });
});

describe("buildMapWorldView: buildingMeshes empty when the buildings node is absent (behavior bullet 5)", () => {
  it("returns an empty buildingMeshes array when no 'buildings' node exists", () => {
    const scene = buildSyntheticScene(["roads-tarmac", "roads-gravel"]);
    const view = buildMapWorldView(scene);

    expect(view.buildingMeshes).toEqual([]);
  });
});

describe("buildMapWorldView: material sidedness (behavior bullet 6)", () => {
  it("sets every road material to THREE.FrontSide and every building material to THREE.DoubleSide", () => {
    const scene = buildSyntheticScene(["roads-tarmac", "buildings"]);
    const view = buildMapWorldView(scene);

    const roadMaterial = view.roadMeshes[0].material as THREE.MeshStandardMaterial;
    expect(roadMaterial.side).toBe(THREE.FrontSide);

    const buildingMaterial = view.buildingMeshes[0].material as THREE.MeshStandardMaterial;
    expect(buildingMaterial.side).toBe(THREE.DoubleSide);
  });
});

describe("loadMapView: fetch/parse failure (behavior bullet 7)", () => {
  it("rejects with an error naming the URL when the artifact cannot be loaded", async () => {
    const badUrl = "/maps/does-not-exist.glb";
    await expect(loadMapView(badUrl)).rejects.toThrow(new RegExp(badUrl.replace(/[/.]/g, "\\$&")));
  });
});

describe("buildMapWorldView: against the REAL compiled juliette-ga.glb", () => {
  it("roadMeshes.length === roadSurfaces.length, and at least two distinct surfaces are present", async () => {
    const scene = await loadRealGlbScene();
    const view = buildMapWorldView(scene);

    expect(view.roadMeshes.length).toBe(view.roadSurfaces.length);
    expect(view.roadMeshes.length).toBeGreaterThan(0);
    expect(new Set(view.roadSurfaces).size).toBeGreaterThanOrEqual(2);
  });

  it("produces at least one building mesh for the real compiled area", async () => {
    const scene = await loadRealGlbScene();
    const view = buildMapWorldView(scene);

    expect(view.buildingMeshes.length).toBeGreaterThan(0);
  });
});

describe("map-view.ts: source-level acceptance criteria", () => {
  it("imports GLTFLoader from three/addons/loaders/GLTFLoader.js, not three/examples/jsm/", () => {
    expect(mapViewSource).toMatch(/from\s+"three\/addons\/loaders\/GLTFLoader\.js"/);
    expect(mapViewSource).not.toMatch(/three\/examples\/jsm\//);
  });

  it("applies DoubleSide to building materials with a comment referencing the occlusion-mitigation ADR", () => {
    expect(mapViewSource).toMatch(/DoubleSide/);
    expect(mapViewSource).toMatch(/0003-occlusion-mitigation\.md/);
  });
});
