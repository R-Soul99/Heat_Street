import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUDGET, PHASE1_DEBUG_SCENE_TARGETS } from "../src/core/frame-budget";

const DOC_PATH = fileURLToPath(new URL("../docs/frame-budget.md", import.meta.url));
const doc = readFileSync(DOC_PATH, "utf8");

/**
 * Every millisecond figure is matched WITH its unit (`"4.0 ms"`, not `"4"`), and
 * every count is matched with its comparator (`"< 20"`). A bare `String(4.0)` is
 * `"4"`, which occurs everywhere in prose and dates — such a test would stay green
 * while the doc and the constants drifted, which is the one thing it exists to stop.
 */
const MS_SLICES = ["frameMs", "physicsMs", "renderCpuMs", "gameLogicMs", "headroomMs"] as const;

describe("frame budget constants (D-04)", () => {
  it("locks the total frame at 16.6 ms and physics at 4.0 ms", () => {
    expect(BUDGET.frameMs).toBe(16.6);
    expect(BUDGET.physicsMs).toBe(4.0);
  });

  it("splits the frame exactly: the four sub-slices sum to the total", () => {
    const sum = BUDGET.physicsMs + BUDGET.renderCpuMs + BUDGET.gameLogicMs + BUDGET.headroomMs;
    expect(sum).toBeCloseTo(BUDGET.frameMs, 9);
  });

  it("keeps the Phase 1 debug-scene targets far under the global budget", () => {
    expect(PHASE1_DEBUG_SCENE_TARGETS.physicsMs).toBeLessThan(BUDGET.physicsMs);
  });
});

describe("frame budget doc mirrors the code", () => {
  it("has a real document, not an empty placeholder", () => {
    expect(doc.length).toBeGreaterThan(400);
  });

  it("names all five HUD-visible budget slices", () => {
    for (const label of ["Total frame", "Physics step", "Render", "Game logic", "headroom"]) {
      expect(doc).toContain(label);
    }
  });

  it("labels the render figure honestly as CPU submit time", () => {
    expect(doc.toLowerCase()).toContain("cpu submit");
  });

  it.each(MS_SLICES)("states BUDGET.%s verbatim, with its unit", (key) => {
    expect(doc).toContain(`${BUDGET[key].toFixed(1)} ms`);
  });

  it("states every Phase 1 debug-scene target verbatim", () => {
    expect(doc).toContain(`${PHASE1_DEBUG_SCENE_TARGETS.physicsMs.toFixed(1)} ms`);
    expect(doc).toContain(`< ${PHASE1_DEBUG_SCENE_TARGETS.drawCalls}`);
    expect(doc).toContain(`< ${PHASE1_DEBUG_SCENE_TARGETS.bodies}`);

    const triangles = PHASE1_DEBUG_SCENE_TARGETS.triangles;
    const grouped = triangles.toLocaleString("en-US");
    expect(doc.includes(`${triangles}`) || doc.includes(grouped)).toBe(true);
  });

  it("points a future reader at the test that keeps the two in sync", () => {
    expect(doc).toContain("src/core/frame-budget.ts");
    expect(doc).toContain("tests/frame-budget.test.ts");
  });
});
