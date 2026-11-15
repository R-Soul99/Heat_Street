// Pure start-point operations (07.1.3 D-03). No DOM, no three. Every function
// returns a new array and never mutates its input or the elements in it (undo
// snapshots share element objects).

import {
  MAX_START_NAME_CHARS,
  MAX_START_POINTS,
  type TerrainStartPoint,
} from "../../src/core/terrain-format.ts";

export type StartList = readonly TerrainStartPoint[];

const START_ID = /^start-(\d+)$/;

/** Next id counter: max numeric suffix + 1. The counter lives in editor state, never in the file. */
export function startIdSeed(list: StartList): number {
  let max = 0;
  for (const s of list) {
    const m = START_ID.exec(s.id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export type AddResult =
  | { list: TerrainStartPoint[]; nextSeed: number; error?: undefined }
  | { error: string; list?: undefined; nextSeed?: undefined };

export function addStartPoint(
  list: StartList,
  seed: number,
  x: number,
  z: number,
  headingRad: number,
): AddResult {
  if (list.length >= MAX_START_POINTS) {
    return { error: `A map can have at most ${MAX_START_POINTS} start points` };
  }
  const entry: TerrainStartPoint = { id: `start-${seed}`, name: `Start ${seed}`, x, z, headingRad };
  return { list: [...list, entry], nextSeed: seed + 1 };
}

export function removeStartPoint(list: StartList, id: string): StartList {
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return list;
  return list.filter((_, k) => k !== i);
}

function replaceAt(list: StartList, id: string, patch: Partial<TerrainStartPoint>): StartList {
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return list;
  return list.map((s, k) => (k === i ? { ...s, ...patch } : s));
}

export function moveStartPoint(list: StartList, id: string, x: number, z: number): StartList {
  return replaceAt(list, id, { x, z });
}

export function turnStartPoint(list: StartList, id: string, headingRad: number): StartList {
  return replaceAt(list, id, { headingRad });
}

/** Trims; empty or over-long names are rejected (same array reference returned). */
export function renameStartPoint(list: StartList, id: string, name: string): StartList {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_START_NAME_CHARS) return list;
  return replaceAt(list, id, { name: trimmed });
}

/** The first entry is the default (D-03). */
export function makeDefault(list: StartList, id: string): StartList {
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return list;
  return [list[i], ...list.filter((_, k) => k !== i)];
}

export function defaultStartPoint(list: StartList): TerrainStartPoint | undefined {
  return list[0];
}
