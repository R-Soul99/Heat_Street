import { describe, expect, it } from "vitest";
import { formatTelemetryRow, formatTelemetrySummary } from "../src/debug/telemetry-hud";
import type { RoutineResult } from "../src/physics/telemetry/routines";

/**
 * Only the pure formatters are exercised here — `createTelemetryHud` needs a
 * DOM and a live `getTuning` callback, neither of which exist in Vitest's
 * `node` environment; the plan's browser checkpoint (02-10) covers it once
 * `main.ts` wires the panel in, exactly as `tests/profiler-hud.test.ts:6-11`
 * scopes itself to `formatHudText` alone.
 */

function makeResult(overrides: Partial<RoutineResult> = {}): RoutineResult {
  return {
    id: "accel",
    label: "0-60 mph",
    value: 6.35,
    unit: "s",
    target: "6.0-7.0 s",
    pass: true,
    ...overrides,
  };
}

describe("formatTelemetryRow", () => {
  it("contains the literal PASS and not FAIL for a passing result", () => {
    const text = formatTelemetryRow(makeResult({ pass: true }));
    expect(text).toContain("PASS");
    expect(text).not.toContain("FAIL");
  });

  it("contains the literal FAIL for a failing result", () => {
    const text = formatTelemetryRow(makeResult({ pass: false }));
    expect(text).toContain("FAIL");
  });

  it("maps every routine id to its 02-UI-SPEC.md display label", () => {
    // One `it` asserting the full set, so a renamed routine id fails loudly
    // rather than one of six near-identical cases silently going stale.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["accel", "0-60 mph"],
      ["brake", "60-0 braking"],
      ["skidpad", "Skidpad"],
      ["slalom", "Slalom"],
      ["ramp", "Ramp landing"],
      ["stability", "Roll stability"],
    ];
    for (const [id, expectedLabel] of cases) {
      // `label` is deliberately set to something that does NOT match, so a
      // pass here can only be explained by the id -> label table, never by
      // `RoutineResult.label` leaking through.
      const text = formatTelemetryRow(makeResult({ id, label: "not-the-display-label" }));
      expect(text).toContain(expectedLabel);
    }
  });

  it("pads rows for differing value magnitudes to identical length", () => {
    // Not padding. Without fixed-width columns, a large measured value would
    // produce a longer row than a small one, and the table would not align.
    const small = formatTelemetryRow(makeResult({ value: 0.1 }));
    const large = formatTelemetryRow(makeResult({ value: 123456.78 }));
    expect(small.length).toBe(large.length);
  });

  it("is deterministic: identical inputs yield byte-identical strings", () => {
    const r = makeResult();
    expect(formatTelemetryRow(r)).toBe(formatTelemetryRow(r));
  });

  it("is pure: a plain RoutineResult is enough, no DOM/tuning/world needed", () => {
    // No `document`, no `VehicleTuning`, no `RAPIER.World` exist in this Node
    // test environment at all — the fact that this runs and returns a string
    // is itself the proof `formatTelemetryRow` touches none of them.
    expect(typeof formatTelemetryRow(makeResult())).toBe("string");
  });
});

describe("formatTelemetrySummary", () => {
  it("formats six results with four passing as exactly '4 of 6 passed'", () => {
    const results: RoutineResult[] = [
      makeResult({ id: "accel", pass: true }),
      makeResult({ id: "brake", pass: true }),
      makeResult({ id: "skidpad", pass: true }),
      makeResult({ id: "slalom", pass: true }),
      makeResult({ id: "ramp", pass: false }),
      makeResult({ id: "stability", pass: false }),
    ];
    expect(formatTelemetrySummary(results)).toBe("4 of 6 passed");
  });
});
