/**
 * Pure scale / placement maths and graph -> raw-OSM-way conversion for the
 * editor's B&W image import. Imported roads are ordinary editable ways in the
 * editor's roads envelope (same tag shape as drawn roads); nothing here knows
 * about the DOM or the compiler.
 *
 * Image frame: row 0 at the top = north. World frame (Phase 1): x east, y north,
 * origin at the world's south-west corner.
 */

import type { RoadGraphPx } from "./image-trace.ts";
import { nextNodeId, nextWayId, type Surface, setSurface } from "./model.ts";
import {
  type LatLon,
  MAX_WORLD_KM,
  MIN_WORLD_KM,
  type Projector,
  type RawEnvelope,
  type RawWay,
} from "./world.ts";

/** Above this many metres per pixel the picture is too coarse (plan: aim for 1 to 2). */
export const COARSE_M_PER_PX = 2;

export interface ImportScale {
  widthM: number;
  heightM: number;
  mPerPx: number;
  coarse: boolean;
  warnings: string[];
}

/** Exactly one of `widthKm` / `mPerPx` drives; height is always derived (aspect locked). */
export function importScale(input: {
  imageW: number;
  imageH: number;
  widthKm?: number;
  mPerPx?: number;
}): ImportScale {
  const { imageW, imageH } = input;
  if (!(Number.isFinite(imageW) && imageW > 0 && Number.isFinite(imageH) && imageH > 0)) {
    throw new Error("image size must be positive");
  }
  let mPerPx: number;
  if (input.widthKm !== undefined) {
    if (!(Number.isFinite(input.widthKm) && input.widthKm > 0))
      throw new Error("width must be a positive number of km");
    mPerPx = (input.widthKm * 1000) / imageW;
  } else if (input.mPerPx !== undefined) {
    if (!(Number.isFinite(input.mPerPx) && input.mPerPx > 0))
      throw new Error("m per pixel must be positive");
    mPerPx = input.mPerPx;
  } else {
    throw new Error("give either a width in km or metres per pixel");
  }
  const coarse = mPerPx > COARSE_M_PER_PX;
  const warnings: string[] = [];
  if (coarse) {
    warnings.push(
      `coarse: ${mPerPx.toFixed(2)} m/px is above ${COARSE_M_PER_PX} m/px; corners will look blocky. Use a larger picture or a smaller width.`,
    );
  }
  return { widthM: imageW * mPerPx, heightM: imageH * mPerPx, mPerPx, coarse, warnings };
}

const num3 = (x: number): string => String(Number(x.toFixed(3)));

/**
 * Plans a fresh map for an imported image: width is chosen, height follows the
 * image aspect. Never throws; problems come back as readable `errors`.
 */
export function planImportWorld(
  imageW: number,
  imageH: number,
  widthKm: number,
): { widthKm: number; heightKm: number; mPerPx: number; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  if (!(Number.isFinite(widthKm) && widthKm > 0)) {
    return { widthKm: 0, heightKm: 0, mPerPx: 0, errors: ["Enter a width in km."], warnings: [] };
  }
  let scale: ImportScale;
  try {
    scale = importScale({ imageW, imageH, widthKm });
  } catch (e) {
    return {
      widthKm,
      heightKm: 0,
      mPerPx: 0,
      errors: [e instanceof Error ? e.message : String(e)],
      warnings: [],
    };
  }
  const heightKm = scale.heightM / 1000;
  if (widthKm < MIN_WORLD_KM || widthKm > MAX_WORLD_KM) {
    errors.push(`Width must be between ${MIN_WORLD_KM} and ${MAX_WORLD_KM} km.`);
  }
  if (heightKm < MIN_WORLD_KM) {
    const need = Math.ceil(((MIN_WORLD_KM * imageW) / imageH) * 1000) / 1000;
    errors.push(
      `Height from the image would be ${num3(heightKm)} km; maps must be ${MIN_WORLD_KM} to ${MAX_WORLD_KM} km. Use a wider Width (at least ${num3(need)} km) or a taller image.`,
    );
  } else if (heightKm > MAX_WORLD_KM) {
    const most = Math.floor(((MAX_WORLD_KM * imageW) / imageH) * 1000) / 1000;
    errors.push(
      `Height from the image would be ${num3(heightKm)} km; maps must be ${MIN_WORLD_KM} to ${MAX_WORLD_KM} km. Use a narrower Width (at most ${num3(most)} km) or a shorter image.`,
    );
  }
  return { widthKm, heightKm, mPerPx: scale.mPerPx, errors, warnings: scale.warnings };
}

