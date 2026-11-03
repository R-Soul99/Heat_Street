import { describe, expect, it } from "vitest";
import {
  applyFeel,
  FEEL_DEFAULTS,
  FEEL_NEUTRAL,
  type FeelKey,
  type FeelSettings,
  shippedTuning,
} from "../src/core/feel";
import {
  evaluateGate,
  flatRegressionPasses,
  type GateLaneMetrics,
  type GateVerdict,
} from "../src/core/terrain-gate-metrics";
import { classDefaultTuning, DEFAULT_VEHICLE_CLASS_ID } from "../src/core/vehicle-class";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { ROUTINES } from "../src/physics/telemetry/routines";
import { runRoutine } from "../src/physics/telemetry/run";
import {
  type ContactLossDiag,
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

describe("shipped car gate (04.3 P43-CONTACT)", () => {
  it(
    "shipped feel-preset car on subdiv 2: per-lane contact loss and verdict",
    () => {
      const tuning = shippedTuning();
      const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
        ?.env;
      const diagOn = env?.GATE_DIAG === "1";
      const diags: ContactLossDiag[] = [];
      const onContactLoss = diagOn ? (d: ContactLossDiag) => diags.push(d) : undefined;

      const regression = runFlatRegression(tuning);
      const lanes = gateCourseLanes().filter((l) => (LANE_IDS as readonly string[]).includes(l.id));
      const lossRows: Record<string, string | number | boolean>[] = [];
      const failures: string[] = [];
      let allPass = regression.every((r) => flatRegressionPasses(r));

      for (const speed of SPEEDS) {
        const base = runFlatBaseline(speed, tuning);
        const metrics: GateLaneMetrics[] = [];
        for (const lane of lanes) {
          for (const dir of DIRECTIONS) {
            metrics.push(
              runGateLane(lane, speed, dir, tuning, { colliderSubdiv: 2, onContactLoss }),
            );
          }
        }
        const verdict = evaluateGate(metrics, base, regression);
        for (const m of metrics) {
          const bad = verdict.metrics.filter(
            (v) =>
              v.lane === m.laneId &&
              v.speedMs === m.speedMs &&
              v.direction === m.direction &&
              !v.pass,
          );
          lossRows.push({
            lane: m.laneId,
            speed: m.speedMs,
            dir: m.direction,
            contactLossTicks: m.contactLossTicks,
            verdict: bad.length === 0 ? "pass" : `fail: ${bad.map((b) => b.metric).join(",")}`,
          });
        }
        for (const v of verdict.metrics.filter((x) => !x.pass)) {
          failures.push(
            `${v.lane} ${v.speedMs}m/s dir ${v.direction} ${v.metric}: ${v.value} > ${v.threshold}`,
          );
          allPass = false;
        }
      }
      console.table(lossRows);
      if (diagOn) {
        console.table(
          diags.map((d) => ({
            lane: d.laneId,
            tick: d.tick,
            x: Number(d.x.toFixed(2)),
            y: Number(d.y.toFixed(2)),
            z: Number(d.z.toFixed(2)),
            vy: Number(d.vy.toFixed(2)),
            wheelsOff: d.wheelsOff.join(","),
            susp: d.suspensionLengths.map((s) => s.toFixed(2)).join(","),
            steer: Number(d.steer.toFixed(2)),
            throttle: Number(d.throttle.toFixed(2)),
            brake: d.brake,
            rearSide: Number((d.rearSideFriction ?? 0).toFixed(3)),
          })),
        );
      }
      console.log(
        allPass
          ? "SHIPPED CAR GATE VERDICT: PASS"
          : `SHIPPED CAR GATE VERDICT: FAIL${NL}${failures.join(NL)}`,
      );

      expect(lossRows.length).toBe(LANE_IDS.length * DIRECTIONS.length * SPEEDS.length);
      // Report-only until plan 08 makes it default-fatal once green.
      if (env?.GATE_ENFORCE === "1") {
        expect(allPass, `shipped gate failed:${NL}${failures.join(NL)}`).toBe(true);
      }
    },
    HEAVY,
  );
});

describe("shipped car contact-loss bisect (opt-in, GATE_BISECT=1)", () => {
  const bisectOn =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.GATE_BISECT === "1";
  it.skipIf(!bisectOn)(
    "reverting one feel key to neutral: loss ticks on climb 15 m/s dir -1",
    () => {
      const lane = gateCourseLanes().filter((l) => l.id === "climb")[0];
      if (lane === undefined) throw new Error("climb lane missing");
      const rows: Record<string, string | number>[] = [];
      const keys = Object.keys(FEEL_NEUTRAL) as FeelKey[];
      for (const key of ["(none)" as const, ...keys]) {
        const feel: FeelSettings = { ...FEEL_DEFAULTS };
        if (key !== "(none)") feel[key] = FEEL_NEUTRAL[key];
        const t = classDefaultTuning(DEFAULT_VEHICLE_CLASS_ID);
        applyFeel(t, classDefaultTuning(DEFAULT_VEHICLE_CLASS_ID), feel);
        const m = runGateLane(lane, 15, -1, t, { colliderSubdiv: 2 });
        rows.push({ reverted: key, contactLossTicks: m.contactLossTicks });
      }
      // liftOff is already neutral (5) in FEEL_DEFAULTS, so also sweep it and nudge
      // two keys to show how sensitive the single lost tick is.
      const probes: [FeelKey, number][] = [
        ["liftOff", 0],
        ["liftOff", 10],
        ["lowGearPunch", 6.5],
        ["lowGearPunch", 7.5],
        ["looseness", 5.0],
        ["looseness", 5.6],
      ];
      for (const [key, val] of probes) {
        const feel: FeelSettings = { ...FEEL_DEFAULTS, [key]: val };
        const t = classDefaultTuning(DEFAULT_VEHICLE_CLASS_ID);
        applyFeel(t, classDefaultTuning(DEFAULT_VEHICLE_CLASS_ID), feel);
        const m = runGateLane(lane, 15, -1, t, { colliderSubdiv: 2 });
        rows.push({ reverted: `${key}=${val}`, contactLossTicks: m.contactLossTicks });
      }
      console.table(rows);
    },
    HEAVY,
  );
});
