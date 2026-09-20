import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildCrestGeometry, JULIETTE_GA_CRESTS } from "../../../src/core/crest-geometry.ts";
import type { RoadGeometry } from "../../../src/core/road-geometry.ts";
import { SURFACE_TYPES } from "../../../src/core/surface-types.ts";
import type { BuildingBox } from "../geometry/building-box.ts";
import { makeProjector } from "../graph/project.ts";
import { buildGltfDocument, writeGlb } from "./gltf.ts";
import { buildHeightfield, type HeightfieldGrid } from "./heightfield.ts";

const TEST_PROJECTOR = makeProjector({ lat: 33.1, lon: -83.8 });
/**
 * A minimal, valid heightfield fixture — this file's tests exercise
 * `buildGltfDocument`'s road/building meshes; the terrain mesh has its own
 * dedicated coverage in `heightfield.test.ts`. This file never calls
 * `buildingBoxes` directly (its `BuildingBox` fixtures are hand-built via
 * `makeBuildingBox` below), so there is no `GroundHeightSampler` use here;
 * `buildHeightfield` (`heightfield.ts`) is NOT touched by this plan and is
 * still lat/lon-sampler-shaped (owned by plan 04.1-04) — its sampler
 * argument is an untyped object literal (structurally satisfying that
 * shape) rather than a named import, keeping this file free of any
 * `sources/dem.ts` reference.
 */
const TEST_HEIGHTFIELD: HeightfieldGrid = buildHeightfield(
  { sample: () => 100 },
  { minX: -10, minZ: -10, maxX: 10, maxZ: 10 },
  TEST_PROJECTOR,
  2,
);

