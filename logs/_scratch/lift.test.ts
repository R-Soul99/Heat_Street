import { it } from "vitest";
import { applyFeel, FEEL_DEFAULTS } from "../../src/core/feel";
import { classDefaultTuning } from "../../src/core/vehicle-class";
import { defaultTuning } from "../../src/core/vehicle-tuning";
import { runDossier, summarise } from "../../scripts/feel-dossier";
it("dossier shipped vs default", () => {
  const t = classDefaultTuning("rwd");
  applyFeel(t, classDefaultTuning("rwd"), FEEL_DEFAULTS);
  for (const [name, tun] of [["default", defaultTuning()], ["shipped", t]] as const) {
    for (const r of runDossier(tun)) {
      if (!/lift|hold-60|corner/.test(r.id)) continue;
      const s = summarise(r);
      console.log(name, r.id, "peakSlip", s.peakSlipDeg.toFixed(1), JSON.stringify(s).slice(0, 220));
    }
  }
});
