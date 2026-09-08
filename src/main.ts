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
 */
import type { InputFrame, InputSource } from "./core/input-tape";
import { NEUTRAL } from "./core/input-tape";
import { DEBUG_ENABLED, onDebugToggle } from "./debug/debug-gate";
import { createHud } from "./debug/profiler-hud";
import { startLoop } from "./loop";
import { createDebugScene } from "./physics/debug-scene";
import { TransformCache } from "./physics/transform-cache";
import { createWorld } from "./physics/world";
import { createDebugRenderScene } from "./render/debug-scene";
import { applyAllInterpolated } from "./render/interpolator";
import { createRenderer } from "./render/renderer";

const canvasElement = document.getElementById("game");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('composition root: expected a <canvas id="game"> element in index.html');
}
const canvas: HTMLCanvasElement = canvasElement;

const world = createWorld();
const scene = createDebugScene(world);
const transforms = new TransformCache(scene.bodies);

const { renderer, camera } = createRenderer(canvas);

// `scene.bodies.length` and `scene.spinnerIndex` are passed explicitly rather
// than hardcoded, so the mesh-to-body index contract (threat T-01-16) stays
// visible at this call site instead of relying on two separately-authored
// files agreeing by convention alone.
const { scene: threeScene, meshes } = createDebugRenderScene(
  scene.bodies.length,
  scene.spinnerIndex,
);

// Phase 1 has no keyboard or gamepad source yet, so every tick is fed the
// all-zero NEUTRAL frame. Phase 2 replaces this with a live source wrapped in
// `RecordingInput`; the `applyInput` path this exercises is already covered
// by `tests/determinism.test.ts`.
const input: InputSource = {
  sampleForTick(_tick: number): InputFrame {
    return NEUTRAL;
  },
};

// The HUD is constructed only when `?debug` is present, so a normal build
// adds zero DOM overlay and zero listeners.
const hud = DEBUG_ENABLED ? createHud(renderer, world) : null;
if (hud) {
  onDebugToggle(() => hud.toggle());
}

startLoop({
  world,
  input,
  transforms,
  applyInput: scene.applyInput,
  onTickBegin: scene.preTick,
  render(alpha: number): void {
    // Interpolate first, then submit — this ordering is load-bearing. The
    // HUD reads `renderer.info` only after `renderer.render()` returns, and
    // that read is valid only because this is the sole per-frame draw call.
    applyAllInterpolated(meshes, transforms, alpha);
    renderer.render(threeScene, camera);
  },
  hud: hud ? (stats, dtMs) => hud.update(stats, dtMs) : undefined,
});
