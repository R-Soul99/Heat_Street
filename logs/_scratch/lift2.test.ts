import { it } from "vitest";
import { applyFeel, FEEL_DEFAULTS } from "../../src/core/feel";
import { classDefaultTuning } from "../../src/core/vehicle-class";
import { DT } from "../../src/core/sim-clock";
import { buildTelemetryScene } from "../../src/physics/telemetry/run";
import { createVehicle, sampleVehicle } from "../../src/physics/vehicle";
import { createWorld } from "../../src/physics/world";
const MPH = 0.44704;
let GAIN: number | undefined; function shipped() { const t = classDefaultTuning("rwd"); applyFeel(t, classDefaultTuning("rwd"), FEEL_DEFAULTS); if (GAIN !== undefined) t.drive.liftOffOversteer = GAIN; return t; }
function run(label: string, mph: number, steerFn: (s: number) => number, thr0: number, liftAt: number, seconds = 4) {
  const tuning = shipped();
  const world = createWorld();
  buildTelemetryScene(world);
  const v = createVehicle(world, tuning, { x: 0, y: 1, z: 0 });
  const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false };
  for (let k = 0; k < 40; k++) { v.tick(idle, tuning); world.step(); }
  v.body.setLinvel({ x: 0, y: 0, z: -mph * MPH }, true);
  let peak = 0, minSfs = 9, headRaw0 = 0, prev = 0, head = 0, maxHead = 0, maxYaw = 0, sfsRest = 0;
  const q0 = v.body.rotation();
  const hd = () => { const q = v.body.rotation(); return Math.atan2(-2 * (q.x * q.z + q.w * q.y), -(-(1 - 2 * (q.x * q.x + q.y * q.y)))); };
  prev = hd();
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    const t = k * DT;
    const thr = t < liftAt ? thr0 : 0;
    v.tick({ steer: steerFn(t), throttle: thr, brake: 0, handbrake: false }, tuning);
    world.step();
    const s = sampleVehicle(v);
    let d = hd() - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; head += d; prev = hd();
    peak = Math.max(peak, Math.abs(s.slipAngleRad * 180 / Math.PI));
    maxHead = Math.max(maxHead, Math.abs(head * 180 / Math.PI));
    maxYaw = Math.max(maxYaw, Math.abs(s.angvel.y));
    if (t >= liftAt) minSfs = Math.min(minSfs, v.rearGrip.sideFriction);
  }
  console.log(label.padEnd(34), "peakSlip", peak.toFixed(1), "maxHeadingDeg", maxHead.toFixed(1), "maxYaw", maxYaw.toFixed(2), "minRearSfs", minSfs.toFixed(3));
  world.free();
}
it("scenarios", () => { for (const g of [undefined, 0]) { GAIN = g; console.log("peakSlip ---- gain", g ?? "shipped", classDefaultTuning("rwd").drive.liftOffOversteer);
  for (const mph of [45, 60, 80]) {
    run(`straight steer0 ${mph}`, mph, () => 0, 0.5, 1);
    run(`straight steer0.05 ${mph}`, mph, () => 0.05, 0.5, 1);
    run(`straight steer0.1 ${mph}`, mph, () => 0.1, 0.5, 1);
    run(`wiggle +-0.15 @1Hz ${mph}`, mph, (t) => 0.15 * Math.sin(2 * Math.PI * t), 0.5, 1);
    run(`wiggle +-0.25 @1.5Hz ${mph}`, mph, (t) => 0.25 * Math.sin(3 * Math.PI * t), 0.5, 1);
    run(`gentle bend 0.2 ${mph}`, mph, (t) => Math.min(0.2, t * 5), 0.5, 1.5);
    run(`bend 0.5 (lively) ${mph}`, mph, (t) => Math.min(0.5, t * 5), 0.5, 1.5);
    run(`bend 0.8 (lively) ${mph}`, mph, (t) => Math.min(0.8, t * 5), 0.5, 1.5);
  } }
});
