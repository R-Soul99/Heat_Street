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
  it("found at least twenty-eight source files, so a broken glob cannot make this suite trivially green", () => {
    // Raised from 10 to 20 in plan 02-05, and from 20 to 28 here in plan
    // 03-07, for the same reason each time: Phase 3 adds roughly ten new
    // source files (src/render/camera/**, src/physics/surface*.ts,
    // src/render/surface-view.ts, src/physics/telemetry/surface-routines.ts,
    // etc.), so the floor stays a meaningful guard against a broken glob
    // rather than a value that was only ever true in an earlier phase.
    expect(FILES.length).toBeGreaterThanOrEqual(28);
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

describe("layering — src/hud never imports an engine and never writes simulation state (T-02-14)", () => {
  const hudFiles = FILES.filter((f) => f.path.startsWith("src/hud/"));
  // Combines the src/core/ engine-import half with the src/render/ write-ban
  // half. Deliberately DROPS \bdocument\. — the HUD legitimately calls
  // document.createElementNS to build its SVG. Deliberately does NOT
  // duplicate a \bperformance\. check — lines 140-149 below already cover
  // wall-clock reads repo-wide. Do not "tighten" this rule to add either
  // back; both omissions are load-bearing for a HUD built with real DOM
  // elements, not a gauge on where the check gets tighter.
  const FORBIDDEN =
    /from\s+["'](three|@dimforge\/rapier3d)["']|\b(world\.step|applyImpulse|setTranslation|setRotation|setNextKinematic)\b/;

  it("scanned at least one src/hud file", () => {
    expect(hudFiles.length).toBeGreaterThan(0);
  });

  for (const file of hudFiles) {
    it(`${file.path} imports nothing from three/@dimforge/rapier3d and writes no simulation state`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});

describe("layering — src/input never imports three and never writes simulation state (T-02-15)", () => {
  const inputFiles = FILES.filter((f) => f.path.startsWith("src/input/"));
  // The repo-wide performance.now(/Date.now( rule at lines 140-149 below is
  // what mechanically prevents a wall-clock-driven steering ramp in this
  // tier — that rule only works because src/input/ is not on its exception
  // list, so it is not duplicated here.
  const FORBIDDEN =
    /from\s+["']three["']|\b(world\.step|applyImpulse|setTranslation|setRotation|setNextKinematic)\b/;

  it("scanned at least one src/input file", () => {
    expect(inputFiles.length).toBeGreaterThan(0);
  });

  for (const file of inputFiles) {
    it(`${file.path} does not import three and writes no simulation state`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});

describe("layering — src/render/camera never imports src/physics (T-03-20)", () => {
  const cameraFiles = FILES.filter((f) => f.path.startsWith("src/render/camera/"));
  // This is what keeps the whole camera tier reusable for a Phase 7/8
  // pursuer (D-13) and what stops camera code from reaching into the
  // simulation — the rig follows a generic `CameraTarget`, never a concrete
  // physics body.
  const FORBIDDEN = /from\s+["'][^"']*physics\//;

  it("scanned at least one src/render/camera file", () => {
    expect(cameraFiles.length).toBeGreaterThan(0);
  });

  for (const file of cameraFiles) {
    it(`${file.path} does not import from src/physics`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});

describe("layering — src/render/camera never expresses smoothing in ticks (T-03-21)", () => {
  const cameraFiles = FILES.filter((f) => f.path.startsWith("src/render/camera/"));
  // 03-RESEARCH.md Pitfall 3's warning sign is "a camera-smoothing constant
  // expressed in ticks rather than seconds"; this is that warning sign made
  // mechanical. The camera runs on `dtMs` from the variable render frame,
  // never on the fixed physics tick, so nothing in this tier may import the
  // fixed-tick clock or reference its tick-count constant.
  const FORBIDDEN = /from\s+["'][^"']*sim-clock["']|\bDT\b/;

  it("scanned at least one src/render/camera file", () => {
    expect(cameraFiles.length).toBeGreaterThan(0);
  });

  for (const file of cameraFiles) {
    it(`${file.path} does not import sim-clock and does not reference DT`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});

describe("layering — camera-math.ts and occlusion.ts never import three (T-03-22)", () => {
  // Scoped to these two EXACT paths, not the whole src/render/camera/ tier —
  // this is the property that keeps the Wave-0 tests runnable under
  // `vitest.config.ts`'s `environment: "node"`. Without a mechanical guard,
  // a future edit adding one `THREE.Vector3` to either file would silently
  // make three Node-tested files unrunnable.
  const files = FILES.filter(
    (f) =>
      f.path === "src/render/camera/camera-math.ts" || f.path === "src/render/camera/occlusion.ts",
  );
  const FORBIDDEN = /from\s+["']three["']/;

  it("scanned at least one file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.path} does not import three`, () => {
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

// FORWARD REFERENCE for plan 03-11: `src/audio/**` does not exist yet (it
// lands in that plan), so no layering rule is added for it here — the
// "scanned at least one file" guard on an empty filter would fail and make
// the rule trivially green for the wrong reason. Plan 03-11 must add its own
// `describe` block for that tier, following this file's existing shape.
