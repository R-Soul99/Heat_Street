import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildEdgeBerm } from "../src/core/terrain-edge-berm";
import { createTerrainGrid, terrainIndex, terrainVertexNormal } from "../src/core/terrain-grid";
import { createPaintMap, encodePaintValue } from "../src/core/terrain-paint";
import {
  buildTerrainView,
  TERRAIN_CHUNK_CELLS,
  TERRAIN_SURFACE_PALETTE,
  TEXTURE_LOD_HYSTERESIS_M,
  TEXTURE_REBUILDS_PER_CALL,
} from "../src/render/terrain-view";

function bumpyGrid(rows: number, cols: number) {
  const g = createTerrainGrid({ rows, cols, cellSizeM: 2, originX: -10, originZ: 5 });
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      g.heights[terrainIndex(g, r, c)] = Math.sin(r * 0.37) * 3 + Math.cos(c * 0.21) * 2;
    }
  }
  return g;
}

function paintFor(g: ReturnType<typeof bumpyGrid>, fill: "grass" | "tarmac" = "grass") {
  return createPaintMap({
    originX: g.originX,
    originZ: g.originZ,
    widthM: g.scaleX,
    depthM: g.scaleZ,
    metresPerPixel: 1,
    fill,
  });
}

describe("terrain-view geometry", () => {
  const grid = bumpyGrid(70, 130);
  const view = buildTerrainView(grid, paintFor(grid));

  it("builds ceil(rows/64) * ceil(cols/64) chunks", () => {
    expect(TERRAIN_CHUNK_CELLS).toBe(64);
    expect(view.chunkMeshes.length).toBe(3 * 2);
    expect(view.group.children.length).toBe(6);
    expect(view.chunkMeshes[0].geometry.getAttribute("position").count).toBe(65 * 65);
  });

  it("vertex positions are exactly the grid heights", () => {
    for (const mesh of view.chunkMeshes) {
      const pos = mesh.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i += 37) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const col = Math.round((x - grid.originX) / grid.cellSizeM);
        const row = Math.round((z - grid.originZ) / grid.cellSizeM);
        expect(pos.getY(i)).toBe(grid.heights[terrainIndex(grid, row, col)]);
      }
    }
  });

  it("splits each quad along TERRAIN_DIAGONAL (row0col1 - row1col0)", () => {
    const idx = view.chunkMeshes[0].geometry.getIndex();
    expect(idx).not.toBeNull();
    const a = 0;
    const b = 1; // row0 col1
    const c = 65; // row1 col0
    const d = 66;
    const t1 = [idx?.getX(0), idx?.getX(1), idx?.getX(2)];
    const t2 = [idx?.getX(3), idx?.getX(4), idx?.getX(5)];
    expect(new Set(t1)).toEqual(new Set([a, b, c]));
    expect(new Set(t2)).toEqual(new Set([b, c, d]));
  });

  it("triangles face up (CCW from +Y)", () => {
    const geo = view.chunkMeshes[0].geometry;
    const flat = createTerrainGrid({ rows: 2, cols: 2, cellSizeM: 1, originX: 0, originZ: 0 });
    const fv = buildTerrainView(flat, paintFor(flat));
    const g = fv.chunkMeshes[0].geometry;
    const p = g.getAttribute("position");
    const ix = g.getIndex();
    const v = (i: number) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const n = new THREE.Vector3()
      .subVectors(v(ix?.getX(1) ?? 0), v(ix?.getX(0) ?? 0))
      .cross(new THREE.Vector3().subVectors(v(ix?.getX(2) ?? 0), v(ix?.getX(0) ?? 0)));
    expect(n.y).toBeGreaterThan(0);
    expect(geo.getAttribute("normal").getY(0)).toBeGreaterThan(0);
    fv.dispose();
  });

  it("border vertices shared by two chunks have identical positions and normals", () => {
    const m0 = view.chunkMeshes[0].geometry;
    const m1 = view.chunkMeshes[1].geometry;
    for (let lr = 0; lr <= 64; lr += 7) {
      const i0 = lr * 65 + 64; // last col of chunk (0,0)
      const i1 = lr * 65 + 0; // first col of chunk (0,1)
      for (const attr of ["position", "normal"] as const) {
        const a = m0.getAttribute(attr);
        const b = m1.getAttribute(attr);
        expect(a.getX(i0)).toBeCloseTo(b.getX(i1), 9);
        expect(a.getY(i0)).toBeCloseTo(b.getY(i1), 9);
        expect(a.getZ(i0)).toBeCloseTo(b.getZ(i1), 9);
      }
    }
  });

  it("normals come from the global grid", () => {
    const n = { x: 0, y: 0, z: 0 };
    terrainVertexNormal(grid, 64, 64, n);
    const a = view.chunkMeshes[0].geometry.getAttribute("normal");
    const i = 64 * 65 + 64;
    expect(a.getX(i)).toBeCloseTo(n.x, 6);
    expect(a.getY(i)).toBeCloseTo(n.y, 6);
    expect(a.getZ(i)).toBeCloseTo(n.z, 6);
  });

  it("chunkAt finds the covering chunk and rejects outside points", () => {
    expect(view.chunkAt(grid.originX + 1, grid.originZ + 1)).toBe(view.chunkMeshes[0]);
    expect(view.chunkAt(grid.originX + 200, grid.originZ + 1)).toBe(view.chunkMeshes[1]);
    expect(view.chunkAt(grid.originX + 258, grid.originZ + 130)).toBe(view.chunkMeshes[5]);
    expect(view.chunkAt(grid.originX - 1, grid.originZ + 1)).toBeUndefined();
    expect(view.chunkAt(grid.originX + 1, grid.originZ + grid.scaleZ + 1)).toBeUndefined();
  });
});

