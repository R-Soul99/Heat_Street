import { describe, expect, it } from "vitest";
import collisionRaw from "../public/maps/feel-test.collision.json?raw";
import compiledRaw from "../public/maps/feel-test.map.json?raw";
import stationsRaw from "../public/maps/feel-test.stations.json?raw";
import { NEUTRAL } from "../src/core/input-tape";
import { parseMapCollision } from "../src/core/map-collision";
import { parseRoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { launchVelocity, parseStations } from "../src/debug/test-stations";
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
    y: scene.defaultSpawnPose.y,
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
    y: scene.defaultSpawnPose.y,
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

describe("feel-test game-scale ramps", () => {
  // Pad speeds are what the station launches at; the car coasts ~65 m to the foot and
  // arrives 7-10 mph slower (take-off speed is in the run).
  it("the small ramp is a hop that needs no run-up: airborne from a 30 mph pad launch", () => {
    const small = fly("ramp-s", 30);
    expect(small.airborneS).toBeGreaterThan(0.25);
    const run = fly("ramp-s", 40);
    expect(run.airborneS).toBeGreaterThan(0.4);
    expect(run.airborneS).toBeLessThan(1.2);
    expect(run.flightM).toBeGreaterThan(5);
    expect(run.flightM).toBeLessThan(15);
    expect(run.riseM).toBeLessThan(2);
  });

  it("the medium ramp at 50 mph is a ~20 m jump", () => {
    const run = fly("ramp-m", 50);
    expect(run.airborneS).toBeGreaterThan(0.8);
    expect(run.airborneS).toBeLessThan(1.8);
    expect(run.flightM).toBeGreaterThan(14);
    expect(run.flightM).toBeLessThan(30);
    expect(run.riseM).toBeGreaterThan(2);
    expect(run.riseM).toBeLessThan(4.5);
  });

  it("the large ramp at 60 mph is the big end: ~35 m, 6 m up", () => {
    const run = fly("ramp-l", 60);
    expect(run.airborneS).toBeGreaterThan(1.4);
    expect(run.airborneS).toBeLessThan(2.6);
    expect(run.flightM).toBeGreaterThan(28);
    expect(run.flightM).toBeLessThan(50);
    expect(run.riseM).toBeGreaterThan(4.5);
    expect(run.riseM).toBeLessThan(7.5);
  });

  it("every ramp lands on its wheels and the car ends upright, at every design speed", () => {
    for (const [id, speeds] of [
      ["ramp-s", [30, 35, 40, 45]],
      ["ramp-m", [40, 45, 50, 55]],
      ["ramp-l", [50, 55, 60, 65]],
    ] as const) {
      for (const mph of speeds) {
        const run = fly(id, mph);
        expect(run.airborneS, `${id} @ ${mph}`).toBeGreaterThan(0.2);
        expect(run.endContacts, `${id} @ ${mph}`).toBe(4);
        expect(run.maxTiltDeg, `${id} @ ${mph}`).toBeLessThan(45);
      }
    }
  });

  it("air pitch assist: 85 mph off the small ramp (twice its design speed) lands on its wheels, not its nose", () => {
    const run = flyHard("ramp-s", 85, 25);
    expect(run.maxTiltDeg).toBeLessThan(30);
    expect(run.landedOnWheels).toBe(true);
  });

  it("air pitch assist: the same launch with the assist off tumbles (proves the gate can fail)", () => {
    const run = flyHard("ramp-s", 85, 0);
    expect(run.maxTiltDeg).toBeGreaterThan(90);
  });

  it("air pitch assist: it holds across the medium ramp too, at 85 mph", () => {
    const run = flyHard("ramp-m", 85, 25);
    expect(run.maxTiltDeg).toBeLessThan(35);
  });

  it("a bigger ramp flies further at the same pad speed", () => {
    const s = fly("ramp-s", 50);
    const m = fly("ramp-m", 50);
    const l = fly("ramp-l", 50);
    expect(m.flightM).toBeGreaterThan(s.flightM);
    expect(l.flightM).toBeGreaterThan(m.flightM);
  });
});
