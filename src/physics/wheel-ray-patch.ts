/**
 * Wheel-ray patch: a small, contact-free trimesh that shadows the terrain
 * heightfield around one vehicle so its suspension rays never hit the
 * heightfield's ray-cast bug.
 *
 * The bug (see .planning/debug/wheel-ray-miss-slope-gate.md): Rapier/parry's
 * heightfield ray cast picks the wrong start cell when a ray starts within a
 * few f32 ulps of a cell line, and gives up, so the wheel ray returns "no
 * hit" for one tick (a lost-contact flicker). A trimesh of the same triangles
 * does not have the problem. A trimesh of a whole 2 km map costs ~1 s and
 * ~230 MB, so instead each vehicle carries a fixed window of terrain cells
 * (PATCH_CELLS x PATCH_CELLS) as a trimesh, re-centred when the car nears the
 * window edge.
 *
 * The patch must never create contacts: its collision AND solver groups have
 * membership 2 and an empty filter, so no pair (chassis, bodies, anything)
 * interacts with it. Rapier's vehicle controller ray-cast is called without a
 * group filter, so the wheel rays still see it; the nearest hit of patch and
 * heightfield is identical wherever the heightfield does not miss, because
 * the triangles (heights and diagonal) are the same.
 *
 * Determinism: `update(x, z)` is driven by the chassis position at the fixed
 * physics tick, never by render time.
 *
 * Rebuild: two body+collider slots alternate. A collider created this tick is
 * only guaranteed to be visible to ray queries after the next `world.step()`,
 * so the previous window stays alive until the next rebuild (the re-centre
 * margin is many ticks of travel). Vertex and index buffers are allocated once
 * and reused; only the Rapier objects are created and removed.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. No `three`, DOM,
 * fetch or wall clock.
 */
import * as RAPIER from "@dimforge/rapier3d";
import type { SurfaceType } from "../core/surface-types";
import { TERRAIN_DIAGONAL, type TerrainGrid } from "../core/terrain-grid";
import type { SurfaceMap, SurfacePaintLookup } from "./surface";

/** Window edge, in grid cells. 32 cells = 48 m on a 1.5 m grid, 96 m on a 3 m grid. */
export const PATCH_CELLS = 32;
/** Re-centre when the car is within this many cells of a window edge that is not the grid edge. */
export const PATCH_MARGIN_CELLS = 8;

/** Membership 2, empty filter: interacts with nothing (collision and solver). */
const NO_INTERACTION_GROUPS = (2 << 16) | 0;

/** One terrain collider the patch can shadow, plus how its ground surface is looked up. */
export interface WheelRayPatchTarget {
  readonly grid: TerrainGrid;
  /** Position-based paint lookup of the shadowed heightfield; the patch handle is aliased to it. */
  readonly paint?: SurfacePaintLookup;
  readonly map: SurfaceMap;
  readonly groundSurface: SurfaceType;
}

export interface WheelRayPatch {
  /** Re-centre the window if (x, z) is near its edge. Cheap no-op otherwise. */
  update(x: number, z: number): void;
  /** Number of window builds so far (diagnostics/tests). */
  readonly rebuilds: number;
  /** Remove every collider and body this patch created. */
  dispose(): void;
}

interface Slot {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  target: WheelRayPatchTarget;
}

/** Window origin cell + size for a car at (x, z): pure, exported for tests. */
export function patchWindow(
  grid: TerrainGrid,
  x: number,
  z: number,
): { c0: number; r0: number; cw: number; rw: number } {
  const cellX = grid.scaleX / grid.cols;
  const cellZ = grid.scaleZ / grid.rows;
  const cw = Math.min(PATCH_CELLS, grid.cols);
  const rw = Math.min(PATCH_CELLS, grid.rows);
  const cc = Math.floor((x - grid.originX) / cellX);
  const rc = Math.floor((z - grid.originZ) / cellZ);
  const c0 = Math.max(0, Math.min(grid.cols - cw, cc - (cw >> 1)));
  const r0 = Math.max(0, Math.min(grid.rows - rw, rc - (rw >> 1)));
  return { c0, r0, cw, rw };
}

function inBounds(grid: TerrainGrid, x: number, z: number): boolean {
  return (
    x >= grid.originX &&
    x < grid.originX + grid.scaleX &&
    z >= grid.originZ &&
    z < grid.originZ + grid.scaleZ
  );
}

/**
 * Fill `vertices` (body-local, window centre at the origin) and `indices` for
 * the window. Same triangles as the heightfield: diagonal row0col1-row1col0,
 * normals up.
 */
