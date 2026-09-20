import { describe, expect, it } from "vitest";

/**
 * SC5 enforcement, half one: the documents the phase is judged on must exist and
 * must not be placeholders.
 *
 * Files are read through Vite's `?raw` glob transform rather than `node:fs`.
 * `@types/node` is not installed and this phase's threat model (T-01-SC) forbids
 * adding packages; see plan 01-02's deviation for the full reasoning. A missing
 * file simply does not appear as a glob key, which is exactly the existence check
 * this suite needs — and it fails with the path in the message.
 */

const PRESENT: Record<string, string> = {
  ...import.meta.glob<string>("../docs/**/*.md", { query: "?raw", eager: true, import: "default" }),
  ...import.meta.glob<string>("../fixtures/*.json", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
  ...import.meta.glob<string>("../LICENSE-*", { query: "?raw", eager: true, import: "default" }),
  // Plan 04-04: registers the compiled Juliette, GA artifact so it cannot
  // silently become a stub. Extending this glob set follows
  // tests/no-google-pipeline.test.ts's documented twin-update convention
  // (widen the glob and the REQUIRED entry together).
  ...import.meta.glob<string>("../public/maps/*.json", {
    query: "?raw",
    eager: true,
    import: "default",
  }),
};

function read(path: string): string {
  const contents = PRESENT[`../${path}`];
  if (contents === undefined) {
    throw new Error(
      `Required file is missing: ${path}. Present: ${Object.keys(PRESENT).sort().join(", ")}`,
    );
  }
  return contents;
}

/** Every path this phase promises exists, with its minimum size in characters. */
const REQUIRED: ReadonlyArray<{ path: string; minChars: number }> = [
  // Plan 04.1-11: raised 1500 -> 4000 after the phase 04.1 amendment (retired
  // DEM elevation, added the "Elevation — amended" subsection) roughly
  // doubled this document's length (~11.7k -> ~18.9k characters). 4000 stays
  // comfortably below the real length — matching how the other floors below
  // sit well under their own real sizes — so a routine wording edit cannot
  // trip it, while still being high enough that reverting the amendment back
  // toward the pre-04.1 length would fail this floor.
  { path: "docs/adr/0001-map-data-source.md", minChars: 4000 },
  // Plan 04-11: records the phase's locked decisions (area, compiler shape,
  // collision/render granularity, shared geometry, off-road ground, the
  // osmtogeojson rejection) so a future agent finds them instead of
  // relitigating them.
  { path: "docs/adr/0004-first-area-and-compiler-decisions.md", minChars: 1500 },
  { path: "docs/schemas/road-graph.v1.md", minChars: 1500 },
  // OWNED BY PLAN 01-02, NOT BY 01-03. This is the deliberate cross-plan presence
  // check, and it is why plan 01-03 declares depends_on: ["01-01", "01-02"] — a
  // parallel wave would otherwise let this assertion run before the file exists.
  // Do NOT create, touch or stub docs/frame-budget.md from plan 01-03; a second
  // writer on that path would conflict with 01-02. If it is genuinely absent,
  // that is a real ordering failure to report, not something to paper over.
  { path: "docs/frame-budget.md", minChars: 1000 },
  { path: "fixtures/road-graph.sample.json", minChars: 500 },
  { path: "LICENSE-MAPDATA", minChars: 500 },
  // Plan 04-04: the first real compiled area artifact. 36 retained ways
  // compile to 50 nodes / 64 edges pretty-printed — a stub or truncated
  // write would be nowhere near this floor.
  { path: "public/maps/juliette-ga.map.json", minChars: 5000 },
];

describe("SC5 documents are present and substantive", () => {
  it("found files to check — a broken glob cannot make this suite green", () => {
    expect(Object.keys(PRESENT).length).toBeGreaterThanOrEqual(REQUIRED.length);
  });

  for (const { path, minChars } of REQUIRED) {
    it(`${path} exists and is non-empty`, () => {
      expect(read(path).length).toBeGreaterThan(0);
    });

    it(`${path} exceeds ${minChars} characters, so a placeholder cannot pass`, () => {
      expect(read(path).length).toBeGreaterThan(minChars);
    });
  }

  it("the ADR records the OpenStreetMap decision", () => {
    expect(read("docs/adr/0001-map-data-source.md")).toContain("OpenStreetMap");
  });

  // Plan 04.1-11: guards the phase 04.1 amendment against silent reversion —
  // a future edit that quietly reverted ADR 0001 back to claiming DEM
  // provenance while the compiler still emits its post-amendment demSource
  // value would otherwise go unnoticed by this suite.
  it("the ADR records the phase 04.1 elevation amendment", () => {
    expect(read("docs/adr/0001-map-data-source.md")).toContain("none-flat-authored");
  });

  it("the schema doc specifies schemaVersion", () => {
    expect(read("docs/schemas/road-graph.v1.md")).toContain("schemaVersion");
  });

  it("the fixture parses as JSON", () => {
    expect(() => JSON.parse(read("fixtures/road-graph.sample.json"))).not.toThrow();
  });

  it("LICENSE-MAPDATA licenses compiled map data under ODbL", () => {
    const licence = read("LICENSE-MAPDATA");
    expect(licence).toContain("ODbL");
    expect(licence).toContain("opendatacommons.org/licenses/odbl/1-0");
  });

  it("reports the missing path by name when a required file is absent", () => {
    expect(() => read("docs/this-file-does-not-exist.md")).toThrow(
      /docs\/this-file-does-not-exist\.md/,
    );
  });
});
