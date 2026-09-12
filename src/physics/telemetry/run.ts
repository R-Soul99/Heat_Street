/**
 * The scripted-telemetry runner: executes a `Routine`
 * (`src/physics/telemetry/routines.ts`) inside an isolated, throwaway Rapier
 * world and returns its `RoutineResult`.
 *
 * TWO-RUNNER DESIGN (02-RESEARCH.md Pattern 4): this exact module is imported
 * both by `tests/vehicle-telemetry.test.ts` (against `defaultTuning()`, the
 * CI regression gate) and by the plan 02-09 browser panel (against the
 * LIVE-tuned object the panel mutates). One shared code path is what makes
 * SC5's "retuned live … and re-verified … with no code edit" literally true
 * rather than aspirational.
 *
 * SAME two-runner argument now covers surfaces (plan 03-06): `runRoutine`'s
 * optional `surfaceOpts` parameter is the one path `tests/surface-telemetry.test.ts`
 * (the SC1 CI gate) and the plan 03-07 browser panel both call — a second,
 * surface-specific runner would reintroduce exactly the drift this design
 * exists to prevent.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
import * as RAPIER from "@dimforge/rapier3d";
import type { SurfaceProfiles } from "../../core/surface-tuning";
import type { SurfaceType } from "../../core/surface-types";
import type { VehicleTuning } from "../../core/vehicle-tuning";
import { createSurfaceMap } from "../surface";
import type { SurfaceContext } from "../surface";
import { createVehicle, sampleVehicle } from "../vehicle";
import { createWorld } from "../world";
import type { Routine, RoutineResult } from "./routines";
import { ROUTINES } from "./routines";

/**
 * Ticks is 1800 = 30 s at `DT = 1/60`, sized so the longest scripted routine
 * (the airborne `ramp` routine in task 3) finishes comfortably inside it. A
 * routine whose `drive` never returns `null` is capped here rather than
 * hanging the caller (T-02-17) — `evaluate` is responsible for reporting an
 * incomplete run as a failure, not this loop.
 */
const MAX_TICKS = 1800;

/** Spawn point for every telemetry run: 1 m above the flat ground's top surface. */
const SPAWN = { x: 0, y: 1, z: 0 };

/**
 * Ground half-extents for `buildTelemetryScene`. `x: 60, y: 1, z: 600` is
 * long enough for a 0-60 run, a 60-0 braking run and a slalom at highway
 * speed without running off the end, and thick enough (>= 1 m) that a
 * 120 mph chassis's CCD (Pitfall 6) never tunnels through it.
 */
const GROUND_HALF_EXTENTS = { x: 60, y: 1, z: 600 };

/**
 * Build a flat ground cuboid for a telemetry world, top surface at world
 * y = 0. Deliberately NO ramp collider: the `ramp` routine (plan 02-07 task
 * 3) uses a SCRIPTED LAUNCH — setting the chassis's linear/angular velocity
 * directly in `setup()` — rather than driving over ramp geometry, exactly as
 * 02-RESEARCH.md Open Question 2 recommends. That lets VEH-04's auto-level
 * assist be regression-tested independently of the ramp collider that plan
 * 02-06 owns (and whose authoring the research probe itself could not get
 * working).
 *
 * Returns the created ground `Collider` so a caller can register it in a
 * `SurfaceMap` (plan 03-06). `groundFriction` is OPTIONAL: when omitted,
 * `.setFriction` is never called at all, preserving Rapier's own default and
 * this function's exact prior behaviour byte-for-byte — the control
 * `tests/surface-telemetry.test.ts` uses to settle 03-RESEARCH.md Assumption
 * A1 (whether the ground collider's own friction coefficient participates in
 * the raycast tire model at all) explicitly needs to vary this value while
 * every existing caller that never passes it keeps measuring identical
 * numbers.
 */
