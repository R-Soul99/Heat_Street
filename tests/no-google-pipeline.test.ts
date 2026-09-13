import { describe, expect, it } from "vitest";
import {
  ADR_POINTER,
  findViolations,
  formatViolations,
  isCommentLine,
} from "./google-pipeline-matcher";

/**
 * SC5 enforcement: no file in the shipped-pipeline scope may recommend the
 * retired map-extraction pipeline without pointing at the ADR that supersedes it.
 *
 * SCOPE DECISION RECORD: plan 01-03
 * (.planning/phases/01-engine-foundation/01-03-PLAN.md, <grep_scope_decision>),
 * AMENDED by plan 04-01 (.planning/phases/04-map-pipeline-first-area/04-01-PLAN.md,
 * Task 1) to add a fifth `tools` TypeScript-tree leg below — the new offline
 * map-compiler tree is exactly the kind of file that could carry a stray "Google Maps
 * extraction" comment (copy-pasted from an old design doc, or written while
 * explaining what NOT to do) without this widening. Do not widen or narrow it
 * here again — amend the plan and this comment together.
 *
 * .planning/** is deliberately OUT of scope: it is a dated audit trail, not
 * instructions to a builder. The compensating control is the supersession banner
 * at the top of .planning/research/STACK.md.
 */

/**
 * The declared scan set. These strings mirror the `import.meta.glob` literals
 * below one-for-one; Vite requires those to be inline literals, so this array is
 * the human-readable record and the assertion target, not the input.
 */
const SCANNED_GLOBS = [
  "*.md",
  "docs/**/*.md",
  "src/**/*.ts",
  "tests/**/*.ts",
  "tools/**/*.ts",
] as const;

/** Files permitted to name the retired pipeline, because naming it is their job. */
const ALLOWLIST = [
  // The ADR IS the authority. It names the retired source in order to prohibit it.
  "docs/adr/0001-map-data-source.md",
  // This file states the pattern it greps for. Belt-and-braces: Vite's
  // import.meta.glob already excludes the importing module from its own result,
  // so this entry is defensive. Keep it — the exclusion is a Vite implementation
  // detail, and the scope decision names this file explicitly.
  "tests/no-google-pipeline.test.ts",
] as const;

/** Never scanned. Asserted below so a widened glob cannot silently pull them in. */
const EXCLUDED_DIRS = [".planning", "node_modules", "dist", ".git"] as const;

/**
 * Files are read through Vite's `?raw` glob transform rather than `node:fs`.
 * `@types/node` is not installed and this phase's threat model (T-01-SC) forbids
 * adding packages; see plan 01-02's deviation. The files are still genuinely read
 * from disk on every run.
 */
