/**
 * Chunked terrain render view (04.2 plan 04).
 *
 * One THREE.Mesh per TERRAIN_CHUNK_CELLS x TERRAIN_CHUNK_CELLS cells. Triangles
 * split every quad along TERRAIN_DIAGONAL so they are exactly the triangles
 * Rapier collides with; vertex heights are the grid heights verbatim, and
 * normals come from the GLOBAL grid (central differences) so neighbouring
 * chunks agree on border vertices (no seams).
 *
 * Paint is shown through per-chunk DataTextures: full resolution only within
 * `textureRadiusM` of the focus, one texel per cell elsewhere (VRAM bound,
 * T-04.2-10). Stock MeshStandardMaterial only; no custom shaders.
 *
 * Layering: reads sim data only; imports three + pure src/core, never Rapier.
 */
import * as THREE from "three";
import { type AuthoredCrest, buildCrestGeometry } from "../core/crest-geometry.ts";
import { sampleHeightfieldBilinear } from "../core/heightfield-sample.ts";
import type { SurfaceType } from "../core/surface-types.ts";
import {
  TERRAIN_DIAGONAL,
  type TerrainGrid,
  type TerrainVec3,
  terrainIndex,
  terrainVertexNormal,
} from "../core/terrain-grid.ts";
import {
  decodePaintSurface,
  PAINT_ROAD_FLAG,
  type PaintMap,
  paintIndexAt,
} from "../core/terrain-paint.ts";

export const TERRAIN_CHUNK_CELLS = 64;

/** UI-SPEC surface colours. */
export const TERRAIN_SURFACE_PALETTE: Readonly<Record<SurfaceType, number>> = {
  tarmac: 0x8d939c,
  gravel: 0xc9b27a,
  dirt_road: 0xa8743f,
  grass: 0x5da04a,
  sand: 0xe6d58a,
  mud: 0x5b4330,
};

const ROAD_TINT_HEX = 0x3a3d42;
const ROAD_TINT_AMOUNT = 0.35;
const DEFAULT_TEXTURE_RADIUS_M = 600;

export interface TerrainView {
  readonly group: THREE.Group;
  readonly chunkMeshes: readonly THREE.Mesh[];
  /** Authored crest meshes. NOT added to `group` (caller decides), mirrors MapWorldView. */
  readonly crestMeshes: readonly THREE.Mesh[];
  chunkAt(x: number, z: number): THREE.Mesh | undefined;
  /** Rebuilds only the chunks overlapping the (inclusive) cell region; returns how many. */
  rebuildRegion(
    minRow: number,
    minCol: number,
    maxRow: number,
    maxCol: number,
    what: { heights?: boolean; paint?: boolean },
  ): number;
  updateTextures(focusX: number, focusZ: number): void;
  dispose(): void;
}

interface Chunk {
  readonly mesh: THREE.Mesh;
  readonly row0: number;
  readonly col0: number;
  readonly row1: number; // inclusive vertex row
  readonly col1: number; // inclusive vertex col
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  texture: THREE.DataTexture;
  full: boolean;
}

