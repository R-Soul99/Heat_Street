// Golden end-state test for the shipped rwd / fwd / awd cars (phase 9, D-09).
// Recorded on the untouched tree before any phase 9 source change. It may only
// be updated for a user-approved handling change. Tolerance 1e-6 assumes the
// same machine (research A3).
import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import { type InputFrame, NEUTRAL } from "../src/core/input-tape";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { VEHICLE_CLASSES, type VehicleClassId } from "../src/core/vehicle-class";
import { createSurfaceMap } from "../src/physics/surface";
import { createVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const IDS = ["rwd", "fwd", "awd"] as const satisfies readonly VehicleClassId[];
const TICKS = 600;

function tape(i: number): InputFrame {
  if (i < 150) return { ...NEUTRAL, throttle: 1 };
  if (i < 300) return { ...NEUTRAL, throttle: 0.8, steer: -1 };
  if (i < 360) return { ...NEUTRAL, handbrake: true, steer: -1 };
  if (i < 480) return { ...NEUTRAL, brake: 1 };
  return NEUTRAL;
}

function endState(id: VehicleClassId, gravel: boolean): number[] {
  const world = createWorld();
  try {
    const tuning = shippedTuning(id);
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500), ground);
    const vehicle = createVehicle(
      world,
      tuning,
      { x: 0, y: 1, z: 0 },
      VEHICLE_CLASSES[id].frontDriveShare,
    );
    const map = createSurfaceMap();
    if (gravel) map.register(collider.handle, "gravel");
    const surfaces = { map, profiles: defaultSurfaceProfiles() };
    for (let i = 0; i < TICKS; i++) {
      if (gravel) vehicle.tick(tape(i), tuning, surfaces);
      else vehicle.tick(tape(i), tuning);
      world.step();
    }
    const p = vehicle.body.translation();
    const q = vehicle.body.rotation();
    const v = vehicle.body.linvel();
    const w = vehicle.body.angvel();
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z];
  } finally {
    world.free();
  }
}

const GOLDEN: Record<string, number[]> = {
  "rwd.flat": [
    -84.00914001464844, 0.940544605255127, -104.00679016113281, -0.000001132301576944883,
    0.8730434775352478, -0.000003932528215955244, -0.487642377614975, -10.783136367797852,
    -0.06128336116671562, -6.639639854431152, -0.0002026382862823084, -0.001995642203837633,
    -0.00010279441630700603,
  ],
  "rwd.gravel": [
    -84.98130798339844, 0.9405449628829956, -119.68443298339844, -4.9113332067918236e-8,
    0.8784884810447693, -0.0000010979547369061038, -0.47776365280151367, -10.896369934082031,
    -0.061282623559236526, -7.054218292236328, -0.00008441727550234646, -0.001402096007950604,
    -0.0000440435906057246,
  ],
  "fwd.flat": [
    -85.20586395263672, 0.9405445456504822, -63.86261749267578, -4.862644686909334e-7,
    0.7489625811576843, 4.2828148139051336e-7, -0.6626123189926147, -11.37584400177002,
    -0.06127963960170746, -1.3980157375335693, 0.0001684838643996045, 0.0017757726600393653,
    0.00002069819856842514,
  ],
  "fwd.gravel": [
    -92.73258209228516, 0.9405449628829956, -97.95673370361328, -3.0049795896047726e-7,
    0.8403592705726624, 1.9489706915010174e-7, -0.5420297980308533, -11.778616905212402,
    -0.061282794922590256, -5.332663536071777, 0.00007792279939167202, 0.001351729268208146,
    0.00003547189771779813,
  ],
  "awd.flat": [
    -86.46905517578125, 0.940544843673706, -65.55304718017578, -0.0000014209171013135347,
    0.7455589771270752, -0.0000029493935471691657, -0.6664396524429321, -11.545942306518555,
    -0.061288028955459595, -1.2966725826263428, -0.00022442609770223498, -0.0019924710504710674,
    0.000004650379651138792,
  ],
  "awd.gravel": [
    -93.59370422363281, 0.9405450820922852, -96.6529541015625, -7.040077321107674e-7,
    0.8217350244522095, -3.452344117249595e-7, -0.569869875907898, -12.131404876708984,
    -0.06128448620438576, -4.5405964851379395, 0.00009206699905917048, 0.0014046098804101348,
    0.00004191234620520845,
  ],
};

describe("golden end state, shipped cars", () => {
  for (const id of IDS) {
    for (const run of ["flat", "gravel"] as const) {
      it(`${id} ${run}`, () => {
        const got = endState(id, run === "gravel");
        expect(Math.hypot(got[0] ?? 0, got[2] ?? 0)).toBeGreaterThan(5);
        const want = GOLDEN[`${id}.${run}`] ?? [];
        expect(got).toHaveLength(13);
        got.forEach((g, k) => {
          expect(g).toBeCloseTo(want[k] ?? Number.NaN, 6);
        });
      });
    }
  }
});