export function buildTelemetryScene(world: RAPIER.World, groundFriction?: number): RAPIER.Collider {
  const ground = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -GROUND_HALF_EXTENTS.y, 0),
  );
  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    GROUND_HALF_EXTENTS.x,
    GROUND_HALF_EXTENTS.y,
    GROUND_HALF_EXTENTS.z,
  );
  if (groundFriction !== undefined) {
    colliderDesc.setFriction(groundFriction);
  }
  return world.createCollider(colliderDesc, ground);
}

/**
 * Optional surface context for a telemetry run (plan 03-06). When supplied,
 * `runRoutine` builds a fresh `SurfaceMap`, registers the run's own ground
 * collider as `surface`, and drives every `vehicle.tick` call with it. When
 * omitted, the run is byte-for-byte identical to the pre-03-06 loop.
 */
export interface SurfaceRunOpts {
  readonly surface: SurfaceType;
  readonly profiles: SurfaceProfiles;
  /** Ground-collider friction passed straight to `buildTelemetryScene` — the
   * A1 control's only knob (03-RESEARCH.md Open Question 1). */
  readonly groundFriction?: number;
}

/**
 * Execute one `Routine` against `tuning` inside a fresh, throwaway world and
 * return its `RoutineResult`. Always builds its OWN `createWorld()` — never
 * the live game world (T-02-18) — so a telemetry run can never perturb a
 * future medal time.
 */
export function runRoutine(
  routine: Routine,
  tuning: VehicleTuning,
  surfaceOpts?: SurfaceRunOpts,
): RoutineResult {
  const world = createWorld();
  try {
    const ground = buildTelemetryScene(world, surfaceOpts?.groundFriction);
    const vehicle = createVehicle(world, tuning, SPAWN);
    routine.setup?.(vehicle);

    // The surface map and its single registration are created INSIDE this
    // try block so they die with the throwaway world — nothing about a
    // telemetry run may outlive it (T-03-18).
    let surfaces: SurfaceContext | undefined;
    if (surfaceOpts) {
      const map = createSurfaceMap();
      map.register(ground.handle, surfaceOpts.surface);
      surfaces = { map, profiles: surfaceOpts.profiles };
    }

    const acc: Record<string, number> = {};
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const s = sampleVehicle(vehicle);
      const frame = routine.drive(tick, s);
      if (frame === null) {
        break;
      }
      // When `surfaces` is absent this call is byte-for-byte what it was
      // before 03-06 — `vehicle.tick(frame, tuning)` with no third argument
      // — rather than an equivalent-but-different `vehicle.tick(frame,
      // tuning, undefined)` call (T-03-09).
      if (surfaces) {
        vehicle.tick(frame, tuning, surfaces);
      } else {
        vehicle.tick(frame, tuning);
      }
      world.step();
      routine.sample(tick, sampleVehicle(vehicle), acc);
    }
    return routine.evaluate(acc);
  } finally {
    // T-02-06 / Pitfall 13: `world.free()` releases the world's bodies and
    // colliders too, so a THROWING routine can never leak a WASM world. Each
    // `new RAPIER.World()` allocates in WASM linear memory that JS garbage
    // collection does not reclaim — a ~30-routine browser tuning session
    // would otherwise hold 30 live worlds against the 4 GB ceiling.
    world.free();
  }
}

/**
 * Run every routine in `ROUTINES`, in order, against `tuning` and return the
 * results array. `Vehicle`/tuning objects never survive past the routine
 * that used them — each entry gets its own fresh `runRoutine` call and thus
 * its own fresh world.
 *
 * [MEASURED] (02-RESEARCH.md Pattern 4): a four-config sweep of ~4 000 ticks
 * completed in 47 ms and a 24-config sweep of ~30 000 ticks in 163 ms, so
 * this six-routine suite is roughly 100-300 ms — runnable synchronously
 * behind a keypress in the plan 02-09 browser panel, no spinner required.
 */
export function runAllRoutines(tuning: VehicleTuning): RoutineResult[] {
  return ROUTINES.map((routine) => runRoutine(routine, tuning));
}
