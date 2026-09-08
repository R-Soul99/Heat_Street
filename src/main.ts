// TEMPORARY bootstrap. Its only job is to prove the Rapier WASM actually
// executes in a real browser, not merely that it resolves at build time.
// Plan 01-07 replaces this file entirely with the real composition root.
import * as RAPIER from "@dimforge/rapier3d";

// No RAPIER.init() — the non-compat build's init.js is literally `export {}`.
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50), ground);

const box = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 4, 0));
world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), box);

for (let i = 0; i < 10; i++) {
  world.step();
}

const out = document.createElement("pre");
out.style.cssText = "position:fixed;top:8px;left:8px;color:#e8e8ec;font:13px monospace";
// textContent only — never innerHTML (DOM XSS mitigation, T-01-02).
out.textContent = [
  `Rapier version: ${RAPIER.version()}`,
  `bodies: ${world.bodies.len()}`,
  `settled y after 10 steps: ${box.translation().y.toFixed(4)}`,
].join("\n");
document.body.appendChild(out);