describe("terrain-view rebuild and dispose", () => {
  it("rebuildRegion updates only overlapped chunks", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid));
    const ver = (m: THREE.Mesh) =>
      (m.geometry.getAttribute("position") as THREE.BufferAttribute).version;
    const before = view.chunkMeshes.map(ver);
    grid.heights[terrainIndex(grid, 20, 20)] = 50;
    grid.heights[terrainIndex(grid, 21, 21)] = 50;
    const n = view.rebuildRegion(20, 20, 21, 21, { heights: true });
    expect(n).toBe(1);
    const pos = view.chunkMeshes[0].geometry.getAttribute("position");
    expect(pos.getY(20 * 65 + 20)).toBe(50);
    const after = view.chunkMeshes.map(ver);
    expect(after[0]).toBeGreaterThan(before[0]);
    for (let i = 1; i < 6; i++) expect(after[i]).toBe(before[i]);
  });

  it("an edit on a chunk border rebuilds the neighbour too", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid));
    expect(view.rebuildRegion(10, 64, 11, 64, { heights: true })).toBe(2);
  });

  it("dispose disposes geometries, materials and textures", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid));
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    for (const m of view.chunkMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      spies.push(vi.spyOn(m.geometry, "dispose"));
      spies.push(vi.spyOn(mat, "dispose"));
      if (mat.map) spies.push(vi.spyOn(mat.map, "dispose"));
    }
    view.dispose();
    expect(spies.length).toBe(18);
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});

function texData(view: ReturnType<typeof buildTerrainView>, i: number): THREE.DataTexture {
  return (view.chunkMeshes[i].material as THREE.MeshStandardMaterial).map as THREE.DataTexture;
}

describe("terrain-view paint textures", () => {
  it("near chunks get full-res, far chunks one texel per cell", () => {
    const grid = bumpyGrid(70, 130); // 140 x 260 m
    const view = buildTerrainView(grid, paintFor(grid), { textureRadiusM: 50 });
    expect(texData(view, 0).image.width).toBe(64);
    view.flush(grid.originX + 5, grid.originZ + 5);
    expect(texData(view, 0).image.width).toBe(128); // 64 cells * 2 m / 1 m per px
    expect(texData(view, 0).image.height).toBe(128);
    expect(texData(view, 5).image.width).toBe(2); // far edge chunk: 2 cells wide, one texel per cell
  });

  it("moving the focus away downgrades and disposes the old full-res texture", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid), { textureRadiusM: 50 });
    view.flush(grid.originX + 5, grid.originZ + 5);
    const old = texData(view, 0);
    const spy = vi.spyOn(old, "dispose");
    view.flush(grid.originX + 258, grid.originZ + 130);
    expect(spy).toHaveBeenCalled();
    expect(texData(view, 0).image.width).toBe(64);
    let full = 0;
    for (let i = 0; i < 6; i++) if (texData(view, i).image.width > 64) full++;
    expect(full).toBeLessThanOrEqual(3);
  });

  it("updateTextures rebuilds at most one chunk per call, nearest first", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid), { textureRadiusM: 1000 });
    const fx = grid.originX + 5;
    const fz = grid.originZ + 5;
    expect(view.updateTextures(fx, fz)).toBe(TEXTURE_REBUILDS_PER_CALL);
    expect(texData(view, 0).image.width).toBe(128); // nearest chunk first
    expect(texData(view, 5).image.width).toBeLessThan(64 + 1);
    let guard = 0;
    while (view.updateTextures(fx, fz) > 0 && guard++ < 20) {}
    expect(view.updateTextures(fx, fz)).toBe(0);
  });

  it("hysteresis: 10 m jitter across the radius causes no repeated rebuilds", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid), { textureRadiusM: 50 });
    const fz = grid.originZ + 5;
    const edge = grid.originX + 128 - 50; // radius-distance point left of chunk 1 (starts +128 m)
    view.flush(edge + 5, fz); // 45 m from chunk 1 -> full
    expect(texData(view, 1).image.width).toBe(128);
    for (let k = 0; k < 6; k++) {
      expect(view.flush(edge + (k % 2 === 0 ? 5 : -5), fz)).toBe(0);
    }
    expect(texData(view, 1).image.width).toBe(128);
    // well beyond radius + hysteresis it does drop
    view.flush(edge - TEXTURE_LOD_HYSTERESIS_M - 40, fz);
    expect(texData(view, 1).image.width).toBe(64);
  });

  it("same-size swap reuses the texture and never re-flags the material", () => {
    const grid = createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 1, originX: 0, originZ: 0 });
    const paint = createPaintMap({
      originX: 0,
      originZ: 0,
      widthM: 4,
      depthM: 4,
      metresPerPixel: 1,
      fill: "grass",
    });
    const view = buildTerrainView(grid, paint, { textureRadiusM: 10 });
    const mat = view.chunkMeshes[0].material as THREE.MeshStandardMaterial;
    const before = texData(view, 0);
    const versionBefore = mat.version;
    view.flush(0, 0); // 4 cells at 1 m/px: full and low-res are both 4x4
    expect(texData(view, 0)).toBe(before);
    expect(mat.version).toBe(versionBefore);
  });

  it("paints palette colours and tints road pixels", () => {
    const grid = createTerrainGrid({ rows: 4, cols: 4, cellSizeM: 1, originX: 0, originZ: 0 });
    const paint = createPaintMap({
      originX: 0,
      originZ: 0,
      widthM: 4,
      depthM: 4,
      metresPerPixel: 1,
      fill: "grass",
    });
    paint.data[0] = encodePaintValue("tarmac", true);
    paint.data[1] = encodePaintValue("tarmac", false);
    const view = buildTerrainView(grid, paint);
    view.flush(0, 0);
    const d = texData(view, 0).image.data as unknown as Uint8Array;
    const g = TERRAIN_SURFACE_PALETTE.grass;
    expect([d[8], d[9], d[10]]).toEqual([(g >> 16) & 255, (g >> 8) & 255, g & 255]);
    const t = TERRAIN_SURFACE_PALETTE.tarmac;
    expect([d[4], d[5], d[6]]).toEqual([(t >> 16) & 255, (t >> 8) & 255, t & 255]);
    expect([d[0], d[1], d[2]]).not.toEqual([d[4], d[5], d[6]]);
  });

  it("uses linear filtering and sRGB", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid));
    const t = texData(view, 0);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("paint rebuild re-uploads only overlapped chunk textures", () => {
    const grid = bumpyGrid(70, 130);
    const view = buildTerrainView(grid, paintFor(grid));
    const before = [0, 1, 2, 3, 4, 5].map((i) => texData(view, i).version);
    const n = view.rebuildRegion(10, 10, 12, 12, { paint: true });
    expect(n).toBe(1);
    const after = [0, 1, 2, 3, 4, 5].map((i) => texData(view, i).version);
    expect(after[0]).toBeGreaterThan(before[0]);
    for (let i = 1; i < 6; i++) expect(after[i]).toBe(before[i]);
  });
});

