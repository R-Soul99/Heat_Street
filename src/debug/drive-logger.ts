/**
 * Drive logger (`?feel` / `?debug`): L starts and stops a recording at the
 * fixed 60 Hz tick, M drops a numbered mark ("that felt wrong just now"), and
 * stopping downloads a CSV. Read-only: it samples the vehicle after each
 * `tick()` and never touches the simulation.
 *
 * `driveLogHeader` / `driveLogRow` / `toDriveLogCsv` are pure so they test
 * without a DOM; `createDriveLogger` is the browser layer.
 *
 * Conventions match the feel dossier: steer +1 = right, slip and yaw rate are
 * positive toward the right, speeds in mph.
 */
import type { InputFrame } from "../core/input-tape";
import { DT } from "../core/sim-clock";
import { FL, FR, RL, RR, type Vehicle } from "../physics/vehicle";

const MS_TO_MPH = 2.23694;
const RAD_TO_DEG = 180 / Math.PI;
/** Five minutes of driving; recording stops itself here. */
const MAX_ROWS = 5 * 60 * 60;

export interface DriveLogRow {
  readonly t: number;
  readonly mark: number;
  readonly keySteer: number;
  readonly steer: number;
  readonly throttle: number;
  readonly brake: number;
  readonly handbrake: number;
  readonly wheelSteerDeg: number;
  readonly speedMph: number;
  readonly forwardMph: number;
  readonly slipDeg: number;
  readonly yawRate: number;
  readonly rollDeg: number;
  readonly contacts: number;
  readonly rearSideFriction: number;
  readonly rearTerm: string;
  readonly frontSideImpulse: number;
  readonly rearSideImpulse: number;
  readonly suspFL: number;
  readonly suspFR: number;
  readonly suspRL: number;
  readonly suspRR: number;
}

const COLUMNS: readonly { key: keyof DriveLogRow; name: string; digits?: number }[] = [
  { key: "t", name: "t", digits: 3 },
  { key: "mark", name: "mark" },
  { key: "keySteer", name: "key_steer" },
  { key: "steer", name: "steer", digits: 3 },
  { key: "throttle", name: "throttle", digits: 3 },
  { key: "brake", name: "brake", digits: 3 },
  { key: "handbrake", name: "handbrake" },
  { key: "wheelSteerDeg", name: "front_wheel_angle_deg", digits: 2 },
  { key: "speedMph", name: "speed_mph", digits: 2 },
  { key: "forwardMph", name: "forward_mph", digits: 2 },
  { key: "slipDeg", name: "slip_deg", digits: 2 },
  { key: "yawRate", name: "yaw_rate_rads", digits: 3 },
  { key: "rollDeg", name: "roll_deg", digits: 2 },
  { key: "contacts", name: "wheels_on_ground" },
  { key: "rearSideFriction", name: "rear_side_friction", digits: 4 },
  { key: "rearTerm", name: "rear_term" },
  { key: "frontSideImpulse", name: "front_side_impulse", digits: 1 },
  { key: "rearSideImpulse", name: "rear_side_impulse", digits: 1 },
  { key: "suspFL", name: "susp_fl", digits: 3 },
  { key: "suspFR", name: "susp_fr", digits: 3 },
  { key: "suspRL", name: "susp_rl", digits: 3 },
  { key: "suspRR", name: "susp_rr", digits: 3 },
];

export function driveLogHeader(): string {
  return COLUMNS.map((c) => c.name).join(",");
}

export function driveLogRow(r: DriveLogRow): string {
  return COLUMNS.map((c) => {
    const v = r[c.key];
    return typeof v === "number" && c.digits !== undefined ? v.toFixed(c.digits) : String(v);
  }).join(",");
}

export function toDriveLogCsv(rows: readonly DriveLogRow[]): string {
  return `${[driveLogHeader(), ...rows.map(driveLogRow)].join("\n")}\n`;
}

