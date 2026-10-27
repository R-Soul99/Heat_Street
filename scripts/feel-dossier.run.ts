/**
 * Entry point for `npm run feel-dossier` (see vitest.dossier.config.ts).
 * Env: FEEL_DOSSIER_OUT (default out/feel-dossier), FEEL_DOSSIER_PIVOT (0..1,
 * unset = the committed default, which is off).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { formatSummary, runDossier, summarise, toCsv } from "./feel-dossier";

it("feel dossier", () => {
  const tuning = defaultTuning();
  const pivot = process.env.FEEL_DOSSIER_PIVOT;
  if (pivot !== undefined && pivot !== "") tuning.drive.pivotTurn = Number(pivot);
  const out = process.env.FEEL_DOSSIER_OUT || join("out", "feel-dossier");
  mkdirSync(out, { recursive: true });
  const lines = [
    `Feel dossier: defaultTuning(), pivotTurn=${tuning.drive.pivotTurn}, out=${out}`,
    "",
  ];
  for (const run of runDossier(tuning)) {
    writeFileSync(join(out, `${run.id}.csv`), toCsv(run));
    lines.push(formatSummary(run, summarise(run)), "");
  }
  const text = lines.join("\n");
  writeFileSync(join(out, "summary.txt"), text);
  console.log(`\n${text}`);
});
