/**
 * Composition root: wires core, physics, render and debug together into a
 * running application.
 *
 * This REPLACES plan 01-01's temporary WASM bootstrap entirely — that file's
 * only job was to prove the Rapier WASM executes in a real browser, which
 * `startLoop` below now does for real, on every frame, for the life of the
 * page.
 *
 * `src/main.ts` is the trust boundary where a layering violation is easiest
 * to introduce and hardest to see (01-RESEARCH.md "Architectural
 * Responsibility Map"). `tests/layering.test.ts` polices the whole `src/`
 * tree automatically rather than relying on this file being reviewed
 * carefully by eye every time it changes.
 *
 * Phase 2 supersedes the Phase 1 debug scene HERE, and only here: every other
 * file that still imports `createDebugScene`/`createDebugRenderScene` does so
 * as a regression fixture (see the comment above `world`/`scene` below), never
 * as a second live composition path.
 */
import { defaultTuning, parseSavedTuning, TUNING_STORAGE_KEY } from "./core/vehicle-tuning";
import { DEBUG_ENABLED, onDebugToggle } from "./debug/debug-gate";
import { createHud } from "./debug/profiler-hud";
import { createSpeedometer } from "./hud/speedometer";
import { LiveInputSource } from "./input/live-input";
import { startLoop } from "./loop";
import { TransformCache } from "./physics/transform-cache";
import { createVehicleScene } from "./physics/vehicle-scene";
import { createWorld } from "./physics/world";
import { applyAllInterpolated } from "./render/interpolator";
import { createRenderer } from "./render/renderer";
import { createVehicleView } from "./render/vehicle-view";

const canvasElement = document.getElementById("game");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('composition root: expected a <canvas id="game"> element in index.html');
}
const canvas: HTMLCanvasElement = canvasElement;

// Persisted values are restored at boot so an HMR reload does not lose a
// tuning session (D-17). `parseSavedTuning` is what makes this untrusted
// blob safe to read (threat T-02-01) — never `JSON.parse` directly here.
const tuning =
  parseSavedTuning(
    typeof localStorage !== "undefined" ? localStorage.getItem(TUNING_STORAGE_KEY) : null,
  ) ?? defaultTuning();

const world = createWorld();
const scene = createVehicleScene(world, tuning);
const transforms = new TransformCache(scene.bodies);

// `src/physics/debug-scene.ts` and `src/render/debug-scene.ts` are
// deliberately LEFT IN PLACE and are no longer imported by this file. They
// are now regression fixtures: `tests/determinism.test.ts` (7 sites),
// `tests/transform-cache.test.ts` and `tests/loop.test.ts` all import
// `createDebugScene`, and `tests/determinism.test.ts` is the VEH-03 proof
// CLAUDE.md project constraint 3 says must not regress. Deleting them is a
// separately planned task, never a side effect of this phase.

const { renderer, camera } = createRenderer(canvas);

// Geometry is passed EXPLICITLY at this call site rather than letting
// `src/render/vehicle-view.ts` import `VehicleTuning`, preserving the
// "explicit contract at the call site" convention this file already used for
// `scene.bodies.length` / `scene.spinnerIndex` (threat T-01-16).
const view = createVehicleView(
  tuning.wheels.radius,
  tuning.wheels.halfTrack,
  tuning.wheels.halfWheelbase,
  tuning.chassis.halfExtents,
);

// This replaces the Phase 1 all-NEUTRAL stub with live keyboard + gamepad
// input.
const input = new LiveInputSource();

// Always constructed, NOT gated on `DEBUG_ENABLED` — the speedometer is
// player-facing (NAV-01).
const speedo = createSpeedometer();

// The HUD is constructed only when `?debug` is present, so a normal build
// adds zero DOM overlay and zero listeners.
const hud = DEBUG_ENABLED ? createHud(renderer, world) : null;
if (hud) {
  onDebugToggle(() => hud.toggle());
}

// Temporary placeholder camera for this phase's SC5 playtest (Phase 3 owns
// the real, permanent helicopter camera — see 02-RESEARCH.md Open Question
// 1's recommendation that the feel session not be judged through an unusable
// view). A simple fixed chase offset behind and above the chassis, aimed at
// the chassis, updated every frame from the live simulation position.
const CHASE_OFFSET = { x: 0, y: 5, z: 9 };
{
  const spawnPos = scene.vehicle.body.translation();
  camera.position.set(
    spawnPos.x + CHASE_OFFSET.x,
    spawnPos.y + CHASE_OFFSET.y,
    spawnPos.z + CHASE_OFFSET.z,
  );
  camera.lookAt(spawnPos.x, spawnPos.y, spawnPos.z);
}

startLoop({
  world,
  input,
  transforms,
  applyInput: scene.applyInput,
  onTickBegin: scene.preTick,
  render(alpha: number, dtMs: number): void {
    // Ground speed computed here from linvel's XZ components, never from the
    // vehicle controller's own full-3D speed getter — that includes vertical
    // velocity, whose sign is numerical noise for a -Z-forward car (Pitfall
    // 1). This update MUST NOT sit between interpolation and the draw call:
    // the profiler HUD reads `renderer.info` after `render()` returns, and
    // that read is valid only because there is exactly one draw call per
    // frame. Put it first.
    const v = scene.vehicle.body.linvel();
    speedo.update(Math.hypot(v.x, v.z), dtMs);

    const chassisPos = scene.vehicle.body.translation();
    camera.position.set(
      chassisPos.x + CHASE_OFFSET.x,
      chassisPos.y + CHASE_OFFSET.y,
      chassisPos.z + CHASE_OFFSET.z,
    );
    camera.lookAt(chassisPos.x, chassisPos.y, chassisPos.z);

    view.updateWheels(scene.vehicle.controller);
    applyAllInterpolated(view.meshes, transforms, alpha);
    renderer.render(view.scene, camera);
  },
  hud: hud ? (stats, dtMs) => hud.update(stats, dtMs) : undefined,
});
