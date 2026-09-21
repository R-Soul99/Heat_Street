import type { RoadGraph } from "../core/road-graph";

export interface NavigationArrowSnapshot {
  readonly carHeadingRad: number;
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

export function createNavigationArrow(): NavigationArrow {
  const element = document.createElement("div");
  element.textContent = "▲";
  element.setAttribute("aria-label", "Road direction");
  element.style.cssText =
    "position:fixed;top:24px;left:50%;z-index:8;transform:translateX(-50%);font:700 34px/1 sans-serif;color:#ffd447;text-shadow:0 0 12px #071015;pointer-events:none";
  document.body.appendChild(element);
  return {
    update(snapshot): void {
      if (snapshot.waypoint === null) {
        element.style.visibility = "hidden";
        return;
      }
      element.style.visibility = "visible";
      const dx = snapshot.waypoint[0];
      const dz = snapshot.waypoint[2];
      const bearing = Math.atan2(dx, -dz);
      const relative = bearing - snapshot.carHeadingRad;
      element.style.transform = `translateX(-50%) rotate(${relative}rad)`;
    },
    dispose(): void {
      element.remove();
    },
  };
}