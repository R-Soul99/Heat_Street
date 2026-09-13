/**
 * The profiler HUD: a pure text formatter plus a throttled DOM overlay.
 *
 * SC4 requires physics ms, draw calls, triangles and body count against a
 * written frame budget; D-03 adds render ms and states "minimal" still means
 * all of them, not fewer. D-04 fixes the budget this file is checked against
 * in `src/core/frame-budget.ts`, mirrored in `docs/frame-budget.md`.
 *
 * The two halves are kept deliberately separate: `formatHudText` is pure and
 * Node-testable (see `tests/profiler-hud.test.ts`), `createHud` is the DOM/
 * renderer/world-touching half that only plan 01-07's browser checkpoint can
 * exercise.
 *
 * Layering: `src/debug/**` may import anything but must never affect
 * simulation timing — no `world.step`, no impulses, no body writes. This file
 * only reads `renderer.info` and iterates active rigid bodies.
 */
import type * as RAPIER from "@dimforge/rapier3d";
import type * as THREE from "three";
import { BUDGET, SCENE_TARGETS } from "../core/frame-budget";
import type { FrameStats } from "../core/frame-stats";

/** Inputs the pure formatter needs. Nothing here is a DOM, renderer or world type. */
export interface HudInputs {
  readonly stats: FrameStats;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly activeBodies: number;
  readonly totalBodies: number;
  readonly avgFrameMs: number;
}

/** How long the overlay stays visible between throttled DOM writes. */
const THROTTLE_MS = 150;

/** Trailing marker appended to a line whose measured value exceeds its budget. */
function over(value: number, budget: number): string {
  return value > budget ? " !" : "";
}

/**
 * Build the HUD's text content from a snapshot of inputs. Pure: touches no
 * DOM, no renderer, no world, and is deterministic for identical inputs — the
 * marker logic (`over`) is how SC4/D-04 "checked against a written budget" is
 * actually satisfied rather than merely displaying numbers.
 *
 * Millisecond values are formatted with `toFixed(2)` so output is
 * byte-identical for byte-identical inputs.
 */
export function formatHudText(inputs: HudInputs): string {
  const { stats, drawCalls, triangles, activeBodies, totalBodies, avgFrameMs } = inputs;

  const lines = [
    `frame   ${avgFrameMs.toFixed(2)}ms / ${BUDGET.frameMs}ms${over(avgFrameMs, BUDGET.frameMs)}`,
    `physics ${stats.physicsMs.toFixed(2)}ms / ${BUDGET.physicsMs}ms${over(stats.physicsMs, BUDGET.physicsMs)}  (${stats.steps} step/f)`,
    `render  ${stats.renderMs.toFixed(2)}ms / ${BUDGET.renderCpuMs}ms${over(stats.renderMs, BUDGET.renderCpuMs)}  (cpu submit)`,
    `draws   ${drawCalls} / ${SCENE_TARGETS.drawCalls}${over(drawCalls, SCENE_TARGETS.drawCalls)}`,
    `tris    ${triangles} / ${SCENE_TARGETS.triangles}${over(triangles, SCENE_TARGETS.triangles)}`,
    `bodies  ${activeBodies} active / ${totalBodies} total`,
    `tick    ${stats.tick}   sim ${stats.simTimeSec.toFixed(3)}s   dropped ${stats.droppedTicks}`,
  ];
  return lines.join("\n");
}

/** The live overlay's public surface. */
export interface Hud {
  /** Flip the overlay between hidden and visible. Wired to `onDebugToggle`. */
  toggle(): void;
  /** Feed one frame's stats in. Throttled internally — safe to call every rAF. */
  update(stats: FrameStats, dtMs: number): void;
  /** Remove the overlay element from the DOM. */
  dispose(): void;
}

/**
 * Create the DOM overlay. Hidden by default (`display:none`) — `debug-gate`'s
 * `onDebugToggle` is what flips it, and this module never checks `DEBUG_ENABLED`
 * itself so it stays independently testable and reusable.
 */
export function createHud(renderer: THREE.WebGLRenderer, world: RAPIER.World): Hud {
  const el = document.createElement("div");
  // `pointer-events:none` keeps the overlay out of the input path entirely.
  // `display:none` is the default; `debug-gate`'s hotkey is what shows it.
  el.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:10;pointer-events:none;" +
    "font:11px/1.45 ui-monospace,monospace;color:#e8e8e8;background:rgba(0,0,0,.62);" +
    "padding:6px 9px;border-radius:4px;white-space:pre;display:none";
  document.body.appendChild(el);

  // Accumulated between DOM writes so the HUD reports an average over the
  // throttle window rather than one noisy sample.
  let accMs = 0;
  let samples = 0;
  let physicsSum = 0;
  let renderSum = 0;

  return {
    toggle(): void {
      el.style.display = el.style.display === "none" ? "block" : "none";
    },

    update(stats: FrameStats, dtMs: number): void {
      physicsSum += stats.physicsMs;
      renderSum += stats.renderMs;
      accMs += dtMs;
      samples++;

      // ~7 Hz DOM writes, not 144 Hz — RESEARCH.md is explicit that writing the
      // DOM every frame is itself a frame-budget cost.
      if (accMs < THROTTLE_MS) return;

      // `renderer.info` is valid to read here ONLY because `update()` is called
      // AFTER `renderer.render()` returns for this frame: `info.autoReset`
      // defaults to `true` and the reset happens at the START of `render()`.
      // Plan 01-07 owns that call ordering. If a later phase draws more than
      // once per frame, `renderer.info.autoReset` must become `false` with a
      // manual `reset()`, or only the last pass gets reported.
      const info = renderer.info;

      let active = 0;
      world.forEachActiveRigidBody(() => {
        active++;
      });

      el.textContent = formatHudText({
        stats: {
          ...stats,
          physicsMs: physicsSum / samples,
          renderMs: renderSum / samples,
        },
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        activeBodies: active,
        totalBodies: world.bodies.len(),
        avgFrameMs: accMs / samples,
      });

      accMs = 0;
      samples = 0;
      physicsSum = 0;
      renderSum = 0;
    },

    dispose(): void {
      el.remove();
    },
  };
}