/** Warns when the placed image footprint does not fit inside the world. */
export function footprintWarnings(
  scale: Pick<ImportScale, "widthM" | "heightM">,
  offset: { x: number; y: number },
  world: { widthM: number; heightM: number },
): string[] {
  const out: string[] = [];
  if (offset.x < 0 || offset.y < 0)
    out.push("offset is negative: part of the picture lies outside the world");
  const overX = offset.x + scale.widthM - world.widthM;
  const overY = offset.y + scale.heightM - world.heightM;
  if (overX > 1e-6)
    out.push(`picture is ${overX.toFixed(0)} m wider than the world from this offset`);
  if (overY > 1e-6)
    out.push(`picture is ${overY.toFixed(0)} m taller than the world from this offset`);
  return out;
}

/** Pixel position (y down) to world metres (y north). Offset {0,0} = SW corner. */
export function pixelToWorld(
  p: { x: number; y: number },
  imageH: number,
  mPerPx: number,
  offset: { x: number; y: number },
): { x: number; y: number } {
  return { x: offset.x + p.x * mPerPx, y: offset.y + (imageH - p.y) * mPerPx };
}

export interface ImportRoadOptions {
  widthM: number;
  highway: string;
  surface: Surface;
}

export const DEFAULT_IMPORT_ROAD: ImportRoadOptions = {
  widthM: 8,
  highway: "residential",
  surface: "tarmac",
};

/**
 * Appends the traced graph to `roads` as raw ways. Graph nodes get one raw node
 * id each, shared by every way meeting there (that is the junction). Additive:
 * nothing is snapped to pre-existing roads.
 */
export function appendImportedRoads(
  roads: RawEnvelope,
  proj: Projector,
  graph: RoadGraphPx,
  place: { imageH: number; mPerPx: number; offset: { x: number; y: number } },
  opts: ImportRoadOptions = DEFAULT_IMPORT_ROAD,
): RawWay[] {
  let nodeId = nextNodeId(roads);
  let wayId = nextWayId(roads);
  const shared = new Map<number, number>();
  for (const n of graph.nodes) shared.set(n.id, nodeId++);
  const created: RawWay[] = [];
  for (const path of graph.paths) {
    const nodes: number[] = [];
    const geometry: LatLon[] = [];
    let last: { x: number; y: number } | null = null;
    path.points.forEach((pt, i) => {
      const w = pixelToWorld(pt, place.imageH, place.mPerPx, place.offset);
      if (last && Math.hypot(w.x - last.x, w.y - last.y) < 1e-6) return; // consecutive duplicate
      last = w;
      const isEnd = i === 0 || i === path.points.length - 1;
      const id =
        i === 0
          ? shared.get(path.a)
          : i === path.points.length - 1
            ? shared.get(path.b)
            : undefined;
      nodes.push(isEnd && id !== undefined ? id : nodeId++);
      geometry.push(proj.toLatLon(w));
    });
    if (geometry.length < 2) continue;
    // A dropped duplicate end point must still land on the shared junction node.
    nodes[0] = shared.get(path.a) as number;
    nodes[nodes.length - 1] = shared.get(path.b) as number;
    const way: RawWay = {
      type: "way",
      id: wayId++,
      nodes,
      geometry,
      tags: { highway: opts.highway, width: String(opts.widthM) },
    };
    setSurface(way, opts.surface);
    roads.response.elements.push(way);
    created.push(way);
  }
  return created;
}
