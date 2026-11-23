// Pure road-route draft operations (Phase 10, D-11). No DOM, no three. Mirrors
// stages.ts: every function returns a new array, never mutates input or its
// elements, and no-ops return the SAME list reference.

import {
  COURSE_CHECKPOINTS_MAX,
  type CourseMode,
  LAPS_MAX,
  LAPS_MIN,
  MAX_COURSES,
} from "../../src/core/course.ts";
import type { RouteDraft } from "../../src/core/route-draft.ts";

export type RouteList = readonly RouteDraft[];

export const MAX_ROUTE_NAME_LENGTH = 60;
export const DEFAULT_CIRCUIT_LAPS = 3;

const ROUTE_SUFFIX = /-route-(\d+)$/;
const CP_SUFFIX = /-cp-(\d+)$/;

function seedOf(ids: readonly string[], pattern: RegExp): number {
  let max = 0;
  for (const id of ids) {
    const m = pattern.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function routeIdSeed(list: RouteList): number {
  return seedOf(
    list.map((r) => r.id),
    ROUTE_SUFFIX,
  );
}

export function checkpointIdSeed(draft: RouteDraft): number {
  return seedOf(
    draft.checkpoints.map((c) => c.id),
    CP_SUFFIX,
  );
}

export type NewRouteResult =
  | { list: RouteDraft[]; id: string; nextSeed: number; error?: undefined }
  | { error: string; list?: undefined; id?: undefined; nextSeed?: undefined };

export type AddCheckpointResult =
  | { list: RouteDraft[]; checkpointId: string; nextSeed: number; error?: undefined }
  | { error: string; list?: undefined; checkpointId?: undefined; nextSeed?: undefined };

export function newRoute(
  list: RouteList,
  seed: number,
  areaId: string,
  mode: CourseMode,
  start: { x: number; z: number; headingRad: number },
  name?: string,
): NewRouteResult {
  if (list.length >= MAX_COURSES) {
    return { error: `A map can have at most ${MAX_COURSES} routes` };
  }
  const draft: RouteDraft = {
    id: `${areaId}-route-${seed}`,
    name: name ?? `Route ${seed}`,
    mode,
    laps: mode === "circuit" ? DEFAULT_CIRCUIT_LAPS : 1,
    start: { x: start.x, z: start.z, headingRad: start.headingRad },
    checkpoints: [],
    finish: null,
  };
  return { list: [...list, draft], id: draft.id, nextSeed: seed + 1 };
}

function replaceRoute(
  list: RouteList,
  routeId: string,
  edit: (draft: RouteDraft) => RouteDraft | null,
): RouteList {
  const i = list.findIndex((r) => r.id === routeId);
  if (i < 0) return list;
  const next = edit(list[i]);
  if (next === null || next === list[i]) return list;
  return list.map((r, k) => (k === i ? next : r));
}

export function addRouteCheckpoint(
  list: RouteList,
  routeId: string,
  seed: number,
  x: number,
  z: number,
): AddCheckpointResult {
  const i = list.findIndex((r) => r.id === routeId);
  if (i < 0) return { error: "Route not found" };
  const draft = list[i];
  if (draft.checkpoints.length + (draft.finish === null ? 0 : 1) >= COURSE_CHECKPOINTS_MAX) {
    return { error: `A route can have at most ${COURSE_CHECKPOINTS_MAX} checkpoints` };
  }
  const point = { id: `${routeId}-cp-${seed}`, x, z };
  return {
    list: list.map((r, k) => (k === i ? { ...r, checkpoints: [...r.checkpoints, point] } : r)),
    checkpointId: point.id,
    nextSeed: seed + 1,
  };
}

export function setRouteFinish(list: RouteList, routeId: string, x: number, z: number): RouteList {
  return replaceRoute(list, routeId, (d) => ({ ...d, finish: { id: `${d.id}-finish`, x, z } }));
}

export function moveRouteItem(
  list: RouteList,
  routeId: string,
  ref: string,
  x: number,
  z: number,
): RouteList {
  return replaceRoute(list, routeId, (d) => {
    if (ref === "start") return d.start === null ? null : { ...d, start: { ...d.start, x, z } };
    if (ref === "finish") return d.finish === null ? null : { ...d, finish: { ...d.finish, x, z } };
    const c = d.checkpoints.findIndex((cp) => cp.id === ref);
    if (c < 0) return null;
    return { ...d, checkpoints: d.checkpoints.map((cp, k) => (k === c ? { ...cp, x, z } : cp)) };
  });
}

export function turnRouteStart(list: RouteList, routeId: string, headingRad: number): RouteList {
  return replaceRoute(list, routeId, (d) =>
    d.start === null ? null : { ...d, start: { ...d.start, headingRad } },
  );
}

export function moveCheckpointOrder(
  list: RouteList,
  routeId: string,
  checkpointId: string,
  delta: -1 | 1,
): RouteList {
  return replaceRoute(list, routeId, (d) => {
    const c = d.checkpoints.findIndex((cp) => cp.id === checkpointId);
    const t = c + delta;
    if (c < 0 || t < 0 || t >= d.checkpoints.length) return null;
    const checkpoints = [...d.checkpoints];
    checkpoints[c] = d.checkpoints[t];
    checkpoints[t] = d.checkpoints[c];
    return { ...d, checkpoints };
  });
}

export function deleteRouteCheckpoint(
  list: RouteList,
  routeId: string,
  checkpointId: string,
): RouteList {
  return replaceRoute(list, routeId, (d) => {
    if (!d.checkpoints.some((cp) => cp.id === checkpointId)) return null;
    return { ...d, checkpoints: d.checkpoints.filter((cp) => cp.id !== checkpointId) };
  });
}

/** Removes the finish if set, else the last checkpoint, else the route itself. */
export function deleteLastRouteItem(list: RouteList, routeId: string): RouteList {
  const i = list.findIndex((r) => r.id === routeId);
  if (i < 0) return list;
  const d = list[i];
  if (d.finish !== null) return list.map((r, k) => (k === i ? { ...r, finish: null } : r));
  if (d.checkpoints.length > 0)
    return list.map((r, k) => (k === i ? { ...r, checkpoints: r.checkpoints.slice(0, -1) } : r));
  return list.filter((_, k) => k !== i);
}

/** Clamps to 1..20; a no-op (same reference) for point-to-point routes. */
export function setRouteLaps(list: RouteList, routeId: string, laps: number): RouteList {
  if (!Number.isFinite(laps)) return list;
  const clamped = Math.min(LAPS_MAX, Math.max(LAPS_MIN, Math.round(laps)));
  return replaceRoute(list, routeId, (d) => {
    if (d.mode !== "circuit" || d.laps === clamped) return null;
    return { ...d, laps: clamped };
  });
}

/** Trims; empty or over-long names are rejected (same reference). */
export function renameRoute(list: RouteList, routeId: string, name: string): RouteList {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_ROUTE_NAME_LENGTH) return list;
  return replaceRoute(list, routeId, (d) => (d.name === trimmed ? null : { ...d, name: trimmed }));
}

export function deleteRoute(list: RouteList, routeId: string): RouteList {
  if (!list.some((r) => r.id === routeId)) return list;
  return list.filter((r) => r.id !== routeId);
}

export interface RouteItemRow {
  readonly ref: string;
  readonly label: string;
  readonly number: number;
}

export function routeItemRows(draft: RouteDraft): RouteItemRow[] {
  const rows: RouteItemRow[] = [{ ref: "start", label: "Start", number: 1 }];
  draft.checkpoints.forEach((cp, i) => {
    rows.push({ ref: cp.id, label: `Checkpoint ${i + 1}`, number: i + 2 });
  });
  if (draft.finish !== null) {
    rows.push({
      ref: "finish",
      label: draft.mode === "circuit" ? "Lap line" : "Finish",
      number: draft.checkpoints.length + 2,
    });
  }
  return rows;
}
