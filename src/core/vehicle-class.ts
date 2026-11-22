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

export const KNOWN_VEHICLE_CLASS_IDS = [
  "rwd",
  "fwd",
  "awd",
  "rally",
  "buggy",
  "truck",
  "monster",
] as const;
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
  /** Metres above ground for the chassis origin at spawn; absent means SPAWN_CLEARANCE_M (0.6). */
  readonly spawnClearanceM?: number;
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

function buildBuggyGripScale(): SurfaceGripScale {
  const table = {} as Record<SurfaceType, Readonly<{ forward: number; lateral: number }>>;
  for (const s of SURFACE_TYPES) table[s] = Object.freeze({ forward: 1, lateral: 1 });
  table.tarmac = Object.freeze({ forward: 0.92, lateral: 0.9 });
  table.sand = Object.freeze({ forward: 1.25, lateral: 1.25 });
  table.grass = Object.freeze({ forward: 1.15, lateral: 1.15 });
  table.mud = Object.freeze({ forward: 1.15, lateral: 1.15 });
  table.gravel = Object.freeze({ forward: 1.1, lateral: 1.1 });
  table.dirt_road = Object.freeze({ forward: 1.1, lateral: 1.1 });
  return Object.freeze(table);
}

function buildTruckGripScale(): SurfaceGripScale {
  const table = {} as Record<SurfaceType, Readonly<{ forward: number; lateral: number }>>;
  for (const s of SURFACE_TYPES) table[s] = Object.freeze({ forward: 1, lateral: 1 });
  table.tarmac = Object.freeze({ forward: 0.98, lateral: 0.95 });
  table.gravel = Object.freeze({ forward: 1.1, lateral: 1.05 });
  table.dirt_road = Object.freeze({ forward: 1.1, lateral: 1.05 });
  table.grass = Object.freeze({ forward: 1.15, lateral: 1.1 });
  table.mud = Object.freeze({ forward: 1.15, lateral: 1.1 });
  table.sand = Object.freeze({ forward: 1.05, lateral: 1.0 });
  return Object.freeze(table);
}

function buildMonsterGripScale(): SurfaceGripScale {
  const table = {} as Record<SurfaceType, Readonly<{ forward: number; lateral: number }>>;
  for (const s of SURFACE_TYPES) table[s] = Object.freeze({ forward: 1, lateral: 1 });
  table.tarmac = Object.freeze({ forward: 0.9, lateral: 0.85 });
  table.mud = Object.freeze({ forward: 1.3, lateral: 1.2 });
  table.sand = Object.freeze({ forward: 1.2, lateral: 1.15 });
  table.grass = Object.freeze({ forward: 1.15, lateral: 1.1 });
  table.gravel = Object.freeze({ forward: 1.05, lateral: 1.0 });
  table.dirt_road = Object.freeze({ forward: 1.05, lateral: 1.0 });
  return Object.freeze(table);
}

