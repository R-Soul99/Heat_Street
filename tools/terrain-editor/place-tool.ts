// Press-drag placement gesture (07.1.3 D-05). Kind-agnostic: reused later by
// ramps and the building footprint. Pure, no DOM.

import { yawFromTravelDirection } from "../../src/core/heading.ts";
import { MAX_LINE_POINTS } from "../../src/core/terrain-format.ts";
import { LINE_TOO_FEW_POINTS, lineTooManyPoints } from "./features.ts";

/** A drag shorter than this yields no heading (the caller supplies a fallback). */
export const DRAG_HEADING_MIN_M = 1;

export interface DragResult {
  x: number;
  z: number;
  /** VehiclePose yaw; undefined when the drag was under DRAG_HEADING_MIN_M. */
  headingRad: number | undefined;
}

export interface DragGesture {
  down(x: number, z: number): void;
  move(x: number, z: number): void;
  up(): DragResult | undefined;
  cancel(): void;
  active(): boolean;
  preview(): { from: { x: number; z: number }; to: { x: number; z: number } } | undefined;
}

export function createDragGesture(): DragGesture {
  let from: { x: number; z: number } | null = null;
  let to: { x: number; z: number } | null = null;
  return {
    down(x, z) {
      from = { x, z };
      to = { x, z };
    },
    move(x, z) {
      if (from) to = { x, z };
    },
    up() {
      if (!from || !to) return undefined;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const out: DragResult = {
        x: from.x,
        z: from.z,
        headingRad:
          Math.hypot(dx, dz) >= DRAG_HEADING_MIN_M ? yawFromTravelDirection(dx, dz) : undefined,
      };
      from = null;
      to = null;
      return out;
    },
    cancel() {
      from = null;
      to = null;
    },
    active: () => from !== null,
    preview: () => (from && to ? { from: { ...from }, to: { ...to } } : undefined),
  };
}

export interface LineBuilder {
  /** Adds a vertex; refused (error text) once the point cap is reached. */
  add(x: number, z: number): { error?: string };
  removeLast(): void;
  /** Returns the points, or an error when fewer than 2; clears the builder on success. */
  finish():
    | { points: [number, number][]; error?: undefined }
    | { error: string; points?: undefined };
  cancel(): void;
  points(): readonly (readonly [number, number])[];
  lengthM(): number;
  active(): boolean;
}

/** Click-by-click polyline builder for hedges and fences (07.1.3 D-06). */
export function createLineBuilder(maxPoints: number = MAX_LINE_POINTS): LineBuilder {
  let pts: [number, number][] = [];
  return {
    add(x, z) {
      if (pts.length >= maxPoints) return { error: lineTooManyPoints(maxPoints) };
      pts.push([x, z]);
      return {};
    },
    removeLast() {
      pts.pop();
    },
    finish() {
      if (pts.length < 2) return { error: LINE_TOO_FEW_POINTS };
      const out = pts;
      pts = [];
      return { points: out };
    },
    cancel() {
      pts = [];
    },
    points: () => pts.map((p) => [p[0], p[1]] as const),
    lengthM() {
      let sum = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i] as [number, number];
        const b = pts[i + 1] as [number, number];
        sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      return sum;
    },
    active: () => pts.length > 0,
  };
}
