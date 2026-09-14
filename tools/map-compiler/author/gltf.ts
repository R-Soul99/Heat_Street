/**
 * glTF document assembly + `.glb` emit stage: turns `buildRoadGeometry`'s
 * per-edge/per-junction ribbon geometry (`src/core/road-geometry.ts`) plus
 * `geometry/building-box.ts`'s building prisms into one binary `.glb`, split
 * into one primitive per surface type PRESENT plus one buildings primitive
 * (D-P19) — never merged into a single render mesh, so the runtime can
 * address each surface's mesh by name (plan 04-09's loader, and Phase 3's
 * `createSurfaceFx`'s `(meshes[], surfaces[])` skid-decal contract).
 *
 * D-P21 — no mesh compression in v1: only `@gltf-transform/core` is used to
 * ASSEMBLE and SERIALISE the document; `@gltf-transform/functions` (also
 * installed, per this plan's Task 1 checkpoint) is not called anywhere in
 * this file. It exists in `package.json` for a future optimisation pass, not
 * this one — a ~3km road network of flat ribbons plus placeholder building
 * boxes is a small mesh, and compression would add a decoder dependency at
 * runtime for no measured benefit yet.
 *
 * Layering: this file DOES import `@gltf-transform/core` and `node:fs`,
 * unlike `src/core/road-geometry.ts` — that is expected and correct.
 * `tools/map-compiler/**` is the offline compiler tier, not `src/core/`, and
 * `tests/layering.test.ts` does not scan `tools/**`. This file itself must
 * never be imported from `src/**` (the browser runtime loads the compiled
 * `.glb` by URL via `GLTFLoader`, never this authoring module).
 */
import { writeFile } from "node:fs/promises";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import type {
  EdgeGeometryEntry,
  JunctionGeometryEntry,
  RoadGeometry,
} from "../../../src/core/road-geometry.ts";
import { SURFACE_TYPES, type SurfaceType } from "../../../src/core/surface-types.ts";
import type { BuildingBox } from "../geometry/building-box.ts";

/**
 * First-pass per-surface base colours, chosen to read at helicopter-cam
 * distance. [ASSUMED] — deliberately identical to `src/render/surface-view.ts`'s
 * `COLOUR_*` constants (Phase 3's debug-scene surface planes), so the real
 * compiled `.glb` doesn't introduce a SECOND, independently-guessed palette
 * on top of the one already shipped. Both are flagged for confirmation
 * against `src/render/surface-fx.ts`'s `SURFACE_FX_PROFILES` in the plan
 * 04-11 feel session — see this plan's own `<action>` text.
 */
const SURFACE_COLOR_HEX: Readonly<Record<SurfaceType, number>> = {
  tarmac: 0x2b2b33,
  gravel: 0xa89a78,
  dirt_road: 0x8a6a4a,
  grass: 0x3f6b3a,
  sand: 0xd9c48f,
  mud: 0x4a3626,
};

/** [ASSUMED] identical to `src/render/surface-view.ts`'s `COLOUR_BUILDING` — see `SURFACE_COLOR_HEX`'s own comment. */
const BUILDING_COLOR_HEX = 0x6b6f7a;

function hexToRgba(hex: number): [number, number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return [r, g, b, 1];
}

/**
 * `@gltf-transform/core`'s `TypedArray` union requires the `ArrayBuffer`
 * generic specifically (not the wider, default `ArrayBufferLike`
 * `src/core/road-geometry.ts` and `geometry/building-box.ts` declare their
 * own `Float32Array`/`Uint32Array` fields as). Every array these two modules
 * actually construct (`new Float32Array(n)`, `new Uint32Array(n)`) is
 * genuinely backed by a real `ArrayBuffer`, never a `SharedArrayBuffer` — so
 * the narrowing casts at this file's two call sites below are safe, not a
 * type-safety hole.
 */
interface GeometryEntry {
  readonly positions: Float32Array<ArrayBuffer>;
  readonly indices: Uint32Array<ArrayBuffer>;
}

/** Per-surface triangle count, exposed for `cli.ts`'s printed summary and the SUMMARY.md record. */
export interface GltfBuildStats {
  readonly trianglesBySurface: Readonly<Partial<Record<SurfaceType, number>>>;
  readonly buildingCount: number;
  readonly buildingTriangleCount: number;
}

/**
 * Concatenates a surface's edge/junction geometry entries into one merged
 * buffer, rebasing each entry's own indices by the running vertex count as
 * it goes — the one genuinely error-prone step here (the "triangles fanning
 * to the origin" symptom of getting this wrong), verified directly in
 * `gltf.test.ts` by asserting a merged primitive's maximum index equals its
 * vertex count minus one.
 */
function concatGeometry(entries: readonly GeometryEntry[]): GeometryEntry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const entry of entries) {
    totalVerts += entry.positions.length / 3;
    totalIndices += entry.indices.length;
  }

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let posCursor = 0;
  let idxCursor = 0;
  for (const entry of entries) {
    positions.set(entry.positions, posCursor);
    posCursor += entry.positions.length;

    for (let i = 0; i < entry.indices.length; i++) {
      indices[idxCursor + i] = entry.indices[i] + vertexOffset;
    }
    idxCursor += entry.indices.length;

    vertexOffset += entry.positions.length / 3;
  }

  return { positions, indices };
}

