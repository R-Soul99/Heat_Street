/**
 * D-15's `?debug` AI overlay: per-AI world-space racing line, look-ahead
 * target and a floating S/T/B + state + stuck/no-progress label. Follows the
 * exact `nav-pointer.ts` gate-free-factory convention (this file's own doc
 * comment there): `src/main.ts` is the only place that constructs this and
 * owns the debug-presence gate and the `KeyI` toggle. Split into a pure half
 * (`formatAiDebugLabel`, `racingLinePositions`, `ndcToCss` — all
 * Node-testable, see `tests/ai-debug-overlay.test.ts`) and a three/DOM half
 * (`createAiDebugOverlay`) that only a browser checkpoint can exercise.
 *
 * Layering: `src/debug/**` may import anything but must never affect
 * simulation timing (T-07-16) — this file only reads the plain
 * `AiDebugCar` snapshot the caller (`circuit-race-coordinator.ts`'s
 * `debugSnapshot()`) computed and writes its own three objects/DOM. It never
 * calls `world.step`, `applyImpulse` or `setTranslation`.
 */
import * as THREE from "three";
import type { AiDebugState } from "../core/ai-stuck-detector";
import type { InputFrame } from "../core/input-tape";
import type { RacingLine } from "../core/racing-line";

/** Racing line / per-AI target geometry sit slightly above the road (matches the road-surface clearance convention `objective-view.ts`'s own pillars use). */
const RACING_LINE_Y_OFFSET_M = 0.35;
const TARGET_SPHERE_RADIUS_M = 0.6;
/** Label float height above the car, metres — clear of the roofline. */
const LABEL_Y_OFFSET_M = 2.6;
const RACING_LINE_COLOR = 0xff4fd8;

/** One AI racer's plain-number debug snapshot for a single render frame — `circuit-race-coordinator.ts`'s `debugSnapshot()` builds this every frame from live telemetry. */
export interface AiDebugCar {
  readonly racerIndex: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly frame: InputFrame;
  readonly state: AiDebugState;
  readonly stuckSec: number;
  readonly noProgressSec: number;
  readonly color: string;
}

/**
 * `"AVOIDING  S+0.12 T0.80 B0.00  STUCK 0.0s  NP 1.3s"` — state uppercased,
 * signed 2-decimal steer, unsigned 2-decimal throttle/brake, 1-decimal
 * stuck/no-progress timers. Pure formatting, no DOM.
 */
export function formatAiDebugLabel(
  car: Pick<AiDebugCar, "state" | "frame" | "stuckSec" | "noProgressSec">,
): string {
  const { state, frame, stuckSec, noProgressSec } = car;
  const steerSign = frame.steer >= 0 ? "+" : "";
  return (
    `${state.toUpperCase()}  S${steerSign}${frame.steer.toFixed(2)} ` +
    `T${frame.throttle.toFixed(2)} B${frame.brake.toFixed(2)}  ` +
    `STUCK ${stuckSec.toFixed(1)}s  NP ${noProgressSec.toFixed(1)}s`
  );
}

/** Flat `[x, y+0.35, z, ...]` vertex buffer for the whole racing line — a `THREE.BufferAttribute` source, built once at construction (the line is fixed for the AI's whole race). */
export function racingLinePositions(line: Pick<RacingLine, "points">): Float32Array {
  const points = line.points;
  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y + RACING_LINE_Y_OFFSET_M;
    positions[i * 3 + 2] = p.z;
  }
  return positions;
}

/** A `THREE.Vector3.project(camera)` result — duck-typed so this stays Node-testable with a plain object, no real `Vector3` needed. */
export interface NdcPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CssPoint {
  readonly left: number;
  readonly top: number;
  /** `false` once the point is past the far clip plane (`z > 1`) or well outside the viewport (`|x| > 1.2` or `|y| > 1.2`) — a small margin past the exact `[-1, 1]` NDC box so a label does not flicker at the very screen edge. */
  readonly visible: boolean;
}

/** Standard NDC-to-CSS-pixel projection (`left = (x+1)/2 * width`, `top = (1-y)/2 * height`), plus the visibility cutoff above. */
export function ndcToCss(ndc: NdcPoint, widthPx: number, heightPx: number): CssPoint {
  return {
    left: ((ndc.x + 1) / 2) * widthPx,
    top: ((1 - ndc.y) / 2) * heightPx,
    visible: ndc.z <= 1 && Math.abs(ndc.x) <= 1.2 && Math.abs(ndc.y) <= 1.2,
  };
}

export interface AiDebugOverlay {
  /** Safe to call every render frame — writes all three objects and DOM labels in place, no per-frame allocation. */
  update(cars: readonly AiDebugCar[], widthPx: number, heightPx: number): void;
  /** Show/hide every three object and the DOM container together. Wired to `onDebugKey("KeyI", …)` at the composition root. Starts visible. */
  toggle(): void;
  /** Removes every three object/geometry/material this overlay added to `scene`, plus its DOM container. */
  dispose(): void;
}

