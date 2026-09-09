import { describe, expect, it } from "vitest";
import {
  DEBUG_ENABLED,
  isTextEntryFocused,
  onDebugKey,
  onDebugToggle,
  parseDebugFlag,
} from "../src/debug/debug-gate";

/**
 * Only `parseDebugFlag` and `isTextEntryFocused` are fully exercised here.
 * `DEBUG_ENABLED`, `onDebugKey` and `onDebugToggle` touch `location` and
 * `addEventListener`, which do not exist in Vitest's `node` environment — see
 * `vitest.config.ts` (`test.environment: "node"`, shared by every Rapier test
 * in this repo). `debug-gate.ts` guards its `location.search` read with a
 * `typeof` check specifically so that importing the module here does not
 * throw, and the same absence of a DOM is what lets the "registers zero
 * listeners" case below run safely: `DEBUG_ENABLED` is `false` in this
 * environment, so both functions return before ever touching
 * `addEventListener`.
 */
describe("parseDebugFlag", () => {
  it('is true for "?debug"', () => {
    expect(parseDebugFlag("?debug")).toBe(true);
  });

  it('is true for "?debug=0" — presence check, not a value check', () => {
    // An attacker (or a bookmarked link) setting debug=0 must not disable the
    // gate differently than plain presence would. ASVS V5: never branch on the
    // parameter's value.
    expect(parseDebugFlag("?debug=0")).toBe(true);
  });

  it("is true and returns a boolean for a script-tag value, never the string itself", () => {
    const result = parseDebugFlag("?debug=<script>alert(1)</script>");
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it('is false for "?other=1"', () => {
    expect(parseDebugFlag("?other=1")).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(parseDebugFlag("")).toBe(false);
  });

  it('is true for "?a=1&debug&b=2" — presence among other params', () => {
    expect(parseDebugFlag("?a=1&debug&b=2")).toBe(true);
  });

  it("has no side effects: calling it 1000 times touches no DOM", () => {
    // There is no DOM in this test environment at all — if the function ever
    // reached for `document` or `window`, this loop would throw.
    for (let i = 0; i < 1000; i++) {
      parseDebugFlag("?debug");
    }
    expect(parseDebugFlag("?debug")).toBe(true);
  });
});

describe("isTextEntryFocused", () => {
  it("is false for null", () => {
    const result = isTextEntryFocused(null);
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });

  it("is true for a fake INPUT element", () => {
    const result = isTextEntryFocused({ tagName: "INPUT" } as unknown as Element);
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it("is true for a fake TEXTAREA element", () => {
    const result = isTextEntryFocused({ tagName: "TEXTAREA" } as unknown as Element);
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it("is true for a fake contenteditable DIV", () => {
    const result = isTextEntryFocused({
      tagName: "DIV",
      isContentEditable: true,
    } as unknown as Element);
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it("is false for a fake non-contenteditable DIV", () => {
    const result = isTextEntryFocused({
      tagName: "DIV",
      isContentEditable: false,
    } as unknown as Element);
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });

  it("is false for a fake CANVAS element", () => {
    const result = isTextEntryFocused({ tagName: "CANVAS" } as unknown as Element);
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });
});

describe("onDebugKey / onDebugToggle", () => {
  it("are both exported functions", () => {
    expect(typeof onDebugKey).toBe("function");
    expect(typeof onDebugToggle).toBe("function");
  });

  it("register zero listeners and do not throw when DEBUG_ENABLED is false (the Node default)", () => {
    // Mirrors the "registers zero listeners in a normal build" property the
    // rest of this suite already relies on: in this Node environment
    // DEBUG_ENABLED is false, so calling either function must return
    // immediately without touching `addEventListener` (which does not exist
    // here) or throwing.
    expect(DEBUG_ENABLED).toBe(false);
    expect(() => onDebugKey("KeyG", () => {})).not.toThrow();
    expect(() => onDebugToggle(() => {})).not.toThrow();
  });
});
