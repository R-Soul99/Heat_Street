/**
 * The always-on map-data attribution line: OSM copyright + licence URL, and
 * the DEM credit, rendered directly from the loaded map's own `attribution`
 * block (`src/core/road-graph.ts`'s `RoadGraphAttribution`) — never
 * hardcoded (plan 04-10, D-P30, SC4's positive half).
 *
 * ADR 0001 (`docs/adr/0001-map-data-source.md`) requires OSM attribution
 * "on the credits page, in the menu, or in another suitable location" and,
 * separately, the licence URL "where linking is not possible" — a static
 * corner overlay rendering both strings as plain text is unambiguously
 * compliant with both requirements at once. There is no menu or credits
 * screen in the project yet (Phase 5 owns screens), so D-P30 puts this line
 * always on screen; a future credits screen can consume the same
 * `attribution` block this module reads.
 *
 * The two halves are kept deliberately separate, mirroring
 * `src/hud/speedometer.ts`'s own split: the pure half (`mapCreditLines`) is
 * Node-testable with no DOM (see `tests/map-credit.test.ts`) — this
 * project's Vitest environment is `"node"`, with no jsdom
 * (`vitest.config.ts`), so `createMapCredit` itself needs a real DOM and is
 * covered only by the human browser checkpoint, exactly as
 * `speedometer.test.ts:14-18` documents for `createSpeedometer`.
 *
 * Layering: `src/hud/` tier (02-UI-SPEC.md Architecture Call 2), same as
 * `src/hud/speedometer.ts` — receives plain data, imports neither `three` nor
 * Rapier, never writes simulation state, never reads a clock. Element
 * construction follows `speedometer.ts`'s own convention exactly:
 * `document.createElement` at the call site, `textContent` only, never a
 * markup-parsing DOM write — asserted mechanically by
 * `tests/map-credit.test.ts`, the same "grep the shipped source" idiom
 * `tests/no-google-pipeline.test.ts` uses for a different literal.
 */
import type { RoadGraphAttribution } from "../core/road-graph";

/** The live credit line's public surface. No `update()` — the text is fixed for the lifetime of one loaded map. */
export interface MapCredit {
  /** Remove the credit overlay from the DOM. */
  dispose(): void;
}

/**
 * The credit's three display lines, sourced ENTIRELY from `attribution` —
 * this function contains no OSM/USGS string of its own, so a future area
 * with a different DEM source (or a non-OSM road source, hypothetically) is
 * credited correctly with zero code changes here. ADR 0001
 * (`docs/adr/0001-map-data-source.md`) requires the OSM copyright string AND
 * the licence URL "where linking is not possible" — rendering both as
 * separate text lines is unambiguously compliant with both at once. The DEM
 * credit ships too, since `attribution.dem` exists precisely so the credits
 * are generated from data rather than hand-maintained.
 */
export function mapCreditLines(attribution: RoadGraphAttribution): readonly string[] {
  return [attribution.osm, attribution.osmLicenseUrl, attribution.dem];
}

/**
 * Builds the credit overlay from `mapCreditLines(attribution)` and appends it
 * to `document.body`. There is no menu or credits screen in the project yet
 * (Phase 5 owns screens), so D-P30 puts this line always on screen — a
 * future credits screen can consume `mapCreditLines` the same way.
 *
 * GATE-FREE, matching `createSpeedometer`: attribution is a licence
 * obligation, not a developer tool, so this is never gated on
 * `DEBUG_ENABLED`.
 */
export function createMapCredit(attribution: RoadGraphAttribution): MapCredit {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:5;pointer-events:none;" +
    'font-family:"Arial Narrow","Helvetica Neue",Helvetica,Arial,sans-serif;' +
    "font-size:11px;line-height:1.4;color:#9A9AA0;text-shadow:0 1px 2px rgba(0,0,0,0.8)";

  for (const line of mapCreditLines(attribution)) {
    const lineEl = document.createElement("div");
    lineEl.textContent = line;
    root.appendChild(lineEl);
  }

  document.body.appendChild(root);

  return {
    dispose(): void {
      root.remove();
    },
  };
}
