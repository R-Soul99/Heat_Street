import { describe, expect, it } from "vitest";
// Real committed artifact, read through Vite's `?raw` transform — the same
// idiom `tests/compiled-map.test.ts` and `tests/map-scene.test.ts` use, so
// this test proves the credit line against the exact attribution block the
// game ships, not a hand-typed fixture.
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import type { RoadGraphAttribution } from "../src/core/road-graph";
import { parseRoadGraph } from "../src/core/road-graph";
import { mapCreditLines } from "../src/hud/map-credit";
// Read directly (not via import.meta.glob) so a grep-style assertion can
// check the shipped source contains no hardcoded "OpenStreetMap" literal —
// the same mechanical-guard idiom `tests/no-google-pipeline.test.ts` uses for
// a different literal.
import mapCreditSource from "../src/hud/map-credit.ts?raw";

const graph = parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json");

/**
 * Only the pure half of `src/hud/map-credit.ts` is exercised here —
 * `createMapCredit` needs a DOM that does not exist in Vitest's `node`
 * environment, matching `tests/speedometer.test.ts:14-18`'s own scoping of
 * `createSpeedometer` versus its pure half.
 */
describe("mapCreditLines: real compiled attribution (SC4 positive half)", () => {
  it("includes the exact required OSM copyright string and licence URL from the real compiled artifact", () => {
    const lines = mapCreditLines(graph.attribution);
    expect(lines).toContain("© OpenStreetMap contributors");
    expect(lines).toContain("https://www.openstreetmap.org/copyright");
  });

  it("also includes the DEM credit from the real compiled artifact", () => {
    const lines = mapCreditLines(graph.attribution);
    expect(lines).toContain(graph.attribution.dem);
  });

  it("changes when the attribution block changes — nothing is hardcoded", () => {
    const fakeAttribution: RoadGraphAttribution = {
      osm: "© A Different Contributor",
      osmLicense: "CC-BY-4.0",
      osmLicenseUrl: "https://example.invalid/licence",
      dem: "A Different DEM Source",
    };
    const lines = mapCreditLines(fakeAttribution);
    expect(lines).toContain("© A Different Contributor");
    expect(lines).toContain("https://example.invalid/licence");
    expect(lines).toContain("A Different DEM Source");
    expect(lines).not.toContain("© OpenStreetMap contributors");
  });
});

describe("map-credit.ts: source-level acceptance criteria", () => {
  it("contains no literal 'OpenStreetMap' string — the credit can only ever come from the loaded artifact", () => {
    expect(mapCreditSource).not.toMatch(/OpenStreetMap/);
  });

  it("uses textContent to write every credit line, never a markup-parsing DOM write", () => {
    expect(mapCreditSource).toMatch(/textContent/);
    expect(mapCreditSource).not.toMatch(/\.innerHTML\s*=/);
  });
});
