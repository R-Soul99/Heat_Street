import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/feel-test.collision.json?raw";
import compiledRaw from "../public/maps/feel-test.map.json?raw";
import stationsRaw from "../public/maps/feel-test.stations.json?raw";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import {
  LAUNCH_RIDE_HEIGHT_LIFT_M,
  launchVelocity,
  parseStations,
} from "../src/debug/test-stations";
import { createMapScene } from "../src/physics/map-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "public/maps/feel-test.map.json");
const collision = parseMapCollision(
  collisionRaw,
  graph.areaId,
  "public/maps/feel-test.collision.json",
);
const stations = parseStations(stationsRaw, graph.areaId);

const MPH = 0.44704;

interface RampRun {
  readonly airborneS: number;
  readonly flightM: number;
  /** Highest the chassis gets above where it sat on the road, metres. */
  readonly riseM: number;
  readonly takeOffMph: number;
  /** Speed lost between take-off and 0.5 s after touching down, mph. */
  readonly landingLossMph: number;
  /** Largest chassis tilt while airborne, degrees. */
  readonly maxTiltDeg: number;
  readonly endContacts: number;
}

/** Launches from a ramp station and coasts (no throttle) so the speed at the ramp is the pad speed less drag. */
function fly(stationId: string, speedMph: number): RampRun {
  const world = createWorld();
  const scene = createMapScene(world, graph, collision, defaultTuning(), defaultSurfaceProfiles());
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) throw new Error(`no station ${stationId}`);
  scene.resetVehicle({
    x: station.x,
    y: scene.defaultSpawnPose.y + LAUNCH_RIDE_HEIGHT_LIFT_M,
    z: station.z,
    headingRad: station.headingRad,
  });
  scene.vehicle.body.setLinvel(launchVelocity(station.headingRad, speedMph), true);
  let restY = 0;
  let takeOff = -1;
  let landing = -1;
  let takeOffX = 0;
  let landX = 0;
  let takeOffMph = 0;
  let rise = 0;
  let maxTilt = 0;
  let after = 0;
  let endContacts = 0;
  const ticks = 8 * 60;
  for (let t = 0; t < ticks; t++) {
    scene.applyInput(NEUTRAL);
    world.step();
    const s = sampleVehicle(scene.vehicle);
    if (t === 30) restY = s.position.y;
    endContacts = s.contacts;
    // The first flight after the foot of the ramp (the pad is 65-70 m before it).
    if (
      takeOff < 0 &&
      t > 30 &&
      s.contacts === 0 &&
      s.position.x > station.x + station.featureAheadM
    ) {
      takeOff = t;
      takeOffX = s.position.x;
      takeOffMph = s.groundSpeedMs / MPH;
    }
    if (takeOff >= 0 && landing < 0) {
      rise = Math.max(rise, s.position.y - restY);
      maxTilt = Math.max(maxTilt, s.tiltDeg);
      if (s.contacts >= 2 && t > takeOff + 3) {
        landing = t;
        landX = s.position.x;
      }
    }
    if (landing >= 0 && t === landing + 30) after = s.groundSpeedMs / MPH;
  }
  return {
    airborneS: landing < 0 ? 0 : (landing - takeOff) / 60,
    flightM: landX - takeOffX,
    riseM: rise,
    takeOffMph,
    landingLossMph: takeOffMph - after,
    maxTiltDeg: maxTilt,
    endContacts,
  };
}

/** Throttle held, from a hard launch, with the air pitch assist set to `airPitchGain`. */
function flyHard(stationId: string, speedMph: number, airPitchGain: number) {
  const world = createWorld();
  const tuning = defaultTuning();
  tuning.assists.airPitchGain = airPitchGain;
  const scene = createMapScene(world, graph, collision, tuning, defaultSurfaceProfiles());
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) throw new Error(`no station ${stationId}`);
  scene.resetVehicle({
    x: station.x,
    y: scene.defaultSpawnPose.y + LAUNCH_RIDE_HEIGHT_LIFT_M,
    z: station.z,
    headingRad: station.headingRad,
  });
  scene.vehicle.body.setLinvel(launchVelocity(station.headingRad, speedMph), true);
  let airborneSince = -1;
  let maxTilt = 0;
  let landedOnWheels = false;
  for (let t = 0; t < 4 * 60; t++) {
    scene.applyInput({ ...NEUTRAL, throttle: 1 });
    world.step();
    const s = sampleVehicle(scene.vehicle);
    if (airborneSince < 0 && s.contacts === 0 && s.position.x > station.x + station.featureAheadM) {
      airborneSince = t;
    }
    if (airborneSince >= 0 && t <= airborneSince + 150) {
      maxTilt = Math.max(maxTilt, s.tiltDeg);
      if (s.contacts >= 3 && t > airborneSince + 5 && s.tiltDeg < 35) landedOnWheels = true;
    }
  }
  return { maxTiltDeg: maxTilt, landedOnWheels };
}

