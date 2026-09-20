import { describe, expect, it } from "vitest";
import { SURFACE_TYPES } from "../src/core/surface-types";

/**
 * T-L94's doc/code mirroring gate: every numeric control the live tuning
 * panel actually binds (`src/debug/tuning-panel.ts`) must be named somewhere
 * in `docs/vehicle-tuning-guide.md`, or a control added or renamed later can
 * silently drift the guide out of date with no build failure. Mirrors the
 * inline `import.meta.glob` `?raw` eager-literal convention already used by
 * `tests/docs-present.test.ts` and `tests/layering.test.ts` — options
 * inline, not a named const, directory-relative keys. Neither glob below
 * targets `tests/`, so there is no risk of this file matching itself.
 */

const SRC_DEBUG_FILES = import.meta.glob<string>("../src/debug/*.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

const DOC_FILES = import.meta.glob<string>("../docs/*.md", {
  query: "?raw",
  eager: true,
  import: "default",
});

const panelSource = SRC_DEBUG_FILES["../src/debug/tuning-panel.ts"];
const guideText = DOC_FILES["../docs/vehicle-tuning-guide.md"];

/**
 * Matches one `addNumber(folder, obj, "key", range)` call — however many
 * lines it is formatted across — and captures the raw key. `[^,]+` (not a
 * lazy dot-star) is deliberate: none of the folder/object/range arguments in
 * this file ever contain a comma, so this cleanly isolates the always-quoted
 * third argument without a fragile non-greedy wildcard that could overshoot
 * into a neighbouring call.
 */
const ADD_NUMBER_CALL = /addNumber\(\s*[^,]+,\s*[^,]+,\s*"([A-Za-z0-9_]+)"\s*,\s*[^)]+\)/g;

/** How far past an `addNumber(...)` call's closing paren to look for a
 * chained `.name("dotted.form")` override — long enough to span the small
 * amount of whitespace/formatting between the two, short enough that it
 * cannot accidentally reach into the NEXT control's own `.name(...)`. */
const NAME_WINDOW = 80;

/**
 * Every identifier bound through a literal `addNumber(...)` call SITE in the
 * source, in source order. This is a static text scan, not a runtime trace —
 * the Surfaces folder's `for (const surface of SURFACE_TYPES)` loop is ONE
 * call site in the source text (executed six times at runtime), so it
 * contributes exactly its two raw keys (`forwardGrip`/`lateralGrip`) here,
 * not twelve. The six real per-surface controls that loop produces at
 * runtime are verified separately, directly from `SURFACE_TYPES`, in
 * `surfaceIdentifiers()` below — combined with this function's output, that
 * is what the "at least 70" floor actually counts.
 *
 * For the six ambiguous `x`/`y`/`z` chassis leaves (`comOffset.*`,
 * `halfExtents.*`), the panel disambiguates with a chained
 * `.name("comOffset.x")`-style call using a plain string literal — this
 * function prefers that dotted display name over the bare key whenever one
 * immediately follows. The Surfaces folder's own `.name(...)` calls use a
 * template literal (`` `${surface} fwd` ``), not a plain string, so they do
 * NOT match this override and fall through to the raw `forwardGrip`/
 * `lateralGrip` key instead, which is exactly why those two need the
 * separate, SURFACE_TYPES-driven check below.
 */
function extractedControlIdentifiers(source: string): string[] {
  const identifiers: string[] = [];
  for (const match of source.matchAll(ADD_NUMBER_CALL)) {
    const rawKey = match[1];
    const tailStart = (match.index ?? 0) + match[0].length;
    const tail = source.slice(tailStart, tailStart + NAME_WINDOW);
    const nameMatch = tail.match(/^\s*\.name\("([A-Za-z0-9_.]+)"\)/);
    identifiers.push(nameMatch ? nameMatch[1] : rawKey);
  }
  return identifiers;
}

/** The twelve real per-surface controls the Surfaces folder's loop produces
 * at runtime — one iteration per `SURFACE_TYPES` entry, two controls each —
 * derived directly from `SURFACE_TYPES` rather than from the loop body
 * itself, per this suite's own design (the loop body is a single static
 * call site, see `extractedControlIdentifiers` above). */
function surfaceIdentifiers(): string[] {
  const identifiers: string[] = [];
  for (const surface of SURFACE_TYPES) {
    identifiers.push(`${surface} fwd`, `${surface} lat`);
  }
  return identifiers;
}

describe("tuning-guide-sync — inputs are present", () => {
  it("found src/debug/tuning-panel.ts and docs/vehicle-tuning-guide.md", () => {
    expect(panelSource, "src/debug/tuning-panel.ts via glob").toBeTypeOf("string");
    expect(guideText, "docs/vehicle-tuning-guide.md via glob").toBeTypeOf("string");
  });
});

const regexExtracted = extractedControlIdentifiers(panelSource ?? "");
const allExtracted = [...regexExtracted, ...surfaceIdentifiers()];

describe("tuning-guide-sync — the extraction itself", () => {
  it("extracted at least 70 controls (regex-matched + SURFACE_TYPES-derived), so a broken extraction cannot pass", () => {
    expect(allExtracted.length).toBeGreaterThanOrEqual(70);
  });
});

describe("tuning-guide-sync — every addNumber-bound control appears in the guide", () => {
  for (const identifier of new Set(allExtracted)) {
    it(`"${identifier}" appears in docs/vehicle-tuning-guide.md`, () => {
      expect(guideText).toContain(identifier);
    });
  }
});

describe("tuning-guide-sync — surface controls, verified from SURFACE_TYPES directly", () => {
  it("every surface name appears in the guide", () => {
    for (const surface of SURFACE_TYPES) {
      expect(guideText, `surface "${surface}"`).toContain(surface);
    }
  });

  it("both the fwd and lat display-name forms appear for every surface", () => {
    for (const surface of SURFACE_TYPES) {
      expect(guideText, `"${surface} fwd"`).toContain(`${surface} fwd`);
      expect(guideText, `"${surface} lat"`).toContain(`${surface} lat`);
    }
  });
});