/** Groups every edge AND junction geometry entry by its own `surface`, preserving `SURFACE_TYPES` iteration order downstream. */
function groupBySurface(geometry: RoadGeometry): Map<SurfaceType, GeometryEntry[]> {
  const bySurface = new Map<SurfaceType, GeometryEntry[]>();

  const pushEntry = (surface: SurfaceType, entry: GeometryEntry): void => {
    const list = bySurface.get(surface);
    if (list === undefined) {
      bySurface.set(surface, [entry]);
    } else {
      list.push(entry);
    }
  };

  for (const edge of geometry.edges as readonly EdgeGeometryEntry[]) {
    pushEntry(edge.surface, {
      positions: edge.positions as Float32Array<ArrayBuffer>,
      indices: edge.indices as Uint32Array<ArrayBuffer>,
    });
  }
  for (const junction of geometry.junctions as readonly JunctionGeometryEntry[]) {
    pushEntry(junction.surface, {
      positions: junction.positions as Float32Array<ArrayBuffer>,
      indices: junction.indices as Uint32Array<ArrayBuffer>,
    });
  }

  return bySurface;
}

/**
 * Builds the full glTF `Document`: one `roads-<surface>` mesh per surface
 * type PRESENT in `geometry` (never one for an absent surface), plus one
 * `buildings` mesh when `boxes` is non-empty. Every mesh's containing node
 * shares its exact name (D-P19's own reasoning — `GLTFLoader` surfaces node
 * names, and plan 04-09's loader looks meshes up by name). All node
 * transforms stay at their default identity — geometry is authored directly
 * in world-space local ENU metres, matching the `.map.json` exactly, so the
 * runtime never applies an offset. No extensions are used (D-P21).
 */
export function buildGltfDocument(
  geometry: RoadGeometry,
  boxes: readonly BuildingBox[],
): { document: Document; stats: GltfBuildStats } {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene("scene");

  const bySurface = groupBySurface(geometry);
  const trianglesBySurface: Partial<Record<SurfaceType, number>> = {};

  for (const surface of SURFACE_TYPES) {
    const entries = bySurface.get(surface);
    if (entries === undefined || entries.length === 0) continue;

    const { positions, indices } = concatGeometry(entries);

    const positionAccessor = document
      .createAccessor(`roads-${surface}-position`)
      .setType(Accessor.Type.VEC3)
      .setArray(positions)
      .setBuffer(buffer);
    const indexAccessor = document
      .createAccessor(`roads-${surface}-index`)
      .setType(Accessor.Type.SCALAR)
      .setArray(indices)
      .setBuffer(buffer);

    const material = document
      .createMaterial(`surface-${surface}`)
      .setBaseColorFactor(hexToRgba(SURFACE_COLOR_HEX[surface]));

    const primitive = document
      .createPrimitive()
      .setAttribute("POSITION", positionAccessor)
      .setIndices(indexAccessor)
      .setMaterial(material);

    const meshName = `roads-${surface}`;
    const mesh = document.createMesh(meshName).addPrimitive(primitive);
    const node = document.createNode(meshName).setMesh(mesh);
    scene.addChild(node);

    trianglesBySurface[surface] = indices.length / 3;
  }

  let buildingTriangleCount = 0;
  if (boxes.length > 0) {
    const { positions, indices } = concatGeometry(
      boxes.map((box) => ({
        positions: box.positions as Float32Array<ArrayBuffer>,
        indices: box.indices as Uint32Array<ArrayBuffer>,
      })),
    );

    const positionAccessor = document
      .createAccessor("buildings-position")
      .setType(Accessor.Type.VEC3)
      .setArray(positions)
      .setBuffer(buffer);
    const indexAccessor = document
      .createAccessor("buildings-index")
      .setType(Accessor.Type.SCALAR)
      .setArray(indices)
      .setBuffer(buffer);

    const material = document
      .createMaterial("buildings")
      .setBaseColorFactor(hexToRgba(BUILDING_COLOR_HEX));

    const primitive = document
      .createPrimitive()
      .setAttribute("POSITION", positionAccessor)
      .setIndices(indexAccessor)
      .setMaterial(material);

    const mesh = document.createMesh("buildings").addPrimitive(primitive);
    const node = document.createNode("buildings").setMesh(mesh);
    scene.addChild(node);

    buildingTriangleCount = indices.length / 3;
  }

  document.getRoot().setDefaultScene(scene);

  return {
    document,
    stats: {
      trianglesBySurface,
      buildingCount: boxes.length,
      buildingTriangleCount,
    },
  };
}

/** Serialises `document` to a `.glb` and writes it to `filePath`, creating no intermediate directories (the caller's job — mirrors `cli.ts`'s own `mkdir` call before its `.map.json` write). */
export async function writeGlb(document: Document, filePath: string): Promise<void> {
  const io = new NodeIO();
  const bytes = await io.writeBinary(document);
  await writeFile(filePath, bytes);
}
