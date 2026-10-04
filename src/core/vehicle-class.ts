/**
 * Player vehicle classes (RWD / FWD / AWD) for drivetrain A/B testing.
 *
 * Selected through the allowlisted `?car=` URL param. Pure module: no three or
 * rapier imports. Index lookups into `VEHICLE_CLASSES` only ever use an
 * already-allowlisted `VehicleClassId`.
 */
import { defaultTuning, TUNING_STORAGE_KEY, type VehicleTuning } from "./vehicle-tuning";

export const KNOWN_VEHICLE_CLASS_IDS = ["rwd", "fwd", "awd"] as const;
export type VehicleClassId = (typeof KNOWN_VEHICLE_CLASS_IDS)[number];
export const DEFAULT_VEHICLE_CLASS_ID: VehicleClassId = "rwd";

/** Exact-match allowlist (array `find`, never object-key lookup). */
export function resolveVehicleClassId(search: string): VehicleClassId {
  const requested = new URLSearchParams(search).get("car");
  if (requested === null) return DEFAULT_VEHICLE_CLASS_ID;
  const match = KNOWN_VEHICLE_CLASS_IDS.find((id) => id === requested);
  return match ?? DEFAULT_VEHICLE_CLASS_ID;
}

export interface VehicleClassSpec {
  readonly id: VehicleClassId;
  readonly label: string;
  readonly chassisColor: number;
  /** Fraction (0..1) of total drive force sent to the front axle. */
  readonly frontDriveShare: number;
  readonly storageKey: string;
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
  }),
  fwd: Object.freeze({
    id: "fwd",
    label: "FWD",
    chassisColor: 0x3fbf3f,
    frontDriveShare: 1,
    storageKey: "heat-street.tuning.fwd.v1",
  }),
  awd: Object.freeze({
    id: "awd",
    label: "AWD",
    chassisColor: 0x2a4dff,
    // Configurable front/rear bias: mild rear bias keeps muscle-car character.
    frontDriveShare: 0.4,
    storageKey: "heat-street.tuning.awd.v1",
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

/** Class default tuning: `defaultTuning()` plus per-class overrides. */
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
      // More drive force: with the steered front wheels carrying all of it, the
      // car scrubs speed cornering on throttle (measured: 25 mph in, full throttle
      // + half lock for 1.5 s -> 21 mph out, vs RWD 40). 6000 (RWD 4800; total is
      // 2x per-wheel) lifts corner exit ~34 -> 38 mph at +1 s and 0-60 to ~3.3 s.
      t.drive.engineForcePerRearWheel = 6000;
      break;
    case "awd":
      // Grippier overall.
      t.wheels.frictionSlip = 1.8;
      t.wheels.rearSideFriction = 0.3;
      // Some rear-biased throttle rotation, far less than RWD.
      t.drive.powerOversteerGain = 0.5;
      break;
  }
  return t;
}
