import type { RoadGraph } from "../core/road-graph";

export interface MinimapPoint {
  readonly x: number;
  readonly z: number;
}

export interface MinimapProjection {
  readonly x: number;
  readonly y: number;
  readonly offscreen: boolean;
  readonly angleRad: number;
}

export interface MinimapSnapshot {
  readonly player: MinimapPoint;
  readonly headingRad: number;
  readonly remaining: readonly MinimapPoint[];
  readonly target: MinimapPoint | null;
}

export interface Minimap {
  update(snapshot: MinimapSnapshot): void;
  dispose(): void;
}

export function projectMinimapPoint(
  point: MinimapPoint,
  player: MinimapPoint,
  radiusM: number,
  sizePx: number,
): MinimapProjection {
  const half = sizePx / 2;
  const dx = point.x - player.x;
  const dz = point.z - player.z;
  const distance = Math.hypot(dx, dz);
  const angleRad = Math.atan2(dx, -dz);
  const scale = half / radiusM;
  if (distance <= radiusM) {
    return { x: half + dx * scale, y: half - dz * scale, offscreen: false, angleRad };
  }
  return {
    x: half + Math.sin(angleRad) * (half - 8),
    y: half + Math.cos(angleRad) * (half - 8),
    offscreen: true,
    angleRad,
  };
}

export function projectCarRotation(headingRad: number): number {
  // The marker is drawn pointing up; vehicle heading is measured from world +X.
  return Math.PI / 2 - headingRad;
}

function distanceFromPlayer(point: MinimapPoint, player: MinimapPoint): number {
  return Math.hypot(point.x - player.x, point.z - player.z);
}

export function createMinimap(graph: RoadGraph, sizePx = 196, radiusM = 420): Minimap {
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  canvas.setAttribute("aria-label", "Race minimap");
  canvas.style.cssText =
    "position:fixed;left:18px;bottom:18px;width:196px;height:196px;z-index:8;pointer-events:none;border:1px solid rgba(117,225,255,.55);background:#071015;box-shadow:0 0 18px rgba(0,0,0,.45)";
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("minimap: 2D canvas context unavailable");

  function mapPoint(point: MinimapPoint, player: MinimapPoint): MinimapProjection {
    return projectMinimapPoint(point, player, radiusM, sizePx);
  }

  return {
    update(snapshot): void {
      context.clearRect(0, 0, sizePx, sizePx);
      context.fillStyle = "#071015";
      context.fillRect(0, 0, sizePx, sizePx);
      context.strokeStyle = "rgba(120,218,238,.62)";
      context.lineWidth = 1.5;
      for (const edge of graph.edges) {
        context.beginPath();
        let drawing = false;
        for (const point of edge.points) {
          const worldPoint = { x: point[0], z: point[2] };
          if (distanceFromPlayer(worldPoint, snapshot.player) > radiusM) {
            drawing = false;
            continue;
          }
          const projected = mapPoint(worldPoint, snapshot.player);
          if (!drawing) {
            context.moveTo(projected.x, projected.y);
            drawing = true;
          } else {
            context.lineTo(projected.x, projected.y);
          }
        }
        context.stroke();
      }
      for (const point of snapshot.remaining) {
        const projected = mapPoint(point, snapshot.player);
        context.fillStyle = projected.offscreen ? "#6ed7e8" : "#ff9b78";
        context.beginPath();
        context.arc(projected.x, projected.y, projected.offscreen ? 3 : 4, 0, Math.PI * 2);
        context.fill();
      }
      if (snapshot.target !== null) {
        const projected = mapPoint(snapshot.target, snapshot.player);
        context.fillStyle = "#ffd447";
        context.strokeStyle = "#fff4b0";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(projected.x, projected.y, projected.offscreen ? 6 : 7, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
      context.save();
      context.translate(sizePx / 2, sizePx / 2);
      context.rotate(projectCarRotation(snapshot.headingRad));
      context.fillStyle = "#f4fbff";
      context.beginPath();
      context.moveTo(0, -9);
      context.lineTo(6, 7);
      context.lineTo(0, 4);
      context.lineTo(-6, 7);
      context.closePath();
      context.fill();
      context.restore();
    },
    dispose(): void {
      canvas.remove();
    },
  };
}
