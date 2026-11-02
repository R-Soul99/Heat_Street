import { describe, expect, it } from "vitest";
import {
  evaluateGate,
  flatRegressionPasses,
  type GateLaneMetrics,
  type GateVerdict,
} from "../src/core/terrain-gate-metrics";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { ROUTINES } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";
import {
  gateCourseLanes,
  runFlatBaseline,
  runFlatRegression,
  runGateLane,
} from "../src/physics/telemetry/terrain-gate";

/**
 * The automated half of the D-01 prototype gate. Thresholds come from the flat
 * baseline measured in this same run; a failing gate is NOT fixed by relaxing
 * GATE_FACTORS / GATE_FLOORS (that is the plan 06 human checkpoint's call).
 *
 * Heavy: 24 lane drives of up to 3600 ticks each plus 2x the routine suite;
 * the cases below carry a 120 s timeout.
 */
const SPEEDS = [15, 25] as const;
const DIRECTIONS = [1, -1] as const;
const SUBDIVS = [1, 2] as const;
const LANE_IDS = ["hill", "bank", "climb"] as const;
const HEAVY = 120_000;
const NL = String.fromCharCode(10);

describe("prototype gate (D-01)", () => {
  const tuning = defaultTuning();

  it("runRoutine without a groundBuilder is unchanged (regression guard)", () => {
    for (const routine of ROUTINES) {
      const a = runRoutine(routine, tuning);
      const b = runRoutine(routine, tuning, undefined, undefined);
      expect(b.value).toBe(a.value);
    }
  });

  it(
    "gate verdict over hill/bank/climb, 15 and 25 m/s, both directions, both collider resolutions",
    () => {
      const regression = runFlatRegression(tuning);
      const flat = new Map(SPEEDS.map((s) => [s, runFlatBaseline(s, tuning)]));
      console.table(
        regression.map((r) => ({
          id: r.id,
          legacy: r.legacy,
          terrain: r.terrain,
          pctDiff: (100 * Math.abs(r.terrain - r.legacy)) / Math.max(Math.abs(r.legacy), 1e-6),
        })),
      );
      console.table(
        [...flat.values()].map((m) => ({
          speedMs: m.speedMs,
          vertMs: m.verticalJitterMs,
          suspM: m.suspensionJitterM,
          contactLoss: m.contactLossTicks,
          speedMsJitter: m.speedJitterMs,
          maxTickDrop: m.maxTickDrop,
          ticks: m.ticks,
        })),
      );

      const lanes = gateCourseLanes().filter((l) => (LANE_IDS as readonly string[]).includes(l.id));
      const verdicts = new Map<number, GateVerdict[]>();
      const rows: Record<string, string | number | boolean>[] = [];
      for (const subdiv of SUBDIVS) {
        const list: GateVerdict[] = [];
        for (const speed of SPEEDS) {
          const metrics: GateLaneMetrics[] = [];
          for (const lane of lanes) {
            for (const dir of DIRECTIONS) {
              metrics.push(runGateLane(lane, speed, dir, tuning, { colliderSubdiv: subdiv }));
            }
          }
          const base = flat.get(speed) as GateLaneMetrics;
          const verdict = evaluateGate(metrics, base, regression);
          list.push(verdict);
          for (const m of verdict.metrics) {
            rows.push({
              subdiv: m.colliderSubdiv,
              lane: m.lane,
              speed: m.speedMs,
              dir: m.direction,
              metric: m.metric,
              value: Number(m.value.toPrecision(4)),
              threshold: Number(m.threshold.toPrecision(4)),
              pass: m.pass,
            });
          }
        }
        verdicts.set(subdiv, list);
      }
      console.table(rows);

      const regressionOk = regression.every((r) => flatRegressionPasses(r));
      const failures: string[] = [];
      let anyPass = false;
      for (const subdiv of SUBDIVS) {
        const list = verdicts.get(subdiv) ?? [];
        const bad = list.flatMap((v) => v.metrics.filter((m) => !m.pass));
        if (bad.length === 0 && regressionOk) anyPass = true;
        for (const m of bad) {
          failures.push(
            `subdiv ${subdiv} ${m.lane} ${m.speedMs}m/s dir ${m.direction} ${m.metric}: ${m.value} > ${m.threshold}`,
          );
        }
      }
      if (!regressionOk) {
        for (const r of regression) {
          if (!flatRegressionPasses(r)) {
            failures.push(`flat regression ${r.id}: legacy ${r.legacy} vs terrain ${r.terrain}`);
          }
        }
      }
      console.log(
        anyPass
          ? "AUTOMATED GATE VERDICT: PASS"
          : `AUTOMATED GATE VERDICT: FAIL${NL}${failures.join(NL)}`,
      );

      // Harness integrity always holds: every run produced data.
      for (const list of verdicts.values()) {
        for (const v of list)
          expect(v.metrics.length).toBe(LANE_IDS.length * DIRECTIONS.length * 5);
      }
      expect(Number.isFinite(flat.get(15)?.verticalJitterMs)).toBe(true);

      // A failing gate is a RESULT for the plan 06 human checkpoint (CONTEXT: stop
      // before the real pipeline), not a broken build. Set GATE_ENFORCE=1 to make
      // the verdict itself fatal (never relax GATE_FACTORS to get a pass).
      const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
        ?.env;
      if (env?.GATE_ENFORCE === "1") {
        expect(anyPass, `gate failed:${NL}${failures.join(NL)}`).toBe(true);
      }
    },
    HEAVY,
  );
});
