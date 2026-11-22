/**
 * Player vehicle classes (RWD / FWD / AWD drivetrain A/B variants plus the
 * roster of distinct vehicle types such as the rally coupe).
 *
 * Selected through the allowlisted `?car=` URL param. Pure module: no three or
 * rapier imports. Index lookups into `VEHICLE_CLASSES` only ever use an
 * already-allowlisted `VehicleClassId`.
 */
import { SURFACE_TYPES, type SurfaceType } from "./surface-types";
import {
  defaultTuning,
  TUNING_RANGES,
  TUNING_STORAGE_KEY,
  type TuningRanges,
  type VehicleTuning,
} from "./vehicle-tuning";

export const KNOWN_VEHICLE_CLASS_IDS = ["rwd", "fwd", "awd", "rally"] as const;
export type VehicleClassId = (typeof KNOWN_VEHICLE_CLASS_IDS)[number];
export const DEFAULT_VEHICLE_CLASS_ID: VehicleClassId = "rwd";

/** Exact-match allowlist (array `find`, never object-key lookup). */
export function resolveVehicleClassId(search: string): VehicleClassId {
  const requested = new URLSearchParams(search).get("car");
  if (requested === null) return DEFAULT_VEHICLE_CLASS_ID;
  const match = KNOWN_VEHICLE_CLASS_IDS.find((id) => id === requested);
  return match ?? DEFAULT_VEHICLE_CLASS_ID;
}

/** Per-surface-type multipliers on the surface profile's forward and lateral grip (D-06). */
export type SurfaceGripScale = Readonly<
  Record<SurfaceType, Readonly<{ forward: number; lateral: number }>>
>;

function buildUnitSurfaceGripScale(): SurfaceGripScale {
  const table = {} as Record<SurfaceType, Readonly<{ forward: number; lateral: number }>>;
  for (const s of SURFACE_TYPES) table[s] = Object.freeze({ forward: 1, lateral: 1 });
  return Object.freeze(table);
}

/** All-ones table: inert for the existing classes. */
export const UNIT_SURFACE_GRIP_SCALE: SurfaceGripScale = buildUnitSurfaceGripScale();

export interface VehicleClassSpec {
  readonly id: VehicleClassId;
  readonly label: string;
  readonly chassisColor: number;
  /** Fraction (0..1) of total drive force sent to the front axle. */
  readonly frontDriveShare: number;
  readonly storageKey: string;
  /** Per-surface grip multipliers applied at the single surface-grip read site (D-06). */
  readonly surfaceGripScale: SurfaceGripScale;
  /** D-08: medals/best times are recorded for the muscle-car family only; new classes show time only. */
  readonly savesMedals: boolean;
}

function buildRallyGripScale(): SurfaceGripScale {
  const table = {} as Record<SurfaceType, Readonly<{ forward: number; lateral: number }>>;
  for (const s of SURFACE_TYPES) table[s] = Object.freeze({ forward: 1, lateral: 1 });
  table.tarmac = Object.freeze({ forward: 0.97, lateral: 0.95 });
  table.gravel = Object.freeze({ forward: 1.15, lateral: 1.15 });
  table.dirt_road = Object.freeze({ forward: 1.15, lateral: 1.15 });
  table.grass = Object.freeze({ forward: 1.08, lateral: 1.08 });
  table.sand = Object.freeze({ forward: 1.08, lateral: 1.08 });
  table.mud = Object.freeze({ forward: 1.08, lateral: 1.08 });
  return Object.freeze(table);
}

/**
 * FWD green / AWD blue are deliberately brighter and more saturated than the
 * AI paints HIGHLAND GREEN 0x2e8b57 and GRABBER BLUE 0x2f6fd6 so the player
 * stays distinguishable in a race.
 */
export const VEHICLE_CLASSES: Readonly<Record<VehicleClassId, VehicleClassSpec>> = Object.freeze({
  rwd: Object.freeze({
    id: "rwd",
    label: "RWD",
    chassisColor: 0xb5321f,
    frontDriveShare: 0,
    storageKey: TUNING_STORAGE_KEY,
    surfaceGripScale: UNIT_SURFACE_GRIP_SCALE,
    savesMedals: true,
  }),
  fwd: Object.freeze({
    id: "fwd",
    label: "FWD",
    chassisColor: 0x3fbf3f,
    frontDriveShare: 1,
    storageKey: "heat-street.tuning.fwd.v1",
    surfaceGripScale: UNIT_SURFACE_GRIP_SCALE,
    savesMedals: true,
  }),
  awd: Object.freeze({
    id: "awd",
    label: "AWD",
    chassisColor: 0x2a4dff,
    // Configurable front/rear bias: mild rear bias keeps muscle-car character.
    frontDriveShare: 0.4,
    storageKey: "heat-street.tuning.awd.v1",
    surfaceGripScale: UNIT_SURFACE_GRIP_SCALE,
    savesMedals: true,
  }),
  rally: Object.freeze({
    id: "rally",
    label: "Rally Coupe",
    // Orange: distinct from AI paints, pursuer paints and the other player colours.
    chassisColor: 0xf07a1a,
    frontDriveShare: 0.45,
    storageKey: "heat-street.tuning.rally.v1",
    surfaceGripScale: buildRallyGripScale(),
    savesMedals: false,
  }),
});