function deepFreeze<T>(o: T): T {
  if (typeof o === "object" && o !== null) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

type DeepMutable<T> = { -readonly [K in keyof T]: DeepMutable<T[K]> };

/** Mutable view of a ranges tree for `widenRanges` edit callbacks. */
export type DraftRanges = DeepMutable<TuningRanges>;

/**
 * D-02: deep-copy a plain-number ranges tree, apply `edit`, deep-freeze and
 * return it. The base table is never mutated.
 */
export function widenRanges(base: TuningRanges, edit: (draft: DraftRanges) => void): TuningRanges {
  const draft = structuredClone(base) as DraftRanges;
  edit(draft);
  return deepFreeze(draft) as TuningRanges;
}

/** Buggy ranges: lighter body and longer suspension travel than the muscle-car table. */
const BUGGY_RANGES: TuningRanges = widenRanges(TUNING_RANGES, (d) => {
  d.chassis.mass.min = 500;
  d.wheels.maxSuspensionTravel.max = 0.7;
});

/** Truck ranges: spike result (09-08) Recommended ranges, user approved. */
const TRUCK_RANGES: TuningRanges = widenRanges(TUNING_RANGES, (d) => {
  d.chassis.mass.min = 1800;
  d.chassis.mass.max = 3200;
  d.chassis.halfExtents.y.min = 0.5;
  d.chassis.halfExtents.y.max = 1.0;
  d.chassis.comOffset.y.min = -0.3;
  d.chassis.comOffset.y.max = 0.5;
  d.wheels.halfTrack.min = 0.8;
  d.wheels.halfTrack.max = 1.3;
  d.wheels.halfWheelbase.min = 1.3;
  d.wheels.halfWheelbase.max = 2.2;
  d.wheels.connectionY.min = -0.2;
  d.wheels.connectionY.max = 0.4;
  d.wheels.radius.min = 0.4;
  d.wheels.radius.max = 0.7;
  d.wheels.suspensionRestLength.min = 0.5;
  d.wheels.suspensionRestLength.max = 1.1;
  d.wheels.maxSuspensionTravel.min = 0.4;
  d.wheels.maxSuspensionTravel.max = 0.9;
  d.wheels.suspensionStiffness.min = 6;
  d.wheels.suspensionStiffness.max = 16;
  d.wheels.maxSuspensionForce.min = 20000;
  d.wheels.maxSuspensionForce.max = 80000;
  d.drive.topSpeedMs.min = 18;
  d.drive.topSpeedMs.max = 34;
  d.drive.engineForcePerRearWheel.min = 3000;
  d.drive.engineForcePerRearWheel.max = 9000;
});

/** Monster ranges: spike result (09-08) Recommended ranges, user approved. */
const MONSTER_RANGES: TuningRanges = widenRanges(TUNING_RANGES, (d) => {
  d.chassis.mass.min = 3000;
  d.chassis.mass.max = 6000;
  d.chassis.halfExtents.y.min = 0.6;
  d.chassis.halfExtents.y.max = 1.4;
  d.chassis.comOffset.y.min = -0.3;
  d.chassis.comOffset.y.max = 0.6;
  d.wheels.halfTrack.min = 0.9;
  d.wheels.halfTrack.max = 1.8;
  d.wheels.halfWheelbase.min = 1.4;
  d.wheels.halfWheelbase.max = 2.6;
  d.wheels.connectionY.min = -0.2;
  d.wheels.connectionY.max = 0.6;
  d.wheels.radius.min = 0.4;
  d.wheels.radius.max = 1.2;
  d.wheels.suspensionRestLength.min = 0.6;
  d.wheels.suspensionRestLength.max = 1.6;
  d.wheels.maxSuspensionTravel.min = 0.5;
  d.wheels.maxSuspensionTravel.max = 1.3;
  d.wheels.suspensionStiffness.min = 4;
  d.wheels.suspensionStiffness.max = 16;
  d.wheels.maxSuspensionForce.min = 20000;
  d.wheels.maxSuspensionForce.max = 200000;
  d.drive.topSpeedMs.min = 18;
  d.drive.topSpeedMs.max = 36;
  d.drive.engineForcePerRearWheel.min = 4000;
  d.drive.engineForcePerRearWheel.max = 20000;
});

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
  buggy: Object.freeze({
    id: "buggy",
    label: "Dune Buggy",
    // Sand/teal: distinct from AI paints, pursuer paints and the other player colours.
    chassisColor: 0x2ec4b6,
    frontDriveShare: 0,
    storageKey: "heat-street.tuning.buggy.v1",
    surfaceGripScale: buildBuggyGripScale(),
    savesMedals: false,
  }),
  truck: Object.freeze({
    id: "truck",
    label: "4x4 Pickup",
    chassisColor: 0x8a6a2f,
    frontDriveShare: 0.5,
    storageKey: "heat-street.tuning.truck.v1",
    surfaceGripScale: buildTruckGripScale(),
    savesMedals: false,
    // Spike 09-08: radius 0.5 + rest 0.8 - connectionY 0.10 + 0.1.
    spawnClearanceM: 1.3,
  }),
  monster: Object.freeze({
    id: "monster",
    label: "Monster Truck",
    chassisColor: 0xd4c21a,
    frontDriveShare: 0.5,
    storageKey: "heat-street.tuning.monster.v1",
    surfaceGripScale: buildMonsterGripScale(),
    savesMedals: false,
    // Spike 09-08: radius 0.9 + rest 1.2 - connectionY 0.10 + 0.1.
    spawnClearanceM: 2.1,
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
    case "buggy":
      t.chassis.mass = 750;
      t.chassis.halfExtents = { x: 0.8, y: 0.35, z: 1.6 };
      t.chassis.comOffset.y = -0.25;
      t.wheels.halfTrack = 0.85;
      // 1.15 popped a launch wheelie to 69 deg (stability routine); 1.4 measures 6.6 deg.
      t.wheels.halfWheelbase = 1.4;
      t.wheels.radius = 0.4;
      t.wheels.suspensionRestLength = 0.7;
      t.wheels.maxSuspensionTravel = 0.65;
      // Brief D5 says 9, but 9-10 rolls the light body over at full lock (27-56 deg
      // at 15 m/s); 12 measures 8 deg.
      t.wheels.suspensionStiffness = 12;
      t.wheels.maxSuspensionForce = 12000;
      // Light body on full-grip tyres rolls over at full lock at 60 mph (59-92 deg);
      // 1.4 (muscle car 1.7) keeps it sliding instead (10 deg) and suits a twitchy buggy.
      t.wheels.frictionSlip = 1.4;
      // topSpeedMs is a gear/limiter scale (measured top ~1.45x it: 27.3 -> 39.5 m/s,
      // inside the 38 m/s +-10% band). Below ~26.8 the limiter starves 0-60.
      t.drive.topSpeedMs = 27.3;
      // Measured 0-60 5.13 s at 3000 (smooth: 3500 -> 4.22, 2500 -> 7.55). Keep it
      // low: 5000+ with the short wheelbase wheelied the car over.
      t.drive.engineForcePerRearWheel = 3000;
      break;
    case "truck":
      // Spike 09-08 Recommended values (iteration 6b); inside-wheel-lift target open (09-10).
      t.chassis.mass = 2300;
      t.chassis.halfExtents = { x: 1.0, y: 0.7, z: 2.7 };
      t.chassis.comOffset.y = 0.1;
      t.wheels.halfTrack = 1.0;
      t.wheels.halfWheelbase = 1.7;
      t.wheels.connectionY = 0.1;
      t.wheels.radius = 0.5;
      t.wheels.suspensionRestLength = 0.8;
      t.wheels.maxSuspensionTravel = 0.7;
      t.wheels.suspensionStiffness = 10;
      t.wheels.maxSuspensionForce = 40000;
      // AWD planted character: rear-only oversteer terms turned down like awd.
      t.wheels.rearSideFriction = 0.3;
      t.drive.powerOversteerGain = 0.5;
      // Brief stage 7.3: calmer steering for tall vehicles.
      t.drive.maxSteerLock = Math.PI / 6;
      t.drive.steerRampPerSec = 4;
      t.drive.topSpeedMs = 30;
      t.drive.engineForcePerRearWheel = 6000;
      break;
    case "monster":
      // Spike 09-08 Recommended values (iteration 5), user approved at 09-08.
      t.chassis.mass = 4500;
      t.chassis.halfExtents = { x: 1.25, y: 0.9, z: 2.7 };
      t.chassis.comOffset.y = 0.1;
      t.chassis.linearDamping = 0.05;
      t.wheels.halfTrack = 1.5;
      t.wheels.halfWheelbase = 2.0;
      t.wheels.connectionY = 0.1;
      t.wheels.radius = 0.9;
      t.wheels.suspensionRestLength = 1.2;
      t.wheels.maxSuspensionTravel = 1.0;
      t.wheels.suspensionStiffness = 7;
      t.wheels.maxSuspensionForce = 80000;
      t.wheels.rearSideFriction = 0.3;
      t.drive.powerOversteerGain = 0.5;
      // Brief stage 7.3: calmer steering for tall vehicles.
      t.drive.maxSteerLock = Math.PI / 6;
      t.drive.steerRampPerSec = 4;
      // Measured 0-60 7.65 s, top 35.8 m/s (accepted; the gear knee is sharp).
      t.drive.topSpeedMs = 29;
      t.drive.engineForcePerRearWheel = 12000;
      break;
  }
  return t;
}

/** Tuning ranges for a class. rwd/fwd/awd/rally share the TUNING_RANGES object itself; buggy has a widened copy (D-02). */
export function classTuningRanges(id: VehicleClassId): TuningRanges {
  switch (id) {
    case "rwd":
    case "fwd":
    case "awd":
    case "rally":
      return TUNING_RANGES;
    case "buggy":
      return BUGGY_RANGES;
    case "truck":
      return TRUCK_RANGES;
    case "monster":
      return MONSTER_RANGES;
  }
}

/** D-08 style helper for the debug vehicle menu (brief D9): rewrite `?car=`, keep other params. */
export function searchForVehicle(search: string, id: VehicleClassId): string {
  const params = new URLSearchParams(search);
  params.set("car", id);
  return `?${params.toString()}`;
}