/** Wheel-ticks spent fully compressed (length 0.05) from the foot of the ramp to take-off, throttle held. */
function bottomedTicks(stationId: string, speedMph: number, bumpStopStiffness: number): number {
  const world = createWorld();
  const tuning = defaultTuning();
  tuning.wheels.bumpStopStiffness = bumpStopStiffness;
  const scene = createMapScene(world, graph, collision, tuning, defaultSurfaceProfiles());
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) throw new Error(`no station ${stationId}`);
  scene.resetVehicle({
    x: station.x,
    y: scene.defaultSpawnPose.y + LAUNCH_RIDE_HEIGHT_LIFT_M,
    z: station.z,
    headingRad: station.headingRad,
  });
  scene.vehicle.body.setLinvel(launchVelocity(station.headingRad, speedMph), true);
  let bottomed = 0;
  for (let t = 0; t < 6 * 60; t++) {
    scene.applyInput({ ...NEUTRAL, throttle: 1 });
    world.step();
    const s = sampleVehicle(scene.vehicle);
    if (s.position.x < station.x + station.featureAheadM - 3) continue;
    for (let i = 0; i < 4; i++) {
      const length = scene.vehicle.controller.wheelSuspensionLength(i);
      if (length !== null && length <= 0.051) bottomed++;
    }
    if (s.contacts === 0) return bottomed;
  }
  throw new Error("never took off");
}

/** Ground speed at the foot of the ramp and at take-off, mph, throttle held. */
function climb(stationId: string, speedMph: number): { footMph: number; lipMph: number } {
  const world = createWorld();
  const scene = createMapScene(world, graph, collision, defaultTuning(), defaultSurfaceProfiles());
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) throw new Error(`no station ${stationId}`);
  scene.resetVehicle({
    x: station.x,
    y: scene.defaultSpawnPose.y + LAUNCH_RIDE_HEIGHT_LIFT_M,
    z: station.z,
    headingRad: station.headingRad,
  });
  scene.vehicle.body.setLinvel(launchVelocity(station.headingRad, speedMph), true);
  let footMph = 0;
  for (let t = 0; t < 6 * 60; t++) {
    scene.applyInput({ ...NEUTRAL, throttle: 1 });
    world.step();
    const s = sampleVehicle(scene.vehicle);
    const mph = s.groundSpeedMs / MPH;
    if (footMph === 0 && s.position.x > station.x + station.featureAheadM - 2) footMph = mph;
    if (footMph > 0 && s.contacts === 0) return { footMph, lipMph: mph };
  }
  throw new Error("never took off");
}

/** Largest drop below the last airborne speed in the 8 ticks after first touchdown, mph, throttle held. */
function landingDip(stationId: string, speedMph: number): number {
  const world = createWorld();
  const scene = createMapScene(world, graph, collision, defaultTuning(), defaultSurfaceProfiles());
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) throw new Error(`no station ${stationId}`);
  scene.resetVehicle({
    x: station.x,
    y: scene.defaultSpawnPose.y + LAUNCH_RIDE_HEIGHT_LIFT_M,
    z: station.z,
    headingRad: station.headingRad,
  });
  scene.vehicle.body.setLinvel(launchVelocity(station.headingRad, speedMph), true);
  let airTicks = 0;
  let airMph = 0;
  let landed = -1;
  let minMph = Number.POSITIVE_INFINITY;
  for (let t = 0; t < 8 * 60; t++) {
    scene.applyInput({ ...NEUTRAL, throttle: 1 });
    world.step();
    const s = sampleVehicle(scene.vehicle);
    const mph = s.groundSpeedMs / MPH;
    if (s.contacts === 0) {
      airTicks++;
      airMph = mph;
    } else if (airTicks > 18 && landed < 0) {
      landed = t;
    }
    if (landed >= 0) {
      minMph = Math.min(minMph, mph);
      if (t > landed + 8) return airMph - minMph;
    }
  }
  throw new Error("never landed");
}