const SCANNED: Record<string, string> = {
  ...import.meta.glob<string>("../*.md", { query: "?raw", eager: true, import: "default" }),
  ...import.meta.glob<string>("../docs/**/*.md", { query: "?raw", eager: true, import: "default" }),
  ...import.meta.glob<string>("../src/**/*.ts", { query: "?raw", eager: true, import: "default" }),
  ...import.meta.glob<string>("../tests/**/*.ts", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
  ...import.meta.glob<string>("../tools/**/*.ts", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
};

/**
 * `../CLAUDE.md` -> `CLAUDE.md`.
 *
 * Vite normalises glob keys relative to THIS file's directory, so sibling test
 * modules come back as `./google-pipeline-matcher.ts`, not `../tests/…`.
 */
function repoPath(globKey: string): string {
  if (globKey.startsWith("./")) return `tests/${globKey.slice(2)}`;
  return globKey.replace(/^(\.\.\/)+/, "");
}

const SCANNED_PATHS = Object.keys(SCANNED).map(repoPath).sort();

describe("no retired map pipeline — the scan itself", () => {
  it("declares its scope as named constants", () => {
    expect(SCANNED_GLOBS).toHaveLength(5);
    expect(ALLOWLIST).toHaveLength(2);
    expect(ALLOWLIST).toContain(ADR_POINTER);
  });

  it("actually read files — a broken glob cannot make this suite trivially green", () => {
    expect(SCANNED_PATHS.length).toBeGreaterThan(0);
    for (const contents of Object.values(SCANNED)) {
      expect(typeof contents).toBe("string");
    }
  });

  it("scanned the specific files the scope decision names", () => {
    for (const expected of [
      "CLAUDE.md",
      "heat-street-design-doc.md",
      "PROJECT.md",
      "docs/adr/0001-map-data-source.md",
      "docs/frame-budget.md",
      "docs/schemas/road-graph.v1.md",
      "src/main.ts",
      // Proves the tests/**/*.ts leg of the glob resolves. This file itself is
      // excluded by Vite from its own glob, so it cannot be the witness.
      "tests/google-pipeline-matcher.ts",
      // Proves the tools/**/*.ts leg (added by plan 04-01) resolves — a
      // broken tools glob cannot pass this suite silently.
      "tools/map-compiler/cli.ts",
    ]) {
      expect(SCANNED_PATHS).toContain(expected);
    }
  });

  it("excludes .planning, node_modules, dist and .git", () => {
    for (const path of SCANNED_PATHS) {
      for (const excluded of EXCLUDED_DIRS) {
        expect(path.split("/")).not.toContain(excluded);
      }
    }
  });
});

describe("no retired map pipeline — the gate", () => {
  it("finds no unsuperseded recommendation in any scanned file", () => {
    const violations = Object.entries(SCANNED)
      .map(([key, contents]) => ({ path: repoPath(key), contents }))
      .filter(({ path }) => !ALLOWLIST.some((allowed) => allowed === path))
      .flatMap(({ path, contents }) => findViolations(path, contents));

    // Empty string on success; on failure the diff prints file:line: text.
    expect(formatViolations(violations)).toBe("");
  });
});

describe("no retired map pipeline — the matcher is discriminating", () => {
  const SYNTHETIC = "the road polylines you already have from the Google Maps extraction tool";

  it("flags a synthetic recommendation appended to a scanned file's contents", () => {
    const contents = `${SCANNED["../docs/schemas/road-graph.v1.md"]}\n${SYNTHETIC}\n`;
    const violations = findViolations("docs/schemas/road-graph.v1.md", contents);
    expect(violations).toHaveLength(1);
    expect(violations[0].text).toBe(SYNTHETIC);
    expect(formatViolations(violations)).toContain("docs/schemas/road-graph.v1.md:");
  });

  it("reports the correct 1-based line number", () => {
    const violations = findViolations("synthetic.md", `a\nb\n${SYNTHETIC}\nc\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });

  it("does not flag a mention that carries the ADR pointer within six lines", () => {
    const contents = `${SYNTHETIC}\n\nSuperseded by ${ADR_POINTER}.\n`;
    expect(findViolations("synthetic.md", contents)).toHaveLength(0);
  });

  it("does flag a mention whose only pointer is more than six lines away", () => {
    const filler = "\n".repeat(9);
    const contents = `${SYNTHETIC}${filler}Superseded by ${ADR_POINTER}.\n`;
    expect(findViolations("synthetic.md", contents)).toHaveLength(1);
  });

  it("drops comment lines before matching, so a banner cannot trip the gate", () => {
    expect(isCommentLine("> SUPERSEDED — see the ADR")).toBe(true);
    expect(isCommentLine("// a code comment")).toBe(true);
    expect(isCommentLine(" * a jsdoc continuation")).toBe(true);
    expect(isCommentLine("/* a block open")).toBe(true);
    expect(isCommentLine("a plain prose line")).toBe(false);
    expect(findViolations("synthetic.md", `> ${SYNTHETIC}\n`)).toHaveLength(0);
  });

  it("is case-insensitive and matches Earth and Street View too", () => {
    expect(findViolations("s.md", "traced from google earth imagery\n")).toHaveLength(1);
    expect(findViolations("s.md", "exported from Google Street View\n")).toHaveLength(1);
    expect(findViolations("s.md", "GOOGLEMAPS tiles\n")).toHaveLength(1);
  });

  it("does not flag unrelated prose", () => {
    expect(findViolations("s.md", "OpenStreetMap plus an open DEM\n")).toHaveLength(0);
  });
});