/** A single quad (4 verts, 2 tris) as edge geometry, for a given surface. */
function makeQuadEdge(edgeId: number, surface: (typeof SURFACE_TYPES)[number]) {
  return {
    edgeId,
    surface,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/** A single triangle-fan junction (3 verts, 1 tri) for a given surface. */
function makeTriJunction(nodeId: number, surface: (typeof SURFACE_TYPES)[number]) {
  return {
    nodeId,
    surface,
    positions: new Float32Array([5, 0, 5, 6, 0, 5, 5, 0, 6]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

function makeBuildingBox(osmWayId: number): BuildingBox {
  // A minimal, valid prism: 8 verts, 10 triangles (matches building-box.ts's own shape).
  const positions = new Float32Array([
    0,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    1, // base
    0,
    3,
    0,
    1,
    3,
    0,
    1,
    3,
    1,
    0,
    3,
    1, // top
  ]);
  const indices = new Uint32Array([
    4,
    5,
    6,
    4,
    6,
    7, // roof
    0,
    1,
    5,
    0,
    5,
    4, // wall 0
    1,
    2,
    6,
    1,
    6,
    5, // wall 1
    2,
    3,
    7,
    2,
    7,
    6, // wall 2
    3,
    0,
    4,
    3,
    4,
    7, // wall 3
  ]);
  return {
    osmWayId,
    buildingType: "yes",
    positions,
    indices,
    heightM: 3,
    heightSource: "type-default",
    areaSqM: 1,
  };
}

describe("buildGltfDocument", () => {
  it("produces exactly one mesh per surface type PRESENT, named roads-<surface>, none for absent surfaces", () => {
    const geometry: RoadGeometry = {
      edges: [makeQuadEdge(0, "tarmac"), makeQuadEdge(1, "gravel")],
      junctions: [],
    };
    const { document } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD);

    const meshNames = document
      .getRoot()
      .listMeshes()
      .map((m) => m.getName());

    expect(meshNames).toContain("roads-tarmac");
    expect(meshNames).toContain("roads-gravel");
    for (const surface of SURFACE_TYPES) {
      if (surface === "tarmac" || surface === "gravel") continue;
      expect(meshNames).not.toContain(`roads-${surface}`);
    }
    expect(meshNames).not.toContain("buildings");
  });

  it("sums edge AND junction vertex counts for a surface into that surface's primitive", () => {
    const geometry: RoadGeometry = {
      edges: [makeQuadEdge(0, "tarmac")],
      junctions: [makeTriJunction(0, "tarmac")],
    };
    const { document } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD);

    const mesh = document
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === "roads-tarmac");
    expect(mesh).toBeDefined();
    const primitive = mesh?.listPrimitives()[0];
    const positionAccessor = primitive?.getAttribute("POSITION");
    // 4 (quad edge) + 3 (tri junction) = 7 vertices.
    expect(positionAccessor?.getCount()).toBe(7);
  });

  it("rebases indices correctly when geometries are concatenated: max index equals vertex count minus one", () => {
    const geometry: RoadGeometry = {
      edges: [makeQuadEdge(0, "tarmac"), makeQuadEdge(1, "tarmac")],
      junctions: [],
    };
    const { document } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD);

    const mesh = document
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === "roads-tarmac");
    const primitive = mesh?.listPrimitives()[0];
    const positionAccessor = primitive?.getAttribute("POSITION");
    const indexAccessor = primitive?.getIndices();
    const indexArray = indexAccessor?.getArray();

    expect(positionAccessor?.getCount()).toBe(8); // two quads, 4 verts each
    let maxIndex = -1;
    for (const value of indexArray ?? []) {
      if (value > maxIndex) maxIndex = value;
    }
    expect(maxIndex).toBe((positionAccessor?.getCount() ?? 0) - 1);
  });

  it("emits a buildings mesh when at least one box was produced, and none when boxes is empty", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };

    const withBoxes = buildGltfDocument(geometry, [makeBuildingBox(1)], TEST_HEIGHTFIELD);
    const withoutBoxes = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD);

    const namesWith = withBoxes.document
      .getRoot()
      .listMeshes()
      .map((m) => m.getName());
    const namesWithout = withoutBoxes.document
      .getRoot()
      .listMeshes()
      .map((m) => m.getName());

    expect(namesWith).toContain("buildings");
    expect(namesWithout).not.toContain("buildings");
  });

  it("gives each road mesh its own material named surface-<name>, with a distinct base colour per surface", () => {
    const geometry: RoadGeometry = {
      edges: [makeQuadEdge(0, "tarmac"), makeQuadEdge(1, "gravel")],
      junctions: [],
    };
    const { document } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD);

    const tarmacMesh = document
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === "roads-tarmac");
    const gravelMesh = document
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === "roads-gravel");
    const tarmacMaterial = tarmacMesh?.listPrimitives()[0].getMaterial();
    const gravelMaterial = gravelMesh?.listPrimitives()[0].getMaterial();

    expect(tarmacMaterial?.getName()).toBe("surface-tarmac");
    expect(gravelMaterial?.getName()).toBe("surface-gravel");
    expect(tarmacMaterial?.getBaseColorFactor()).not.toEqual(gravelMaterial?.getBaseColorFactor());
  });

  it("keeps every node transform at identity — geometry is authored directly in world-space local ENU metres", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const { document } = buildGltfDocument(geometry, [makeBuildingBox(1)], TEST_HEIGHTFIELD);

    for (const node of document.getRoot().listNodes()) {
      expect(node.getTranslation()).toEqual([0, 0, 0]);
      expect(node.getRotation()).toEqual([0, 0, 0, 1]);
      expect(node.getScale()).toEqual([1, 1, 1]);
    }
  });

  it("declares no extensions", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const { document } = buildGltfDocument(geometry, [makeBuildingBox(1)], TEST_HEIGHTFIELD);

    expect(document.getRoot().listExtensionsUsed()).toHaveLength(0);
  });

  it("names every mesh's containing node identically to the mesh", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const { document } = buildGltfDocument(geometry, [makeBuildingBox(1)], TEST_HEIGHTFIELD);

    for (const node of document.getRoot().listNodes()) {
      expect(node.getMesh()?.getName()).toBe(node.getName());
    }
  });

  it("emits a terrain mesh whose vertex count matches the heightfield grid and material is surface-grass", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const { document, stats } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD);

    const terrainMesh = document
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === "terrain");
    expect(terrainMesh).toBeDefined();
    const primitive = terrainMesh?.listPrimitives()[0];
    const positionAccessor = primitive?.getAttribute("POSITION");
    const expectedVertexCount = (TEST_HEIGHTFIELD.rows + 1) * (TEST_HEIGHTFIELD.cols + 1);
    expect(positionAccessor?.getCount()).toBe(expectedVertexCount);
    expect(stats.terrainVertexCount).toBe(expectedVertexCount);
    expect(primitive?.getMaterial()?.getName()).toBe("surface-grass");
  });
});