describe("feel-test game-scale ramps", () => {
  // Pad speeds are what the station launches at; the car coasts ~65 m to the foot and
  // arrives 7-10 mph slower (take-off speed is in the run). The feet are 150 m radius arcs,
  // so these are long, low ramps: the bigger the speed, the bigger the jump.
  it("the small ramp is a hop that works from a 40 mph pad launch and grows with speed", () => {
    const slow = fly("ramp-s", 40);
    expect(slow.airborneS).toBeGreaterThan(0.25);
    const fast = fly("ramp-s", 60);
    expect(fast.airborneS).toBeGreaterThan(0.45);
    expect(fast.airborneS).toBeLessThan(1.1);
    expect(fast.flightM).toBeGreaterThan(8);
    expect(fast.flightM).toBeLessThan(22);
    expect(fast.riseM).toBeLessThan(2);
  });

  it("the medium ramp at 60 mph is a ~20 m jump", () => {
    const run = fly("ramp-m", 60);
    expect(run.airborneS).toBeGreaterThan(0.7);
    expect(run.airborneS).toBeLessThan(1.4);
    expect(run.flightM).toBeGreaterThan(14);
    expect(run.flightM).toBeLessThan(30);
    expect(run.riseM).toBeGreaterThan(1.8);
    expect(run.riseM).toBeLessThan(3.5);
  });

  it("the large ramp is the big end: ~25 m at 60 mph, ~50 m and 5 m up at 85 mph", () => {
    const mid = fly("ramp-l", 60);
    expect(mid.airborneS).toBeGreaterThan(1);
    expect(mid.airborneS).toBeLessThan(1.6);
    expect(mid.flightM).toBeGreaterThan(18);
    expect(mid.flightM).toBeLessThan(36);
    const fast = fly("ramp-l", 85);
    expect(fast.airborneS).toBeGreaterThan(1.3);
    expect(fast.airborneS).toBeLessThan(2.1);
    expect(fast.flightM).toBeGreaterThan(40);
    expect(fast.flightM).toBeLessThan(70);
    expect(fast.riseM).toBeGreaterThan(4);
    expect(fast.riseM).toBeLessThan(6.5);
  });

  it("every ramp lands on its wheels and the car ends upright, at every design speed", () => {
    for (const [id, speeds] of [
      ["ramp-s", [40, 60, 85]],
      ["ramp-m", [40, 50, 60]],
      ["ramp-l", [40, 60, 85]],
    ] as const) {
      for (const mph of speeds) {
        const run = fly(id, mph);
        expect(run.airborneS, `${id} @ ${mph}`).toBeGreaterThan(0.25);
        expect(run.endContacts, `${id} @ ${mph}`).toBe(4);
        expect(run.maxTiltDeg, `${id} @ ${mph}`).toBeLessThan(45);
      }
    }
  });

  it("the ramps do not slow the car: speed at the lip is within 2 mph of speed at the foot, at 85 mph", () => {
    for (const id of ["ramp-s", "ramp-m", "ramp-l"]) {
      const { footMph, lipMph } = climb(id, 85);
      expect(lipMph, id).toBeGreaterThan(footMph - 2);
    }
  });

  it("air pitch assist: 85 mph off the small ramp lands on its wheels, not its nose", () => {
    const run = flyHard("ramp-s", 85, 25);
    expect(run.maxTiltDeg).toBeLessThan(30);
    expect(run.landedOnWheels).toBe(true);
  });

  it("air pitch assist: it holds across the medium ramp too, at 85 mph", () => {
    const run = flyHard("ramp-m", 85, 25);
    expect(run.maxTiltDeg).toBeLessThan(35);
  });

  it("touchdown from the large ramp at 85 mph is not a grab: speed never dips more than 4 mph in the next 8 ticks", () => {
    expect(landingDip("ramp-l", 85)).toBeLessThan(4);
    expect(landingDip("ramp-m", 85)).toBeLessThan(4);
  });

  it("the springs cushion the climb instead of sitting on the bump stop, at 95 mph", () => {
    const soft = bottomedTicks("ramp-l", 95, 4);
    const hard = bottomedTicks("ramp-l", 95, 1);
    expect(hard).toBeGreaterThan(60);
    expect(soft).toBeLessThan(25);
  });

  it("a bigger ramp flies further at the same pad speed", () => {
    const s = fly("ramp-s", 50);
    const m = fly("ramp-m", 50);
    const l = fly("ramp-l", 50);
    expect(m.flightM).toBeGreaterThan(s.flightM);
    expect(l.flightM).toBeGreaterThan(m.flightM);
  });
});