/** Sample one row from a vehicle that has just ticked with `frame`. */
export function sampleDriveLogRow(
  tick: number,
  mark: number,
  keySteer: number,
  frame: InputFrame,
  vehicle: Vehicle,
): DriveLogRow {
  const s = vehicle.telemetry;
  const c = vehicle.controller;
  return {
    t: tick * DT,
    mark,
    keySteer,
    steer: frame.steer,
    throttle: frame.throttle,
    brake: frame.brake,
    handbrake: frame.handbrake ? 1 : 0,
    // The controller's steering is +left (see vehicle.ts step 1); flip to +right.
    wheelSteerDeg: -(c.wheelSteering(FL) ?? 0) * RAD_TO_DEG,
    speedMph: s.groundSpeedMs * MS_TO_MPH,
    forwardMph: s.forwardSpeedMs * MS_TO_MPH,
    slipDeg: s.slipAngleRad * RAD_TO_DEG,
    yawRate: -s.angvel.y,
    rollDeg: s.rollDeg,
    contacts: s.contacts,
    rearSideFriction: vehicle.rearGrip.sideFriction,
    rearTerm: vehicle.rearGrip.dominant,
    frontSideImpulse: ((c.wheelSideImpulse(FL) ?? 0) + (c.wheelSideImpulse(FR) ?? 0)) / 2,
    rearSideImpulse: ((c.wheelSideImpulse(RL) ?? 0) + (c.wheelSideImpulse(RR) ?? 0)) / 2,
    suspFL: c.wheelSuspensionLength(FL) ?? 0,
    suspFR: c.wheelSuspensionLength(FR) ?? 0,
    suspRL: c.wheelSuspensionLength(RL) ?? 0,
    suspRR: c.wheelSuspensionLength(RR) ?? 0,
  };
}

const LEFT_KEYS = new Set(["ArrowLeft", "KeyA"]);
const RIGHT_KEYS = new Set(["ArrowRight", "KeyD"]);

export interface DriveLogger {
  /** Call once per fixed tick, right after the vehicle ticked with `frame`. */
  record(frame: InputFrame): void;
}

export function createDriveLogger(getVehicle: () => Vehicle): DriveLogger {
  let recording = false;
  let rows: DriveLogRow[] = [];
  let tick = 0;
  let marks = 0;
  const held = new Set<string>();

  const badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;left:50%;top:8px;transform:translateX(-50%);padding:4px 10px;" +
    "font:12px monospace;color:#fff;background:rgba(0,0,0,.65);border-radius:4px;" +
    "pointer-events:none;z-index:9999;white-space:pre";
  document.body.appendChild(badge);

  function paint(extra = ""): void {
    badge.textContent = recording
      ? `● REC ${(tick * DT).toFixed(0)}s  marks ${marks}   [L] stop  [M] mark${extra}`
      : `drive log: [L] start recording${extra}`;
    badge.style.color = recording ? "#ff6b6b" : "#fff";
  }

  function download(): void {
    const blob = new Blob([toDriveLogCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = URL.createObjectURL(blob);
    a.download = `heat-street-drive-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function toggle(): void {
    if (recording) {
      recording = false;
      download();
      paint(`   saved ${rows.length} rows, ${marks} marks`);
    } else {
      rows = [];
      tick = 0;
      marks = 0;
      recording = true;
      paint();
    }
  }

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code)) held.add(e.code);
    if (e.repeat) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    if (e.code === "KeyL") toggle();
    else if (e.code === "KeyM" && recording) {
      marks++;
      paint();
    }
  });
  addEventListener("keyup", (e) => held.delete(e.code));
  addEventListener("blur", () => held.clear());
  paint();

  return {
    record(frame) {
      if (!recording) return;
      let keySteer = 0;
      for (const k of held) keySteer += LEFT_KEYS.has(k) ? -1 : 1;
      rows.push(sampleDriveLogRow(tick, marks, Math.sign(keySteer), frame, getVehicle()));
      tick++;
      if (tick % 60 === 0) paint();
      if (rows.length >= MAX_ROWS) toggle();
    },
  };
}
