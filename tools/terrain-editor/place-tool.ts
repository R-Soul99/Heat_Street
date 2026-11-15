// Press-drag placement gesture (07.1.3 D-05). Kind-agnostic: reused later by
// ramps and the building footprint. Pure, no DOM.

import { yawFromTravelDirection } from "../../src/core/heading.ts";

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
