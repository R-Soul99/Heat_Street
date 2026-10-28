/**
 * Feel dossier: five scripted drives against the committed base tuning
 * (`defaultTuning()`), each logged at 60 Hz to a CSV and summarised.
 *
 * Read-only: it drives the same `createVehicle` / `tick` / `world.step` path as
 * the game and the telemetry routines and changes no behaviour. The rear-grip
 * columns come from `Vehicle.rearGrip`, which the physics only writes.
 *
 * Conventions: heading, yaw rate and slip are positive toward the RIGHT (the
 * steer +1 direction); heading is degrees from the start heading, unwrapped.
 * "Release" is the tick the main input lets go (see each script).
 */
import type { InputFrame } from "../src/core/input-tape";
import { DT } from "../src/core/sim-clock";
import type { VehicleTuning } from "../src/core/vehicle-tuning";
import { buildTelemetryScene } from "../src/physics/telemetry/run";
import { createVehicle, sampleVehicle, type Vehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const MPH = 0.44704;
const SETTLE_TICKS = 40;
const RAD_TO_DEG = 180 / Math.PI;
const YAW_SETTLED = 0.2;
/** Steady-corner inputs: constant half lock, light throttle that roughly holds speed. */
const CORNER_STEER = 0.5;
const CORNER_THROTTLE = 0.3;

export interface Row {
  t: number;
  groundSpeed: number;
  forwardSpeed: number;
  slipDeg: number;
  yawRate: number;
  headingDeg: number;
  rearSideFriction: number;
  dominant: string;
  pivotGate: number;
  throttle: number;
  steer: number;
  handbrake: number;
}

export interface DossierRun {
  readonly id: string;
  readonly description: string;
  readonly rows: Row[];
  /** Index into `rows` of the input release. */
  readonly releaseIndex: number;
  readonly note: string;
}

interface ScriptState {
  /** Tick index of the release; -1 until it happens. */
  releaseIndex: number;
  /** Tick index at which a corner reached its target heading; -1 until then. */
  cornerEndIndex: number;
}

interface Script {
  readonly id: string;
  readonly description: string;
  readonly launchMph: number;
  readonly seconds: number;
  drive(tick: number, headingDeg: number, state: ScriptState): InputFrame;
}

const frame = (steer: number, throttle: number, handbrake = false): InputFrame => ({
  steer,
  throttle,
  brake: 0,
  handbrake,
});

/** Steer input rising at the live-input ramp (5/s) instead of a step. */
const rampedSteer = (k: number, target: number): number => Math.min(target, k * DT * 5);

const HOLD_1S = Math.round(1 / DT);
const HOLD_HALF_S = Math.round(0.5 / DT);
const HOLD_3S = Math.round(3 / DT);

const SCRIPTS: readonly Script[] = [
  {
    id: "pivot-turn",
    description: "standstill, full steer + throttle 1 s, release steer, throttle 3 s",
    launchMph: 0,
    seconds: 4,
    drive(k, _h, st) {
      if (k < HOLD_1S) return frame(1, 1);
      if (st.releaseIndex < 0) st.releaseIndex = k;
      return frame(0, 1);
    },
  },
  {
    id: "handbrake-180",
    description: "45 mph, full steer + handbrake 0.5 s, release both, full throttle",
    launchMph: 45,
    seconds: 5,
    drive(k, _h, st) {
      if (k < HOLD_HALF_S) return frame(1, 0, true);
      if (st.releaseIndex < 0) st.releaseIndex = k;
      return frame(0, 1);
    },
  },
  {
    id: "corner-90",
    description: `30 mph, steer ${CORNER_STEER} with throttle ${CORNER_THROTTLE} until 90 deg of heading, then steer released (release), throttle held`,
    launchMph: 30,
    seconds: 7,
    drive(k, h, st) {
      if (st.cornerEndIndex < 0 && h < 90) return frame(CORNER_STEER, CORNER_THROTTLE);
      if (st.cornerEndIndex < 0) st.cornerEndIndex = st.releaseIndex = k;
      return frame(0, CORNER_THROTTLE);
    },
  },
  {
    id: "lift-off",
    description: `as corner-90, but throttle lifted to 0 at 45 deg of heading (release = the lift); steer released at 90 deg`,
    launchMph: 30,
    seconds: 7,
    drive(k, h, st) {
      if (st.releaseIndex < 0 && h >= 45) st.releaseIndex = k;
      const throttle = st.releaseIndex >= 0 ? 0 : CORNER_THROTTLE;
      if (st.cornerEndIndex < 0 && h < 90) return frame(CORNER_STEER, throttle);
      if (st.cornerEndIndex < 0) st.cornerEndIndex = k;
      return frame(0, throttle);
    },
  },
  {
    id: "lift-off-60",
    description:
      "60 mph, steer 0.8 with throttle 0.5; throttle lifted to 0 at 30 deg of heading (release = the lift), steer held to 120 deg",
    launchMph: 60,
    seconds: 5,
    drive(k, h, st) {
      if (st.releaseIndex < 0 && h >= 30) st.releaseIndex = k;
      const throttle = st.releaseIndex >= 0 ? 0 : 0.5;
      return frame(h < 120 ? rampedSteer(k, 0.8) : 0, throttle);
    },
  },
  {
    id: "hold-60",
    description:
      "control for lift-off-60: same corner, throttle held at 0.5 throughout (release = the same 30 deg point)",
    launchMph: 60,
    seconds: 5,
    drive(k, h, st) {
      if (st.releaseIndex < 0 && h >= 30) st.releaseIndex = k;
      return frame(h < 120 ? rampedSteer(k, 0.8) : 0, 0.5);
    },
  },
  {
    id: "hold-slide-70",
    description:
      "70 mph, full lock held (ramped); throttle full 0.5 s, lifted 0.5 s, then reapplied full to the end (release = the reapply). Mirrors the 2026-10-28 drive log.",
    launchMph: 70,
    seconds: 6,
    drive(k, _h, st) {
      const sec = k * DT;
      if (st.releaseIndex < 0 && sec >= 1.0) st.releaseIndex = k;
      const throttle = sec < 0.5 ? 1 : sec < 1.0 ? 0 : 1;
      return frame(rampedSteer(k, 1), throttle);
    },
  },
  {
    id: "power-slide",
    description:
      "15 mph, full lock + full throttle 3 s, then steer released (release), throttle held 3 s",
    launchMph: 15,
    seconds: 6,
    drive(k, _h, st) {
      if (k < HOLD_3S) return frame(1, 1);
      if (st.releaseIndex < 0) st.releaseIndex = k;
      return frame(0, 1);
    },
  },
];

function headingOf(v: Vehicle): number {
  const q = v.body.rotation();
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return Math.atan2(fx, -fz);
}

function runScript(script: Script, tuning: VehicleTuning): DossierRun {
  const world = createWorld();
  try {
    buildTelemetryScene(world);
    const vehicle = createVehicle(world, tuning, { x: 0, y: 1, z: 0 });
    const idle: InputFrame = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    for (let k = 0; k < SETTLE_TICKS; k++) {
      vehicle.tick(idle, tuning);
      world.step();
    }
    if (script.launchMph > 0) {
      vehicle.body.setLinvel({ x: 0, y: 0, z: -script.launchMph * MPH }, true);
    }
    const state: ScriptState = { releaseIndex: -1, cornerEndIndex: -1 };
    const rows: Row[] = [];
    let prevRaw = headingOf(vehicle);
    let heading = 0;
    const ticks = Math.round(script.seconds / DT);
    for (let k = 0; k < ticks; k++) {
      const input = script.drive(k, heading * RAD_TO_DEG, state);
      vehicle.tick(input, tuning);
      world.step();
      const s = sampleVehicle(vehicle);
      const raw = headingOf(vehicle);
      let d = raw - prevRaw;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      heading += d;
      prevRaw = raw;
      rows.push({
        t: (k + 1) * DT,
        groundSpeed: s.groundSpeedMs,
        forwardSpeed: s.forwardSpeedMs,
        slipDeg: s.slipAngleRad * RAD_TO_DEG,
        yawRate: -s.angvel.y,
        headingDeg: heading * RAD_TO_DEG,
        rearSideFriction: vehicle.rearGrip.sideFriction,
        dominant: vehicle.rearGrip.dominant,
        pivotGate: vehicle.rearGrip.pivotGate,
        throttle: input.throttle,
        steer: input.steer,
        handbrake: input.handbrake ? 1 : 0,
      });
    }
    return {
      id: script.id,
      description: script.description,
      rows,
      releaseIndex: state.releaseIndex,
      note:
        script.id === "lift-off" && state.cornerEndIndex >= 0
          ? `steer released at t=${(state.cornerEndIndex * DT).toFixed(2)} s`
          : "",
    };
  } finally {
    world.free();
  }
}

export function runDossier(tuning: VehicleTuning): DossierRun[] {
  return SCRIPTS.map((s) => runScript(s, tuning));
}

const HEADER =
  "t,ground_speed_ms,forward_speed_ms,slip_deg,yaw_rate_rads,heading_deg,rear_side_friction,dominant_rear_term,pivot_gate,throttle,steer,handbrake";

export function toCsv(run: DossierRun): string {
  const f = (n: number): string => n.toFixed(4);
  const lines = run.rows.map((r) =>
    [
      f(r.t),
      f(r.groundSpeed),
      f(r.forwardSpeed),
      f(r.slipDeg),
      f(r.yawRate),
      f(r.headingDeg),
      f(r.rearSideFriction),
      r.dominant,
      f(r.pivotGate),
      f(r.throttle),
      f(r.steer),
      r.handbrake,
    ].join(","),
  );
  return `${HEADER}\n${lines.join("\n")}\n`;
}

export interface Summary {
  readonly id: string;
  readonly releaseSec: number;
  readonly peakSlipDeg: number;
  readonly peakYawRate: number;
  /** First time after release that |yaw rate| < 0.2; null if never. */
  readonly yawFirstUnderSec: number | null;
  /** Time after release from which |yaw rate| stays under 0.2 to the end; null if it does not. */
  readonly yawSettledSec: number | null;
  readonly headingAtReleaseDeg: number;
  /** Most heading gained past the release heading, in the direction of rotation at release. */
  readonly headingOvershootDeg: number;
  readonly finalHeadingDeg: number;
  readonly speedAtRelease: number;
  readonly speedPlus0_5: number;
  readonly speedPlus1_5: number;
  readonly speedPlus3: number;
}

export function summarise(run: DossierRun): Summary {
  const { rows } = run;
  // rows[i] is the state AFTER tick i, so the state at the instant of release
  // (the end of the last tick driven by the old input) is row releaseIndex - 1.
  const ri = Math.max(0, Math.min(rows.length - 1, run.releaseIndex - 1));
  const at = (secAfter: number): number =>
    rows[Math.min(rows.length - 1, ri + Math.round(secAfter / DT))].groundSpeed;
  let firstUnder: number | null = null;
  for (let i = ri; i < rows.length; i++) {
    if (Math.abs(rows[i].yawRate) < YAW_SETTLED) {
      firstUnder = (i - ri) * DT;
      break;
    }
  }
  let settled: number | null = null;
  for (let i = rows.length - 1; i >= ri; i--) {
    if (Math.abs(rows[i].yawRate) >= YAW_SETTLED) break;
    settled = (i - ri) * DT;
  }
  const hRel = rows[ri].headingDeg;
  const dir = Math.sign(rows[ri].yawRate) || 1;
  let over = 0;
  for (let i = ri; i < rows.length; i++) over = Math.max(over, (rows[i].headingDeg - hRel) * dir);
  return {
    id: run.id,
    releaseSec: rows[ri].t,
    peakSlipDeg: rows.reduce((m, r) => Math.max(m, Math.abs(r.slipDeg)), 0),
    peakYawRate: rows.reduce((m, r) => Math.max(m, Math.abs(r.yawRate)), 0),
    yawFirstUnderSec: firstUnder,
    yawSettledSec: settled,
    headingAtReleaseDeg: hRel,
    headingOvershootDeg: over,
    finalHeadingDeg: rows[rows.length - 1].headingDeg,
    speedAtRelease: rows[ri].groundSpeed,
    speedPlus0_5: at(0.5),
    speedPlus1_5: at(1.5),
    speedPlus3: at(3),
  };
}

export function formatSummary(run: DossierRun, s: Summary): string {
  const sp = (v: number): string => `${v.toFixed(1)} m/s (${(v / MPH).toFixed(0)} mph)`;
  const sec = (v: number | null): string => (v === null ? "never" : `${v.toFixed(2)} s`);
  return [
    `${s.id}: ${run.description}${run.note ? ` [${run.note}]` : ""}`,
    `  release at t=${s.releaseSec.toFixed(2)} s`,
    `  peak slip            ${s.peakSlipDeg.toFixed(1)} deg`,
    `  peak yaw rate        ${s.peakYawRate.toFixed(2)} rad/s`,
    `  release -> yaw<0.2   first ${sec(s.yawFirstUnderSec)}, settled for good ${sec(s.yawSettledSec)}`,
    `  heading at release   ${s.headingAtReleaseDeg.toFixed(1)} deg, overshoot after ${s.headingOvershootDeg.toFixed(1)} deg, final ${s.finalHeadingDeg.toFixed(1)} deg`,
    `  speed  release ${sp(s.speedAtRelease)}  +0.5 s ${sp(s.speedPlus0_5)}  +1.5 s ${sp(s.speedPlus1_5)}  +3 s ${sp(s.speedPlus3)}`,
  ].join("\n");
}