/**
 * Per-wheel engine force in FL/FR/RL/RR order. `perWheelForce` is the
 * per-rear-wheel value of the RWD car; total drive force is 2x that, split
 * `frontShare` to the front axle and the rest to the rear. Zeros are
 * normalised to +0 so RWD fronts equal the Rapier default exactly.
 */
export function wheelEngineForces(
  perWheelForce: number,
  frontShare: number,
): readonly [number, number, number, number] {
  const front = perWheelForce * frontShare;
  const rear = perWheelForce * (1 - frontShare);
  const f = front === 0 ? 0 : front;
  const r = rear === 0 ? 0 : rear;
  return [f, f, r, r];
}

/**
 * Signed chassis-forward thrust (newtons) for the front-axle share of drive
 * force; positive = forward. Engine-force sign convention is negative =
 * forward (car forward is local -Z). Contribution is per front wheel in
 * ground contact (0..2).
 */
export function frontDriveThrustN(
  perWheelEngineForce: number,
  frontShare: number,
  frontContacts: number,
): number {
  const thrust = -perWheelEngineForce * frontShare * frontContacts;
  return thrust === 0 ? 0 : thrust;
}

/** Class default tuning:`defaultTuning()` plus per-class overrides. */
export function classDefaultTuning(id: VehicleClassId): VehicleTuning {
  const t = defaultTuning();
  switch (id) {
    case "rwd":
      break;
    case "fwd":
      // Reduced (not zero) power-oversteer: with 0 the front-driven car pulled
      // itself straight within ~1.5 s of a handbrake kick-out (user feel report
      // 2026-10-04), so throttle + steer keeps some rear unloading to hold a slide.
      t.drive.powerOversteerGain = 0.5;
      // Max rear grip (TUNING_RANGES ceiling) for a stable tail.
      t.wheels.rearSideFriction = 0.3;
      // Slightly less front bite -> understeer bias.
      t.wheels.frontSideFriction = 1.2;
      // handbrakeRearSideFriction intentionally untouched: handbrake turns still work.
      break;
    case "awd":
      // Grippier overall.
      t.wheels.frictionSlip = 2.0;
      t.wheels.rearSideFriction = 0.3;
      // Some rear-biased throttle rotation, far less than RWD.
      t.drive.powerOversteerGain = 0.5;
      break;
    case "rally":
      t.chassis.mass = 1250;
      t.chassis.halfExtents = { x: 0.9, y: 0.48, z: 2.1 };
      t.chassis.comOffset.y = -0.25;
      t.wheels.halfTrack = 0.8;
      t.wheels.halfWheelbase = 1.35;
      t.wheels.radius = 0.37;
      t.wheels.suspensionRestLength = 0.6;
      t.wheels.maxSuspensionTravel = 0.55;
      t.wheels.suspensionStiffness = 16;
      // AWD planted character: rear-only oversteer terms turned down like awd.
      t.wheels.rearSideFriction = 0.3;
      t.drive.powerOversteerGain = 0.5;
      // topSpeedMs is a gear/limiter scale, not a cap: the measured top speed is
      // about 1.54x it (30 -> 46.3 m/s, the D-05 46 m/s target).
      t.drive.topSpeedMs = 30;
      // D-04: name kept; for the rally coupe this is the drive force per wheel
      // of a two-wheel-drive axle (total = 2x, split 45% front by frontDriveShare).
      // 4800 with topSpeedMs 30 measures 0-60 4.20 s (target 3.4-4.6).
      t.drive.engineForcePerRearWheel = 4800;
      break;
  }
  return t;
}

/** Tuning ranges for a class. rwd/fwd/awd share the TUNING_RANGES object itself (D-02). */
export function classTuningRanges(id: VehicleClassId): TuningRanges {
  switch (id) {
    case "rwd":
    case "fwd":
    case "awd":
    case "rally":
      return TUNING_RANGES;
  }
}

/** D-08 style helper for the debug vehicle menu (brief D9): rewrite `?car=`, keep other params. */
export function searchForVehicle(search: string, id: VehicleClassId): string {
  const params = new URLSearchParams(search);
  params.set("car", id);
  return `?${params.toString()}`;
}
