import type { RoadGraph } from "../core/road-graph";

export interface NavigationArrowSnapshot {
  readonly carHeadingRad: number;
  readonly carPosition: readonly [number, number, number];
  readonly waypoint: readonly [number, number, number] | null;
}

export interface NavigationArrow {
  update(snapshot: NavigationArrowSnapshot): void;
  dispose(): void;
}

export function nextRoadWaypoint(
  path: readonly number[],
  roadGraph: RoadGraph,
): readonly [number, number, number] | null {
  if (path.length < 2) return null;
  const node = roadGraph.nodes.find((candidate) => candidate.id === path[1]);
  return node === undefined ? null : [node.x, node.y, node.z];
}

export function navigationArrowRotation(
  carHeadingRad: number,
  carPosition: readonly [number, number, number],
  waypoint: readonly [number, number, number],
): number {
  const dx = waypoint[0] - carPosition[0];
  const dz = waypoint[2] - carPosition[2];
  return Math.atan2(dz, dx) - carHeadingRad;
}

/** A world point projected to CSS pixels from the viewport's top-left, or null if behind the camera. */
export type ScreenProjector = (x: number, y: number, z: number) => { x: number; y: number } | null;

/** Distance from the car's on-screen position to the arrow, CSS pixels. */
export const ARROW_RING_PX = 78;

/**
 * Clockwise rotation (radians, 0 = pointing straight up the screen) of the
 * on-screen vector from `from` to `to`. Screen y grows downward, so "up" is
 * negative y. Returns null when the two points coincide.
 */
export function screenBearingRad(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.atan2(dx, -dy);
}

/**
 * The road-direction arrow. With a `project` function it points along the
 * waypoint's direction ON SCREEN and sits on a ring around the car, so it
 * stays correct however the camera is oriented (the camera no longer follows
 * the car's heading). Without one it falls back to the old car-relative
 * arrow pinned to the top of the screen.
 */
export function createNavigationArrow(project?: ScreenProjector): NavigationArrow {
  const element = document.createElement("div");
  element.textContent = "▲";
  element.setAttribute("aria-label", "Road direction");
  element.style.cssText = project
    ? "position:fixed;left:0;top:0;z-index:8;font:700 34px/1 sans-serif;color:#ffd447;text-shadow:0 0 12px #071015;pointer-events:none;will-change:transform"
    : "position:fixed;top:24px;left:50%;z-index:8;transform:translateX(-50%);font:700 34px/1 sans-serif;color:#ffd447;text-shadow:0 0 12px #071015;pointer-events:none";
  document.body.appendChild(element);
  return {
    update(snapshot): void {
      if (snapshot.waypoint === null) {
        element.style.visibility = "hidden";
        return;
      }
      if (project) {
        const car = project(
          snapshot.carPosition[0],
          snapshot.carPosition[1],
          snapshot.carPosition[2],
        );
        const target = project(snapshot.waypoint[0], snapshot.waypoint[1], snapshot.waypoint[2]);
        const bearing = car && target ? screenBearingRad(car, target) : null;
        if (car === null || bearing === null) {
          element.style.visibility = "hidden";
          return;
        }
        element.style.visibility = "visible";
        const x = car.x + Math.sin(bearing) * ARROW_RING_PX;
        const y = car.y - Math.cos(bearing) * ARROW_RING_PX;
        // Glyph is ~34px; centre it on (x, y) before rotating about its centre.
        element.style.transform = `translate(${(x - 17).toFixed(1)}px, ${(y - 17).toFixed(1)}px) rotate(${bearing}rad)`;
        return;
      }
      element.style.visibility = "visible";
      const relative = navigationArrowRotation(
        snapshot.carHeadingRad,
        snapshot.carPosition,
        snapshot.waypoint,
      );
      element.style.transform = `translateX(-50%) rotate(${relative}rad)`;
    },
    dispose(): void {
      element.remove();
    },
  };
}