describe("buildGltfDocument — authored crests (D-04b)", () => {
  it("with no crests passed, the document contains no mesh named crests and all three crest stats are 0", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const { document, stats } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD, []);

    const meshNames = document
      .getRoot()
      .listMeshes()
      .map((m) => m.getName());
    expect(meshNames).not.toContain("crests");
    expect(stats.crestCount).toBe(0);
    expect(stats.crestTriangleCount).toBe(0);
    expect(stats.crestVertexCount).toBe(0);
  });

  it("with real authored crests passed, emits a crests mesh/node at identity transform and reports the right crest count", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const crestEntries = buildCrestGeometry(JULIETTE_GA_CRESTS, () => 0);
    const { document, stats } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD, [], crestEntries);

    const crestsMesh = document
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === "crests");
    expect(crestsMesh).toBeDefined();

    const crestsNode = document
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === "crests");
    expect(crestsNode).toBeDefined();
    expect(crestsNode?.getMesh()?.getName()).toBe("crests");
    expect(crestsNode?.getTranslation()).toEqual([0, 0, 0]);
    expect(crestsNode?.getRotation()).toEqual([0, 0, 0, 1]);
    expect(crestsNode?.getScale()).toEqual([1, 1, 1]);

    expect(stats.crestCount).toBe(3);
  });

  it("reports crestTriangleCount/crestVertexCount as the sum across every entry's own indices/positions", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const crestEntries = buildCrestGeometry(JULIETTE_GA_CRESTS, () => 0);
    const { stats } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD, [], crestEntries);

    const expectedTriangleCount = crestEntries.reduce(
      (sum, entry) => sum + entry.indices.length / 3,
      0,
    );
    const expectedVertexCount = crestEntries.reduce(
      (sum, entry) => sum + entry.positions.length / 3,
      0,
    );
    expect(stats.crestTriangleCount).toBe(expectedTriangleCount);
    expect(stats.crestVertexCount).toBe(expectedVertexCount);
  });

  it("rebases crest indices correctly when merged: the primitive's maximum index equals its vertex count minus one", () => {
    const geometry: RoadGeometry = { edges: [makeQuadEdge(0, "tarmac")], junctions: [] };
    const crestEntries = buildCrestGeometry(JULIETTE_GA_CRESTS, () => 0);
    const { document } = buildGltfDocument(geometry, [], TEST_HEIGHTFIELD, [], crestEntries);

    const crestsMesh = document
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === "crests");
    const primitive = crestsMesh?.listPrimitives()[0];
    const positionAccessor = primitive?.getAttribute("POSITION");
    const indexAccessor = primitive?.getIndices();
    const indexArray = indexAccessor?.getArray();

    let maxIndex = -1;
    for (const value of indexArray ?? []) {
      if (value > maxIndex) maxIndex = value;
    }
    expect(maxIndex).toBe((positionAccessor?.getCount() ?? 0) - 1);
  });
});

describe("writeGlb", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("writes a .glb starting with the glTF magic bytes, and round-trips through NodeIO.readBinary with mesh names intact", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "heat-street-gltf-test-"));
    const outPath = path.join(tmpDir, "test-area.glb");

    const geometry: RoadGeometry = {
      edges: [makeQuadEdge(0, "tarmac"), makeQuadEdge(1, "gravel")],
      junctions: [],
    };
    const { document } = buildGltfDocument(geometry, [makeBuildingBox(1)], TEST_HEIGHTFIELD);

    await writeGlb(document, outPath);

    const bytes = await readFile(outPath);
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("glTF");

    const io = new NodeIO();
    const roundTripped = await io.readBinary(new Uint8Array(bytes));
    const meshNames = roundTripped
      .getRoot()
      .listMeshes()
      .map((m) => m.getName())
      .sort();
    expect(meshNames).toEqual(["buildings", "roads-gravel", "roads-tarmac", "terrain"]);
  });
});