function hexChannels(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function ranges(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && b0 <= a1;
}

export function buildTerrainView(
  grid: TerrainGrid,
  paint: PaintMap,
  opts: {
    chunkCells?: number;
    palette?: Partial<Record<SurfaceType, number>>;
    textureRadiusM?: number;
    crests?: readonly AuthoredCrest[];
  } = {},
): TerrainView {
  const chunkCells = opts.chunkCells ?? TERRAIN_CHUNK_CELLS;
  const radius = opts.textureRadiusM ?? DEFAULT_TEXTURE_RADIUS_M;
  const palette: Record<SurfaceType, number> = { ...TERRAIN_SURFACE_PALETTE, ...opts.palette };
  const cell = grid.cellSizeM;
  const chunksR = Math.ceil(grid.rows / chunkCells);
  const chunksC = Math.ceil(grid.cols / chunkCells);

  // value (0..255) -> rgb lookup, road flag tinted toward the road colour.
  const lut = new Uint8Array(256 * 3);
  const tint = hexChannels(ROAD_TINT_HEX);
  for (let v = 0; v < 256; v++) {
    const surface = decodePaintSurface(v);
    const base = hexChannels(palette[surface]);
    const road = (v & PAINT_ROAD_FLAG) !== 0;
    for (let k = 0; k < 3; k++) {
      lut[v * 3 + k] = Math.round(
        road ? base[k] + (tint[k] - base[k]) * ROAD_TINT_AMOUNT : base[k],
      );
    }
  }

  const group = new THREE.Group();
  const chunks: Chunk[] = [];
  const normalScratch: TerrainVec3 = { x: 0, y: 1, z: 0 };

  function fillGeometry(chunk: Chunk, geo: THREE.BufferGeometry, includeStatic: boolean): void {
    const nr = chunk.row1 - chunk.row0;
    const nc = chunk.col1 - chunk.col0;
    const vCount = (nr + 1) * (nc + 1);
    if (includeStatic) {
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(vCount * 3), 3));
      const uv = new Float32Array(vCount * 2);
      for (let lr = 0; lr <= nr; lr++) {
        for (let lc = 0; lc <= nc; lc++) {
          const i = lr * (nc + 1) + lc;
          uv[i * 2] = (lc * cell) / (nc * cell);
          uv[i * 2 + 1] = (lr * cell) / (nr * cell);
        }
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      const idx = new Uint32Array(nr * nc * 6);
      let o = 0;
      for (let lr = 0; lr < nr; lr++) {
        for (let lc = 0; lc < nc; lc++) {
          const a = lr * (nc + 1) + lc; // row0 col0
          const b = a + 1; // row0 col1 (+X)
          const c = a + (nc + 1); // row1 col0 (+Z)
          const d = c + 1; // row1 col1
          // Diagonal row0col1-row1col0 (TERRAIN_DIAGONAL), CCW from +Y.
          if (TERRAIN_DIAGONAL === "row0col1-row1col0") {
            idx[o++] = a;
            idx[o++] = c;
            idx[o++] = b;
            idx[o++] = b;
            idx[o++] = c;
            idx[o++] = d;
          } else {
            idx[o++] = a;
            idx[o++] = c;
            idx[o++] = d;
            idx[o++] = a;
            idx[o++] = d;
            idx[o++] = b;
          }
        }
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
    const pa = pos.array as Float32Array;
    const na = nrm.array as Float32Array;
    for (let lr = 0; lr <= nr; lr++) {
      for (let lc = 0; lc <= nc; lc++) {
        const row = chunk.row0 + lr;
        const col = chunk.col0 + lc;
        const i = (lr * (nc + 1) + lc) * 3;
        pa[i] = grid.originX + col * cell;
        pa[i + 1] = grid.heights[terrainIndex(grid, row, col)];
        pa[i + 2] = grid.originZ + row * cell;
        terrainVertexNormal(grid, row, col, normalScratch);
        na[i] = normalScratch.x;
        na[i + 1] = normalScratch.y;
        na[i + 2] = normalScratch.z;
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  }

  function makeTexture(
    chunk: Chunk,
    full: boolean,
    existing?: THREE.DataTexture,
  ): THREE.DataTexture {
    const nr = chunk.row1 - chunk.row0;
    const nc = chunk.col1 - chunk.col0;
    const w = full ? Math.max(1, Math.ceil((nc * cell) / paint.metresPerPixel)) : nc;
    const h = full ? Math.max(1, Math.ceil((nr * cell) / paint.metresPerPixel)) : nr;
    let tex = existing;
    if (tex === undefined) {
      tex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
    }
    const data = tex.image.data as unknown as Uint8Array;
    const stepX = (nc * cell) / w;
    const stepZ = (nr * cell) / h;
    for (let j = 0; j < h; j++) {
      const z = chunk.z0 + (j + 0.5) * stepZ;
      for (let i = 0; i < w; i++) {
        const x = chunk.x0 + (i + 0.5) * stepX;
        const pi = paintIndexAt(paint, x, z);
        const v = pi < 0 ? 0 : paint.data[pi];
        const o = (j * w + i) * 4;
        data[o] = lut[v * 3];
        data[o + 1] = lut[v * 3 + 1];
        data[o + 2] = lut[v * 3 + 2];
        data[o + 3] = 255;
      }
    }
    tex.needsUpdate = true;
    return tex;
  }

  for (let cr = 0; cr < chunksR; cr++) {
    for (let cc = 0; cc < chunksC; cc++) {
      const row0 = cr * chunkCells;
      const col0 = cc * chunkCells;
      const row1 = Math.min(row0 + chunkCells, grid.rows);
      const col1 = Math.min(col0 + chunkCells, grid.cols);
      const geo = new THREE.BufferGeometry();
      const material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      const chunk: Chunk = {
        mesh,
        row0,
        col0,
        row1,
        col1,
        x0: grid.originX + col0 * cell,
        x1: grid.originX + col1 * cell,
        z0: grid.originZ + row0 * cell,
        z1: grid.originZ + row1 * cell,
        texture: undefined as unknown as THREE.DataTexture,
        full: false,
      };
      fillGeometry(chunk, geo, true);
      chunk.texture = makeTexture(chunk, false);
      material.map = chunk.texture;
      chunks.push(chunk);
      group.add(mesh);
    }
  }

  // Crest meshes (flat-shaded domes seated on the same terrain), not in `group`.
  const crestMeshes: THREE.Mesh[] = [];
  if (opts.crests !== undefined && opts.crests.length > 0) {
    const entries = buildCrestGeometry(opts.crests, (x, z) =>
      sampleHeightfieldBilinear(grid, x, z),
    );
    for (const entry of entries) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(entry.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(entry.indices, 1));
      geo.setAttribute("normal", new THREE.BufferAttribute(faceWeightedNormals(entry), 3));
      geo.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({
        color: palette[entry.surface] ?? palette.grass,
        roughness: 0.95,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      crestMeshes.push(mesh);
    }
  }

  let lastFocus: { x: number; z: number } | undefined;

  function applyTextureLod(chunk: Chunk, full: boolean): void {
    const material = chunk.mesh.material as THREE.MeshStandardMaterial;
    chunk.texture.dispose();
    chunk.texture = makeTexture(chunk, full);
    chunk.full = full;
    material.map = chunk.texture;
    material.needsUpdate = true;
  }

  function isNear(chunk: Chunk, fx: number, fz: number): boolean {
    const dx = Math.max(chunk.x0 - fx, 0, fx - chunk.x1);
    const dz = Math.max(chunk.z0 - fz, 0, fz - chunk.z1);
    return dx * dx + dz * dz <= radius * radius;
  }

  return {
    group,
    chunkMeshes: chunks.map((c) => c.mesh),
    crestMeshes,
    chunkAt(x: number, z: number): THREE.Mesh | undefined {
      if (!(x >= grid.originX && x <= grid.originX + grid.scaleX)) return undefined;
      if (!(z >= grid.originZ && z <= grid.originZ + grid.scaleZ)) return undefined;
      const col = Math.min(Math.floor((x - grid.originX) / cell), grid.cols - 1);
      const row = Math.min(Math.floor((z - grid.originZ) / cell), grid.rows - 1);
      const cc = Math.floor(col / chunkCells);
      const cr = Math.floor(row / chunkCells);
      return chunks[cr * chunksC + cc]?.mesh;
    },
    rebuildRegion(minRow, minCol, maxRow, maxCol, what): number {
      let count = 0;
      for (const chunk of chunks) {
        const hit =
          what.heights === true &&
          ranges(chunk.row0, chunk.row1, minRow - 1, maxRow + 1) &&
          ranges(chunk.col0, chunk.col1, minCol - 1, maxCol + 1);
        const paintHit =
          what.paint === true &&
          ranges(chunk.row0, chunk.row1 - 1, minRow, maxRow) &&
          ranges(chunk.col0, chunk.col1 - 1, minCol, maxCol);
        if (!hit && !paintHit) continue;
        if (hit) fillGeometry(chunk, chunk.mesh.geometry, false);
        if (paintHit) makeTexture(chunk, chunk.full, chunk.texture);
        count++;
      }
      return count;
    },
    updateTextures(focusX: number, focusZ: number): void {
      lastFocus = { x: focusX, z: focusZ };
      for (const chunk of chunks) {
        const near = isNear(chunk, lastFocus.x, lastFocus.z);
        if (near !== chunk.full) applyTextureLod(chunk, near);
      }
    },
    dispose(): void {
      for (const chunk of chunks) {
        chunk.mesh.geometry.dispose();
        const material = chunk.mesh.material as THREE.MeshStandardMaterial;
        material.dispose();
        chunk.texture.dispose();
      }
      for (const mesh of crestMeshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    },
  };
}

/** Area-weighted vertex normals for crest entries (CCW-from-+Y winding). */
function faceWeightedNormals(entry: {
  positions: Float32Array;
  indices: Uint32Array;
}): Float32Array {
  const p = entry.positions;
  const n = new Float32Array(p.length);
  const idx = entry.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= len;
    n[i + 1] /= len;
    n[i + 2] /= len;
  }
  return n;
}
