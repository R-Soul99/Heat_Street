import { describe, expect, it } from "vitest";
import { compileOutcome, countsText, worldSizeText } from "./ui-text.ts";

describe("worldSizeText", () => {
  it("shows 3 dp km", () => {
    expect(worldSizeText(934.5318244236144, 1960)).toBe("0.935 x 1.960 km");
  });
});

describe("countsText", () => {
  it("pluralises", () => {
    expect(countsText(12, 3)).toBe("12 roads, 3 buildings");
    expect(countsText(1, 1)).toBe("1 road, 1 building");
  });
});

describe("compileOutcome", () => {
  it("ok on a clean log", () => {
    expect(compileOutcome("$ node cli.ts\nok\n")).toEqual({ ok: true, summary: "Compiled." });
  });
  it("uses the first error line on failure", () => {
    const r = compileOutcome("$ node x\nsome noise\nTypeError: boom\n[exit 1]\n");
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("TypeError: boom");
  });
  it("truncates a long error line to 160 chars", () => {
    const r = compileOutcome(`error ${"x".repeat(400)}\n[exit 1]`);
    expect(r.summary.length).toBe(160);
  });
  it("falls back when no error line exists", () => {
    const r = compileOutcome("$ node x\n[exit 2]\n");
    expect(r).toEqual({ ok: false, summary: "Compile failed (see Help > Show log)." });
  });
  it("explains an unregistered map", () => {
    const r = compileOutcome("unknown area foo\n");
    expect(r.ok).toBe(false);
    expect(r.summary).toBe(
      "This map is not registered with the compiler yet. Add its two lines to tools/map-compiler/cli.ts (shown when it was created), then compile again.",
    );
  });
});
