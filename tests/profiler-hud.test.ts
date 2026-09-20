import { describe, expect, it } from "vitest";
import { BUDGET, SCENE_TARGETS } from "../src/core/frame-budget";
import type { FrameStats } from "../src/core/frame-stats";
import { formatHudText, type HudInputs } from "../src/debug/profiler-hud";

/**
 * Only `formatHudText` is exercised here — it is the pure half of the module.
 * `createHud` needs a DOM, a `THREE.WebGLRenderer` and a `RAPIER.World`, none of
 * which exist in Vitest's `node` environment; the plan's `<human-check>` covers
 * it once plan 01-07 wires `main.ts`.
 */

function makeStats(overrides: Partial<FrameStats> = {}): FrameStats {
  return {
    physicsMs: 0.31,
    renderMs: 1.2,
    steps: 1,
    tick: 42,
    simTimeSec: 0.7,
    droppedTicks: 0,
    ...overrides,
  };
}

function makeInputs(overrides: Partial<HudInputs> = {}): HudInputs {
  return {
    stats: makeStats(),
    drawCalls: 5,
    triangles: 800,
    activeBodies: 3,
    totalBodies: 8,
    avgFrameMs: 4.0,
    ...overrides,
  };
}

function lineStartingWith(text: string, prefix: string): string | undefined {
  return text.split("\n").find((l) => l.trimStart().startsWith(prefix));
}

describe("formatHudText", () => {
  it("contains a labelled line for every required field", () => {
    const text = formatHudText(makeInputs());
    expect(text).toMatch(/frame/);
    expect(text).toMatch(/physics/);
    expect(text).toMatch(/render/);
    expect(text).toMatch(/draws?/);
    expect(text).toMatch(/tris/);
    expect(text).toMatch(/bodies/);
    expect(text).toMatch(/tick/);
  });

  it("shows measured and budget values separated and readable, e.g. physics 0.31ms / 4ms", () => {
    const text = formatHudText(makeInputs({ stats: makeStats({ physicsMs: 0.31 }) }));
    expect(text).toContain(`physics 0.31ms / ${BUDGET.physicsMs}ms`);
  });

  it("does not mark frame under budget", () => {
    const text = formatHudText(makeInputs({ avgFrameMs: 4.0 }));
    expect(lineStartingWith(text, "frame")).not.toContain("!");
  });

  it("marks frame over its budget", () => {
    const text = formatHudText(makeInputs({ avgFrameMs: BUDGET.frameMs + 1 }));
    expect(lineStartingWith(text, "frame")).toContain("!");
  });

  it("does not mark physics under budget", () => {
    const text = formatHudText(makeInputs({ stats: makeStats({ physicsMs: 0.31 }) }));
    expect(lineStartingWith(text, "physics")).not.toContain("!");
  });

  it("marks physics over budget: 5.0ms against BUDGET.physicsMs 4.0ms", () => {
    const text = formatHudText(makeInputs({ stats: makeStats({ physicsMs: 5.0 }) }));
    expect(BUDGET.physicsMs).toBe(4.0);
    expect(lineStartingWith(text, "physics")).toContain("!");
  });

  it("does not mark render under budget", () => {
    const text = formatHudText(makeInputs({ stats: makeStats({ renderMs: 1.0 }) }));
    expect(lineStartingWith(text, "render")).not.toContain("!");
  });

  it("marks render over its budget", () => {
    const text = formatHudText(
      makeInputs({ stats: makeStats({ renderMs: BUDGET.renderCpuMs + 1 }) }),
    );
    expect(lineStartingWith(text, "render")).toContain("!");
  });

  it("does not mark draw calls under the current scene target", () => {
    const text = formatHudText(makeInputs({ drawCalls: 5 }));
    expect(lineStartingWith(text, "draws")).not.toContain("!");
  });

  it("marks draw calls over the current scene target: one above SCENE_TARGETS.drawCalls 16", () => {
    const text = formatHudText(makeInputs({ drawCalls: SCENE_TARGETS.drawCalls + 1 }));
    expect(SCENE_TARGETS.drawCalls).toBe(16);
    expect(lineStartingWith(text, "draws")).toContain("!");
  });

  it("does not mark triangles under target", () => {
    const text = formatHudText(makeInputs({ triangles: 800 }));
    expect(lineStartingWith(text, "tris")).not.toContain("!");
  });

  it("marks triangles over target: one above SCENE_TARGETS.triangles 45000", () => {
    const text = formatHudText(makeInputs({ triangles: SCENE_TARGETS.triangles + 1 }));
    expect(SCENE_TARGETS.triangles).toBe(45000);
    expect(lineStartingWith(text, "tris")).toContain("!");
  });

  it("renders body count as active over total, e.g. 7 active / 8 total", () => {
    const text = formatHudText(makeInputs({ activeBodies: 7, totalBodies: 8 }));
    expect(text).toContain("7 active / 8 total");
  });

  it("includes dropped ticks and steps-this-frame, making stalls and clamp saturation observable", () => {
    const text = formatHudText(makeInputs({ stats: makeStats({ steps: 3, droppedTicks: 42 }) }));
    expect(text).toContain("dropped 42");
    expect(text).toMatch(/3 step/);
  });

  it("labels the render line as CPU submit time, not GPU time", () => {
    const text = formatHudText(makeInputs());
    expect(lineStartingWith(text, "render")?.toLowerCase()).toContain("cpu submit");
  });

  it("is deterministic: identical inputs yield byte-identical strings", () => {
    const inputs = makeInputs();
    expect(formatHudText(inputs)).toBe(formatHudText(inputs));
    expect(formatHudText(makeInputs())).toBe(formatHudText(makeInputs()));
  });

  it("omits the pos line when carPosition is not supplied", () => {
    const text = formatHudText(makeInputs());
    expect(text).not.toMatch(/^pos /m);
  });

  it("prints the car position when carPosition is supplied (D-06 sign-off tooling)", () => {
    const text = formatHudText(makeInputs({ carPosition: { x: -420.001, y: 0, z: 102.229 } }));
    expect(lineStartingWith(text, "pos")).toContain("x=-420.00  y=0.00  z=102.23");
  });

  it("is pure: a plain HudInputs object is enough, no DOM/renderer/world needed", () => {
    // No `document`, no `THREE.WebGLRenderer`, no `RAPIER.World` exist in this
    // Node test environment at all — the fact that this runs and returns a
    // string is itself the proof formatHudText touches none of them.
    expect(typeof formatHudText(makeInputs())).toBe("string");
  });
});