describe("terrain-view edge berm (04.3 D-09)", () => {
  const g = bumpyGrid(20, 20);

  it("without edgeBerm the group children are unchanged", () => {
    const v = buildTerrainView(g, paintFor(g));
    expect(v.group.children.length).toBe(v.chunkMeshes.length);
  });

  it("with edgeBerm adds exactly one merged mesh matching the boxes", () => {
    const boxes = buildEdgeBerm(g);
    const plain = buildTerrainView(g, paintFor(g));
    const v = buildTerrainView(g, paintFor(g), { edgeBerm: boxes });
    expect(v.group.children.length).toBe(plain.group.children.length + 1);
    const berm = v.group.children[v.group.children.length - 1] as THREE.Mesh;
    expect(berm.geometry.getAttribute("position").count).toBe(24 * boxes.length);
    expect(berm.geometry.getIndex()?.count).toBe(36 * boxes.length);
    const bb = berm.geometry.boundingBox;
    expect(bb).not.toBeNull();
    const lo = { x: Infinity, y: Infinity, z: Infinity };
    const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const b of boxes) {
      lo.x = Math.min(lo.x, b.cx - b.hx);
      hi.x = Math.max(hi.x, b.cx + b.hx);
      lo.y = Math.min(lo.y, b.cy - b.hy);
      hi.y = Math.max(hi.y, b.cy + b.hy);
      lo.z = Math.min(lo.z, b.cz - b.hz);
      hi.z = Math.max(hi.z, b.cz + b.hz);
    }
    expect(bb?.min.x).toBeCloseTo(lo.x, 2);
    expect(bb?.max.x).toBeCloseTo(hi.x, 2);
    expect(bb?.min.y).toBeCloseTo(lo.y, 2);
    expect(bb?.max.y).toBeCloseTo(hi.y, 2);
    expect(bb?.min.z).toBeCloseTo(lo.z, 2);
    expect(bb?.max.z).toBeCloseTo(hi.z, 2);
  });

  it("berm mesh receives but does not cast shadow, and dispose frees it", () => {
    const v = buildTerrainView(g, paintFor(g), { edgeBerm: buildEdgeBerm(g) });
    const berm = v.group.children[v.group.children.length - 1] as THREE.Mesh;
    expect(berm.receiveShadow).toBe(true);
    expect(berm.castShadow).toBe(false);
    const geoSpy = vi.spyOn(berm.geometry, "dispose");
    const matSpy = vi.spyOn(berm.material as THREE.Material, "dispose");
    v.dispose();
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
  });
});