/**
 * Builds the AI debug overlay for exactly `colors.length` AI racers over the
 * shared `line`. The three half adds to the GIVEN `scene` (never builds its
 * own): one magenta `THREE.LineLoop` of the whole racing line
 * (`depthTest: false` so it reads over the road), plus per-AI a 2-point
 * `THREE.Line` from the car to its look-ahead target and a small target
 * sphere in that AI's own paint — all allocated once here and mutated in
 * place by `update()`. The DOM half is one fixed-position container with one
 * `textContent`-only label per AI, positioned every `update()` call via
 * `ndcToCss` from `new Vector3(x, y + 2.6, z).project(camera)` through a
 * single reused scratch vector.
 */
export function createAiDebugOverlay(
  scene: THREE.Scene,
  camera: THREE.Camera,
  line: RacingLine,
  colors: readonly string[],
): AiDebugOverlay {
  const count = colors.length;

  const racingLineGeometry = new THREE.BufferGeometry();
  racingLineGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(racingLinePositions(line), 3),
  );
  const racingLineMaterial = new THREE.LineBasicMaterial({
    color: RACING_LINE_COLOR,
    depthTest: false,
  });
  const racingLineObject = new THREE.LineLoop(racingLineGeometry, racingLineMaterial);
  racingLineObject.frustumCulled = false;
  scene.add(racingLineObject);

  const targetSphereGeometry = new THREE.SphereGeometry(TARGET_SPHERE_RADIUS_M, 8, 6);
  const targetLineGeometries: THREE.BufferGeometry[] = [];
  const targetLineObjects: THREE.Line[] = [];
  const targetLineMaterials: THREE.LineBasicMaterial[] = [];
  const targetSphereObjects: THREE.Mesh[] = [];
  const targetSphereMaterials: THREE.MeshBasicMaterial[] = [];

  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:0;top:0;pointer-events:none;z-index:11;font:11px/1.3 ui-monospace,monospace";
  document.body.appendChild(container);
  const labelEls: HTMLDivElement[] = [];

  for (let i = 0; i < count; i++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const lineMaterial = new THREE.LineBasicMaterial({ color: colors[i], depthTest: false });
    const lineObject = new THREE.Line(geometry, lineMaterial);
    lineObject.frustumCulled = false;
    scene.add(lineObject);
    targetLineGeometries.push(geometry);
    targetLineObjects.push(lineObject);
    targetLineMaterials.push(lineMaterial);

    const sphereMaterial = new THREE.MeshBasicMaterial({ color: colors[i], depthTest: false });
    const sphereObject = new THREE.Mesh(targetSphereGeometry, sphereMaterial);
    sphereObject.frustumCulled = false;
    scene.add(sphereObject);
    targetSphereObjects.push(sphereObject);
    targetSphereMaterials.push(sphereMaterial);

    const label = document.createElement("div");
    label.style.cssText = `position:fixed;white-space:nowrap;color:${colors[i]};text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000`;
    container.appendChild(label);
    labelEls.push(label);
  }

  const scratch = new THREE.Vector3();
  let visible = true;

  function update(cars: readonly AiDebugCar[], widthPx: number, heightPx: number): void {
    for (let i = 0; i < count; i++) {
      const car = cars[i];
      const label = labelEls[i];
      if (car === undefined) {
        label.style.display = "none";
        continue;
      }

      const drawY = car.y + RACING_LINE_Y_OFFSET_M;
      const positions = targetLineGeometries[i].getAttribute("position") as THREE.BufferAttribute;
      positions.setXYZ(0, car.x, drawY, car.z);
      positions.setXYZ(1, car.targetX, drawY, car.targetZ);
      positions.needsUpdate = true;

      targetSphereObjects[i].position.set(car.targetX, drawY, car.targetZ);

      scratch.set(car.x, car.y + LABEL_Y_OFFSET_M, car.z).project(camera);
      const { left, top, visible: onScreen } = ndcToCss(scratch, widthPx, heightPx);
      label.style.display = onScreen ? "" : "none";
      label.style.left = `${left}px`;
      label.style.top = `${top}px`;
      label.textContent = formatAiDebugLabel(car);
    }
  }

  function toggle(): void {
    visible = !visible;
    racingLineObject.visible = visible;
    for (let i = 0; i < count; i++) {
      targetLineObjects[i].visible = visible;
      targetSphereObjects[i].visible = visible;
    }
    container.style.display = visible ? "" : "none";
  }

  function dispose(): void {
    racingLineObject.removeFromParent();
    racingLineGeometry.dispose();
    racingLineMaterial.dispose();
    for (let i = 0; i < count; i++) {
      targetLineObjects[i].removeFromParent();
      targetLineGeometries[i].dispose();
      targetLineMaterials[i].dispose();
      targetSphereObjects[i].removeFromParent();
      targetSphereMaterials[i].dispose();
    }
    targetSphereGeometry.dispose();
    container.remove();
  }

  return { update, toggle, dispose };
}
