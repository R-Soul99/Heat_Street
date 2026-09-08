import { describe, expect, it } from "vitest";

/**
 * Automated enforcement of the import-direction and wall-clock rules
 * (01-RESEARCH.md "Architectural Responsibility Map", 01-PATTERNS.md "Shared
 * Patterns > Layering / import direction"). This is what makes SC1 and SC3
 * survive future edits rather than depending on every later phase's author
 * remembering seven rules from a research document.
 *
 * Files are read through Vite's `?raw` glob transform with an INLINE query
 * literal, matching the convention established in `tests/docs-present.test.ts`
 * and `tests/no-google-pipeline.test.ts` — `@types/node` is not installed and
 * this phase's threat model (T-01-SC) forbids adding packages, so `node:fs`
 * is not available under `tsc --noEmit`. The files are still genuinely read
 * from disk on every run.
 */

const SRC = import.meta.glob<string>("../src/**/*.ts", {
  query: "?raw",
  eager: true,
  import: "default",
});

interface SourceFile {
  readonly path: string;
  readonly raw: string;
}

/** Vite glob keys are relative to THIS file's directory: `../src/x.ts` -> `src/x.ts`. */
function toRepoPath(globKey: string): string {
  return globKey.replace(/^(\.\.\/)+/, "");
}

const FILES: readonly SourceFile[] = Object.entries(SRC)
  .map(([key, raw]) => ({ path: toRepoPath(key), raw }))
  .sort((a, b) => a.path.localeCompare(b.path));

interface Hit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * A comment line cannot trip a rule that names the pattern it forbids —
 * without this, a doc comment explaining "no world.step in src/render" would
 * itself be flagged for containing "world.step".
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** Every non-comment line in `file` matching `pattern`, as file:line:text hits. */
function findHits(file: SourceFile, pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  const lines = file.raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (pattern.test(lines[i])) {
      hits.push({ path: file.path, line: i + 1, text: lines[i].trim() });
    }
  }
  return hits;
}

function scan(files: readonly SourceFile[], pattern: RegExp): Hit[] {
  return files.flatMap((f) => findHits(f, pattern));
}

/** Every failure names the file, the line number and the offending line. */
function format(hits: readonly Hit[]): string {
  return hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n");
}

describe("layering — the scan itself", () => {
  it("found at least ten source files, so a broken glob cannot make this suite trivially green", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(10);
  });
});

describe("layering — src/core stays pure (T-01-06)", () => {
  const coreFiles = FILES.filter((f) => f.path.startsWith("src/core/"));
  // A single pattern for "imports three or rapier, or touches the DOM /
  // wall clock" — matched against `from "three"` / `from "@dimforge/rapier3d"`
  // rather than the word `import`, so `import type` and re-exports are caught
  // too, and against the bare identifiers a core file must never reference.
  const FORBIDDEN =
    /from\s+["'](three|@dimforge\/rapier3d)["']|\bdocument\.|\bwindow\.|\bperformance\.|\brequestAnimationFrame\b/;

  it("scanned at least one src/core file", () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  for (const file of coreFiles) {
    it(`${file.path} imports nothing from three/@dimforge/rapier3d and touches no document/window/performance/requestAnimationFrame`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});

describe("layering — src/physics never imports three", () => {
  const physicsFiles = FILES.filter((f) => f.path.startsWith("src/physics/"));
  const FORBIDDEN = /from\s+["']three["']/;

  it("scanned at least one src/physics file", () => {
    expect(physicsFiles.length).toBeGreaterThan(0);
  });

  for (const file of physicsFiles) {
    it(`${file.path} does not import three`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});

describe("layering — src/render never writes simulation state (T-01-15)", () => {
  const renderFiles = FILES.filter((f) => f.path.startsWith("src/render/"));
  const FORBIDDEN = /\b(world\.step|applyImpulse|setTranslation|setRotation|setNextKinematic)\b/;

  it("scanned at least one src/render file", () => {
    expect(renderFiles.length).toBeGreaterThan(0);
  });

  for (const file of renderFiles) {
    it(`${file.path} contains none of world.step / applyImpulse / setTranslation / setRotation / setNextKinematic`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});

describe("layering — requestAnimationFrame lives in exactly one file (T-01-24)", () => {
  it("appears only in src/loop.ts", () => {
    const hits = scan(FILES, /\brequestAnimationFrame\b/);
    const filesWithHits = [...new Set(hits.map((h) => h.path))];
    expect(filesWithHits).toEqual(["src/loop.ts"]);
  });
});

describe("layering — wall-clock reads confined to src/loop.ts and src/debug/** (T-01-26)", () => {
  it("performance.now( and Date.now( appear only in src/loop.ts and files under src/debug/", () => {
    const pattern = /performance\.now\(|Date\.now\(/;
    const offenders = scan(
      FILES.filter((f) => f.path !== "src/loop.ts" && !f.path.startsWith("src/debug/")),
      pattern,
    );
    expect(format(offenders)).toBe("");
  });
});

describe("layering — no innerHTML anywhere under src/ (T-01-28)", () => {
  it("finds zero occurrences", () => {
    expect(format(scan(FILES, /\binnerHTML\b/))).toBe("");
  });
});
