/**
 * The Rapier world factory.
 *
 * Importing this module makes it an ASYNC module: Vite's WebAssembly ESM
 * integration resolves `@dimforge/rapier3d`'s `.wasm` with a top-level await, so
 * every importer up the chain becomes async too. That is why
 * `build.target: "esnext"` in `vite.config.ts` is mandatory rather than a
 * preference — dropping it breaks the whole physics layer at build time.
 *
 * There is deliberately no initialisation call on the RAPIER namespace. The
 * non-compat build's `init.js` is literally `export {}`; awaiting an `init` that
 * does not exist is the most likely copy-paste error carried over from
 * `@dimforge/rapier3d-compat` tutorials.
 * See 01-RESEARCH.md "Don't Hand-Roll" and "Code Examples > Example 2".
 *
 * Layering: this module may import `@dimforge/rapier3d` and `src/core/`. It must
 * not import `three` and must not touch the DOM or any wall clock.
 */
import * as RAPIER from "@dimforge/rapier3d";
import { DT } from "../core/sim-clock";

/** Earth gravity, metres per second squared, in the project's Y-up world. */
const GRAVITY = { x: 0, y: -9.81, z: 0 };

/**
 * Build an empty world whose solver timestep is the SAME constant the loop steps
 * on.
 *
 * The timestep is assigned from the imported `DT` and is never re-declared here.
 * If the loop and the solver each carried their own copy of the fixed-step
 * literal they could silently drift apart, and the symptom would be inconsistent
 * medal times in Phase 6 rather than anything that looks like a physics bug.
 *
 * Note that Rapier's `Real` is `f32` in the JS build, so reading `world.timestep`
 * back yields `Math.fround(DT)`, which is 0.01666666753590107 rather than the
 * f64 `DT` of 0.016666666666666666. A one-time rounding of a constant, not an
 * accumulating error, so it is invisible to determinism: the run clock stays
 * `tick * DT` and every machine rounds identically.
 */
export function createWorld(): RAPIER.World {
  const world = new RAPIER.World(GRAVITY);
  world.timestep = DT;
  return world;
}