export function fillPatchMesh(
  grid: TerrainGrid,
  c0: number,
  r0: number,
  cw: number,
  rw: number,
  vertices: Float32Array,
): void {
  if (TERRAIN_DIAGONAL !== "row0col1-row1col0") {
    throw new Error("wheel-ray patch triangulation assumes TERRAIN_DIAGONAL row0col1-row1col0");
  }
  const cellX = grid.scaleX / grid.cols;
  const cellZ = grid.scaleZ / grid.rows;
  const stride = grid.rows + 1;
  const vstride = rw + 1;
  for (let c = 0; c <= cw; c++) {
    const x = (c - cw / 2) * cellX;
    for (let r = 0; r <= rw; r++) {
      const v = (r + c * vstride) * 3;
      vertices[v] = x;
      vertices[v + 1] = grid.heights[r0 + r + (c0 + c) * stride];
      vertices[v + 2] = (r - rw / 2) * cellZ;
    }
  }
}

function buildIndices(cw: number, rw: number): Uint32Array {
  const vstride = rw + 1;
  const indices = new Uint32Array(cw * rw * 6);
  let k = 0;
  for (let c = 0; c < cw; c++) {
    for (let r = 0; r < rw; r++) {
      const p00 = r + c * vstride;
      const p10 = p00 + 1; // +Z
      const p01 = p00 + vstride; // +X
      const p11 = p01 + 1;
      indices[k++] = p00;
      indices[k++] = p10;
      indices[k++] = p01;
      indices[k++] = p11;
      indices[k++] = p01;
      indices[k++] = p10;
    }
  }
  return indices;
}

export function createWheelRayPatch(
  world: RAPIER.World,
  targets: readonly WheelRayPatchTarget[],
): WheelRayPatch {
  const slots: (Slot | undefined)[] = [undefined, undefined];
  let active = -1;
  let target: WheelRayPatchTarget | undefined;
  let curC0 = 0;
  let curR0 = 0;
  let curCw = 0;
  let curRw = 0;
  let rebuilds = 0;
  // Buffers sized for the largest window; index buffers cached per shape.
  let vertices = new Float32Array(0);
  const indexCache = new Map<number, Uint32Array>();

  function release(slot: Slot | undefined): void {
    if (slot === undefined) return;
    slot.target.map.unregister(slot.collider.handle);
    slot.target.paint?.aliasHandles?.delete(slot.collider.handle);
    world.removeRigidBody(slot.body); // removes its attached collider too
  }

  function build(t: WheelRayPatchTarget, win: { c0: number; r0: number; cw: number; rw: number }) {
    const { grid } = t;
    const need = (win.cw + 1) * (win.rw + 1) * 3;
    if (vertices.length < need) vertices = new Float32Array(need);
    fillPatchMesh(grid, win.c0, win.r0, win.cw, win.rw, vertices);
    const key = win.cw * 65536 + win.rw;
    let indices = indexCache.get(key);
    if (indices === undefined) {
      indices = buildIndices(win.cw, win.rw);
      indexCache.set(key, indices);
    }
    const cellX = grid.scaleX / grid.cols;
    const cellZ = grid.scaleZ / grid.rows;
    const next = 1 - Math.max(active, 0);
    release(slots[next]);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        grid.originX + (win.c0 + win.cw / 2) * cellX,
        0,
        grid.originZ + (win.r0 + win.rw / 2) * cellZ,
      ),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices.subarray(0, need), indices)
        .setCollisionGroups(NO_INTERACTION_GROUPS)
        .setSolverGroups(NO_INTERACTION_GROUPS),
      body,
    );
    t.map.register(collider.handle, t.groundSurface);
    t.paint?.aliasHandles?.add(collider.handle);
    slots[next] = { body, collider, target: t };
    active = next;
    target = t;
    curC0 = win.c0;
    curR0 = win.r0;
    curCw = win.cw;
    curRw = win.rw;
    rebuilds++;
  }

  return {
    get rebuilds(): number {
      return rebuilds;
    },
    update(x: number, z: number): void {
      let t = target;
      if (t === undefined || !inBounds(t.grid, x, z)) {
        const found = targets.find((c) => inBounds(c.grid, x, z));
        if (found === undefined) return; // off every grid: keep what we have
        if (found !== t) {
          t = found;
          build(t, patchWindow(t.grid, x, z));
          return;
        }
      }
      if (t === undefined) return;
      const g = t.grid;
      const cc = Math.floor((x - g.originX) / (g.scaleX / g.cols));
      const rc = Math.floor((z - g.originZ) / (g.scaleZ / g.rows));
      const nearLow = (c: number, lo: number) => lo > 0 && c - lo < PATCH_MARGIN_CELLS;
      const nearHigh = (c: number, lo: number, w: number, n: number) =>
        lo + w < n && lo + w - c < PATCH_MARGIN_CELLS;
      if (
        nearLow(cc, curC0) ||
        nearHigh(cc, curC0, curCw, g.cols) ||
        nearLow(rc, curR0) ||
        nearHigh(rc, curR0, curRw, g.rows)
      ) {
        build(t, patchWindow(g, x, z));
      }
    },
    dispose(): void {
      release(slots[0]);
      release(slots[1]);
      slots[0] = undefined;
      slots[1] = undefined;
      active = -1;
      target = undefined;
    },
  };
}
