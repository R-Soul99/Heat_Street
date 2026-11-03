/**
 * Entry point for `npm run feel-dossier` (see vitest.dossier.config.ts).
 * Env: FEEL_DOSSIER_OUT (default out/feel-dossier), FEEL_DOSSIER_CAR
 * ("shipped" = shippedTuning(), the car players drive; anything else or unset =
 * defaultTuning()), FEEL_DOSSIER_PIVOT (0..1, unset = the car's own value),
 * FEEL_DOSSIER_LIFT (liftOffOversteer), FEEL_DOSSIER_FALLOFF (tyreFalloff).
 * The PIVOT/LIFT/FALLOFF overrides are applied after the car is chosen.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { defaultTuning } from "../src/core/vehicle-tuning";
import {
  formatSummary,
  runDossier,
  summarise,
  TAP_STARTS_SEC,
  tapMetrics,
  toCsv,
} from "./feel-dossier";

it("feel dossier", () => {
  const shipped = process.env.FEEL_DOSSIER_CAR === "shipped";
  const tuning = shipped ? shippedTuning() : defaultTuning();
  const pivot = process.env.FEEL_DOSSIER_PIVOT;
  if (pivot !== undefined && pivot !== "") tuning.drive.pivotTurn = Number(pivot);
  const lift = process.env.FEEL_DOSSIER_LIFT;
  if (lift !== undefined && lift !== "") tuning.drive.liftOffOversteer = Number(lift);
  const falloff = process.env.FEEL_DOSSIER_FALLOFF;
  if (falloff !== undefined && falloff !== "") tuning.drive.tyreFalloff = Number(falloff);
  const out = process.env.FEEL_DOSSIER_OUT || join("out", "feel-dossier");
  mkdirSync(out, { recursive: true });
  const lines = [
    `Feel dossier: ${shipped ? "shipped car (shippedTuning())" : "defaultTuning()"}, pivotTurn=${tuning.drive.pivotTurn}, out=${out}`,
    "",
  ];
  for (const run of runDossier(tuning)) {
    writeFileSync(join(out, `${run.id}.csv`), toCsv(run));
    lines.push(formatSummary(run, summarise(run)));
    const tapKind = /^tap-([a-z]+)-/.exec(run.id)?.[1];
    if (tapKind !== undefined && TAP_STARTS_SEC[tapKind] !== undefined) {
      const m = tapMetrics(run, TAP_STARTS_SEC[tapKind]);
      lines.push(
        `  tap metrics          yaw peaks ${m.yawPeaks.map((p) => p.toFixed(2)).join(" / ")} rad/s, peak slip ${m.peakSlipDeg.toFixed(1)} deg, peak heading ${m.peakHeadingDeg.toFixed(1)} deg, yaw<0.05 settle ${m.settleSec === null ? "never" : `${m.settleSec.toFixed(2)} s`}`,
      );
    }
    lines.push("");
  }
  const text = lines.join("\n");
  writeFileSync(join(out, "summary.txt"), text);
  console.log(`\n${text}`);
});
