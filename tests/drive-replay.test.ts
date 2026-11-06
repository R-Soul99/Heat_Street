import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
import { shippedTuning } from "../src/core/feel";
import type { VehicleTuning } from "../src/core/vehicle-tuning";
import { createVehicle, sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";
import bigLoopRaw from "./fixtures/drive-bigloop-2026-11-06-c.csv?raw";
import holdsRaw from "./fixtures/drive-holds-2026-11-06-b.csv?raw";
import loopRaw from "./fixtures/drive-loop-2026-11-06-a.csv?raw";

const MPH = 0.44704;

interface Frame {
  readonly steer: number;
  readonly throttle: number;
  readonly brake: number;
  readonly handbrake: boolean;
}

/** Recorded keyboard inputs, one frame per tick; the first row's speed is the launch speed. */
function parse(raw: string): { frames: Frame[]; launchMph: number } {
  const lines = raw.trim().split("\n").slice(1);
  const frames = lines.map((l) => {
    const c = l.split(",");
    return {
      steer: Number(c[0]),
      throttle: Number(c[1]),
      brake: Number(c[2]),
      handbrake: c[3] === "1",
    };
  });
  return { frames, launchMph: Number((lines[0] ?? "0").split(",")[4]) };
}

interface Slide {
  readonly peakDeg: number;
  readonly entryMph: number;
  readonly exitMph: number;
}

/** Replays recorded inputs through the shipped car on a 40 km flat plane; returns every slide over 20 deg lasting 0.5 s+. */
function replay(raw: string, mod: (t: VehicleTuning) => void = () => {}): Slide[] {
  const { frames, launchMph } = parse(raw);
  const world = createWorld();
  try {
    const tuning = shippedTuning();
    mod(tuning);
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(20000, 1, 20000), ground);
    const vehicle = createVehicle(world, tuning, { x: 0, y: 1, z: 0 });
    const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    for (let k = 0; k < 120; k++) {
      vehicle.tick(idle, tuning);
      world.step();
    }
    vehicle.body.setLinvel({ x: 0, y: 0, z: -launchMph * MPH }, true);
    const slides: Slide[] = [];
    let start = -1;
    let peak = 0;
    let entry = 0;
    let last = 0;
    frames.forEach((f, i) => {
      vehicle.tick(f, tuning);
      world.step();
      const s = sampleVehicle(vehicle);
      const slip = Math.abs(s.slipAngleRad) * 57.3;
      last = s.groundSpeedMs / MPH;
      if (slip > 20) {
        if (start < 0) {
          start = i;
          peak = 0;
          entry = last;
        }
        peak = Math.max(peak, slip);
      } else if (start >= 0) {
        if (i - start >= 30) slides.push({ peakDeg: peak, entryMph: entry, exitMph: last });
        start = -1;
      }
    });
    return slides;
  } finally {
    world.free();
  }
}

describe("replay of the 2026-11-06 hand drives (flat plane, shipped car)", () => {
  it("the old tyre falloff (0.3) reproduces the deep, speed-killing slides from the drive", () => {
    const slides = replay(loopRaw, (t) => {
      t.drive.tyreFalloff = 0.3;
      t.drive.frontFalloff = 0; // isolates the rear falloff
    });
    expect(slides.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...slides.map((s) => s.peakDeg))).toBeGreaterThan(70);
    expect(Math.min(...slides.map((s) => s.exitMph / s.entryMph))).toBeLessThan(0.3);
  });

  it("the shipped falloff holds the loop's slides at 20-40 deg and keeps most of the speed", () => {
    const slides = replay(loopRaw);
    expect(slides.length).toBeGreaterThanOrEqual(2);
    for (const s of slides) {
      expect(s.peakDeg).toBeLessThan(45);
      expect(s.exitMph / s.entryMph).toBeGreaterThan(0.6);
    }
  });

  it("the larger loop (100 mph entries) holds at 25-40 deg and keeps most of its speed with the front falloff", () => {
    // Opt-in only: hand-driven 2026-11-06 it felt like auto-correcting mid-turn, so it ships off.
    const slides = replay(bigLoopRaw, (t) => {
      t.drive.frontFalloff = 0.5;
    });
    expect(slides.length).toBeGreaterThanOrEqual(2);
    for (const s of slides) {
      expect(s.peakDeg).toBeLessThan(45);
      expect(s.exitMph / s.entryMph).toBeGreaterThan(0.75);
    }
  });

  it("without the front falloff the larger loop scrubs 25+ mph in 50 deg slides", () => {
    const slides = replay(bigLoopRaw, (t) => {
      t.drive.frontFalloff = 0;
    });
    expect(Math.max(...slides.map((s) => s.peakDeg))).toBeGreaterThan(48);
    expect(Math.min(...slides.map((s) => s.exitMph / s.entryMph))).toBeLessThan(0.7);
  });

  it("the drift hold (opt-in) keeps the larger loop's slides sideways at 25-45 deg and never spins", () => {
    const slides = replay(bigLoopRaw, (t) => {
      t.drive.driftHold = 1;
    });
    const base = replay(bigLoopRaw);
    expect(Math.max(...slides.map((s) => s.peakDeg))).toBeLessThan(50);
    // Slides last longer than without it (more of them reach the 0.5 s bar).
    expect(slides.length).toBeGreaterThan(base.length);
  });

  it("the low-speed hold drive never spins out past 90 deg", () => {
    const slides = replay(holdsRaw);
    expect(slides.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...slides.map((s) => s.peakDeg))).toBeLessThan(90);
  });
});
