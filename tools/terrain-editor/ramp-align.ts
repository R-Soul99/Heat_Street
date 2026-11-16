// Pure ramp alignment for the terrain editor (quick 261116-a5q). No DOM, no three.
// A ramp's (centerX, centerZ) is the START of its foot and its heading points along the ramp
// (0 = +x, +pi/2 = +z). Every result goes through the existing ramp guards (updateRamp for turns,
// canPlaceRamp for slides), so a refused result changes nothing and carries the reason.

import type { AuthoredCrest } from "../../src/core/crest-geometry.ts";
import type { TerrainObject } from "../../src/core/terrain-format.ts";
import { canPlaceRamp, type PlaceArea, updateRamp } from "./features.ts";

export type AlignMode = "face" | "faceEach" | "match" | "lineUp";

/** Two ramp starts closer than this are treated as the same spot (no direction between them). */
export const COINCIDENT_M = 0.05;
/** A slide shorter than this is "already in line". */
const IN_LINE_M = 0.005;
/** A turn smaller than this (radians) is "already the same heading". */
const SAME_HEADING_RAD = 1e-6;

export const ALIGN_SAME_RAMP = "Pick a different ramp to align to";
export const ALIGN_NOT_A_RAMP = "That is not a ramp. Click a ramp, or press Esc to cancel";
export const ALIGN_COINCIDENT =
  "The two ramps start at the same spot, so there is no direction between them";
export const ALIGN_SAME_HEADING = "Both ramps already point the same way";
export const ALIGN_ALREADY_FACING = "That ramp already faces it";
export const ALIGN_ALREADY_IN_LINE = "That ramp is already on that line";

export const ALIGN_PROMPT = "Click the ramp to align to (Esc cancels)";

/** Wraps an angle to (-pi, pi]. */
export function wrapHeading(r: number): number {
  const t = ((((r + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return t === -Math.PI ? Math.PI : t;
}

/** Heading (0 = +x, +pi/2 = +z) from one point toward another; null when they coincide. */
export function headingToward(
  from: { x: number; z: number },
  to: { x: number; z: number },
): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < COINCIDENT_M)
    return null;
  return wrapHeading(Math.atan2(dz, dx));
}

/**
 * Position that puts `start` on the centre line through `lineStart` along `lineHeading`, sliding
 * sideways only: the distance along the line is unchanged. Null when already on the line.
 */
export function slideOntoLine(
  start: { x: number; z: number },
  lineStart: { x: number; z: number },
  lineHeading: number,
): { x: number; z: number } | null {
  // Unit normal to the line.
  const nx = -Math.sin(lineHeading);
  const nz = Math.cos(lineHeading);
  const offset = (start.x - lineStart.x) * nx + (start.z - lineStart.z) * nz;
  if (Math.abs(offset) < IN_LINE_M) return null;
  return { x: start.x - nx * offset, z: start.z - nz * offset };
}

/** Two end points of a ramp's centre line, `halfSpanM` each side of the foot start. */
export function centreLineEnds(
  crest: AuthoredCrest,
  halfSpanM: number,
): [{ x: number; z: number }, { x: number; z: number }] | null {
  const h = crest.ramp?.headingRad;
  if (h === undefined) return null;
  const dx = Math.cos(h);
  const dz = Math.sin(h);
  return [
    { x: crest.centerX - dx * halfSpanM, z: crest.centerZ - dz * halfSpanM },
    { x: crest.centerX + dx * halfSpanM, z: crest.centerZ + dz * halfSpanM },
  ];
}

export type AlignEdit =
  | { ok: true; objects: readonly TerrainObject[]; changed: readonly string[] }
  | { ok: false; reason: string };

function rampOf(objects: readonly TerrainObject[], id: string): AuthoredCrest | undefined {
  return objects.find((o) => o.crest.id === id && o.crest.ramp !== undefined)?.crest;
}

/**
 * Aligns the ramp `selId` to the ramp `targetId`. Only the selected ramp changes, except
 * "faceEach" which also turns the target to face back. The ramp's size never changes.
 */
export function alignRamp(
  objects: readonly TerrainObject[],
  selId: string,
  targetId: string,
  mode: AlignMode,
  area: PlaceArea,
): AlignEdit {
  if (selId === targetId) return { ok: false, reason: ALIGN_SAME_RAMP };
  const sel = rampOf(objects, selId);
  const target = rampOf(objects, targetId);
  if (sel?.ramp === undefined) return { ok: false, reason: "Nothing selected" };
  if (target?.ramp === undefined) return { ok: false, reason: ALIGN_NOT_A_RAMP };
  const from = { x: sel.centerX, z: sel.centerZ };
  const to = { x: target.centerX, z: target.centerZ };

  if (mode === "face" || mode === "faceEach") {
    const toward = headingToward(from, to);
    if (toward === null) return { ok: false, reason: ALIGN_COINCIDENT };
    const turnSel = Math.abs(wrapHeading(toward - sel.ramp.headingRad)) >= SAME_HEADING_RAD;
    const back = wrapHeading(toward + Math.PI);
    const turnTarget =
      mode === "faceEach" &&
      Math.abs(wrapHeading(back - target.ramp.headingRad)) >= SAME_HEADING_RAD;
    if (!turnSel && !turnTarget) return { ok: false, reason: ALIGN_ALREADY_FACING };
    let next = objects;
    const changed: string[] = [];
    if (turnSel) {
      const r = updateRamp(next, selId, { headingRad: toward }, area);
      if (!r.ok) return r;
      next = r.objects;
      changed.push(selId);
    }
    if (turnTarget) {
      const r = updateRamp(next, targetId, { headingRad: back }, area);
      if (!r.ok) return r;
      next = r.objects;
      changed.push(targetId);
    }
    return { ok: true, objects: next, changed };
  }

  if (mode === "match") {
    const heading = wrapHeading(target.ramp.headingRad);
    if (Math.abs(wrapHeading(heading - sel.ramp.headingRad)) < SAME_HEADING_RAD) {
      return { ok: false, reason: ALIGN_SAME_HEADING };
    }
    const r = updateRamp(objects, selId, { headingRad: heading }, area);
    return r.ok ? { ok: true, objects: r.objects, changed: [selId] } : r;
  }

  // lineUp
  if (Math.hypot(to.x - from.x, to.z - from.z) < COINCIDENT_M) {
    return { ok: false, reason: ALIGN_COINCIDENT };
  }
  const slid = slideOntoLine(from, to, target.ramp.headingRad);
  if (slid === null) return { ok: false, reason: ALIGN_ALREADY_IN_LINE };
  const moved: AuthoredCrest = { ...sel, centerX: slid.x, centerZ: slid.z };
  const check = canPlaceRamp(area, moved);
  if (!check.ok) return check;
  return {
    ok: true,
    objects: objects.map((o) => (o.crest === sel ? { kind: "crest", crest: moved } : o)),
    changed: [selId],
  };
}
