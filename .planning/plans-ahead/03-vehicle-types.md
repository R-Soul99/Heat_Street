# Plan 3: Vehicle types (VEH-06, VEH-07)

Read `README.md` in this folder first.

## Goal

The game has several vehicles that drive differently because their bodies,
wheels and suspension differ, not because of a speed multiplier. The existing
muscle car is untouched.

**When it is done the user sees:** `?car=buggy`, `?car=rally`, `?car=truck` and
`?car=monster` (alongside today's `rwd`, `fwd`, `awd`), each with its own
proportions on screen, its own handling, its own saved tuning, and a
`?debug` tuning panel whose sliders reach the values that vehicle needs.

## Current state

- `src/core/vehicle-class.ts`: `KNOWN_VEHICLE_CLASS_IDS = ["rwd","fwd","awd"]`,
  `VEHICLE_CLASSES` (label, colour, `frontDriveShare`, `storageKey`),
  `classDefaultTuning(id)` = `defaultTuning()` plus a few overrides.
  `resolveVehicleClassId` reads `?car=` through an allowlist.
- `src/core/feel.ts`: `shippedTuning(classId)` = class default plus
  `FEEL_DEFAULTS`. **This is what the game ships and what tests pin.**
- `src/core/vehicle-tuning.ts`: `VehicleTuning` has `chassis`, `wheels`,
  `drive`, `assists`. **One set of wheel and suspension values is shared by all
  four wheels**; only side friction is split front/rear. `TUNING_RANGES`
  clamps everything on load (`clampTuning`, `parseSavedTuning`) and drives the
  panel sliders.
- **The ranges are sized for a car.** Examples: `mass` 800 to 2600,
  `wheels.radius` 0.2 to 0.55, `maxSuspensionTravel` 0.1 to 0.6,
  `suspensionRestLength` 0.2 to 0.8, `chassis.halfExtents.y` max 1.0,
  `comOffset.y` max 0.1, `maxSuspensionForce` max 40000. A monster truck is
  outside almost all of them, and a value outside the range is silently
  clamped. This is the main structural problem this plan solves.
- `src/physics/vehicle.ts` `createVehicle(world, tuning, spawn, frontDriveShare)`:
  chassis is one cuboid from `chassis.halfExtents`; inertia from
  `boxPrincipalInertia`; four wheels added in FL, FR, RL, RR order; many
  per-tick `setWheel...` calls, several of them rear-only (the authored
  oversteer terms: handbrake, power, spin, flick, pivot, lift).
- Drive force: `wheelEngineForces(perWheelForce, frontShare)` in
  `vehicle-class.ts`; the field is still named `engineForcePerRearWheel`.
- Render: `buildCarMeshes(wheelRadius, halfTrack, halfWheelbase,
  chassisHalfExtents, colour)` in `src/render/vehicle-view.ts` already sizes
  the box and wheels from tuning, so new proportions show up for free.
- AI: `src/physics/ai-fleet.ts` builds cars with `createVehicle(world, tuning,
  pose)`; `main.ts` gives the fleet an RWD tune (`aiTuning`) whatever the
  player drives.
- Tests that pin current behaviour: `tests/determinism.test.ts`,
  `tests/vehicle*.test.ts`, `tests/feel.test.ts`, the telemetry routines in
  `src/physics/telemetry/routines.ts`, and `npm run feel-dossier`
  (a headless handling report, `scripts/feel-dossier.run.ts`).
- Open risk recorded in `CLAUDE.md`: Rapier stability with very heavy, very
  tall bodies and very large wheels is unknown. Stage 6 is a spike for that
  reason.

## Decisions

- **D1. Extend the existing class system; do not build a second one.** New ids
  are added to `KNOWN_VEHICLE_CLASS_IDS`. `rwd`, `fwd`, `awd` keep their ids,
  storage keys and behaviour.
- **D2. Per-class ranges.** Add `classTuningRanges(id)` returning
  `TUNING_RANGES` for the three existing classes and a widened copy for the
  new ones. `clampTuning` and `parseSavedTuning` take the ranges as a
  parameter, defaulting to `TUNING_RANGES` so every existing caller and test
  is unchanged.
- **D3. Per-axle suspension, added as optional overrides.** Add
  `wheels.rear?: Partial<...>` covering only `radius`,
  `suspensionRestLength`, `maxSuspensionTravel`, `suspensionStiffness`,
  `suspensionCompression`, `suspensionRelaxation`, `connectionY`. Absent means
  "same as front", so the existing car's tuning object, saved blobs and
  serialised form do not change.
- **D4. No rename of `engineForcePerRearWheel`.** It is in saved browser blobs
  and exported tuning files. Document it as "drive force per wheel of a
  two-wheel-drive axle" and leave the name.
- **D5. Vehicle roster and starting numbers.** These are starting points for
  tuning by feel, not final values. All names are generic.

  | id | Label | Drive (front share) | Mass kg | Half extents x,y,z m | Wheel radius m | Rest / travel m | Stiffness | CoM y | Top speed m/s | Character |
  |---|---|---|---|---|---|---|---|---|---|---|
  | `buggy` | Dune Buggy | RWD (0) | 750 | 0.80, 0.35, 1.60 | 0.40 | 0.70 / 0.65 | 9 | -0.15 | 38 | light, twitchy, floats over bumps |
  | `rally` | Rally Coupe | AWD (0.45) | 1250 | 0.90, 0.48, 2.10 | 0.37 | 0.60 / 0.55 | 16 | -0.25 | 46 | planted, quick to rotate on gravel |
  | `truck` | 4x4 Pickup | AWD (0.5) | 2300 | 1.00, 0.70, 2.70 | 0.50 | 0.80 / 0.70 | 12 | -0.10 | 36 | heavy, rolls, slow steering, shrugs off bumps |
  | `monster` | Monster Truck | AWD (0.5) | 4500 | 1.25, 0.90, 2.70 | 0.90 | 1.20 / 1.00 | 7 | +0.10 | 28 | huge wheels, drives over obstacles, can roll over |

  Also per vehicle: `halfTrack`/`halfWheelbase` scaled to the body; loose
  surface grip (see D6); steering lock and ramp slower for the two trucks;
  `engineForcePerRearWheel` scaled so 0-60 mph is roughly 4 s (rally), 5 s
  (buggy), 8 s (truck), 9 s (monster). Measure with the existing accel
  routine, do not guess.
- **D6. Surface grip per vehicle** is a multiplier table applied on top of the
  shared surface profiles: `surfaceGripScale: Record<SurfaceType, { forward, lateral }>`
  on the class spec, all 1.0 for existing classes. Off-road vehicles get more
  grip on `gravel`, `dirt_road`, `sand`, `mud`, `grass` and slightly less on
  `tarmac`. Read how `src/core/surface-tuning.ts` profiles reach
  `vehicle.ts` (`forwardGrip`, `lateralGrip` near lines 600 and 950) before
  choosing where to multiply.
- **D7. AI keeps driving the muscle car** in this plan. Racing AI in other
  vehicles needs the racing line's speed limits per vehicle and is a follow-up.
  **ASK:** is "player picks a vehicle, AI stays in muscle cars" acceptable for
  now? Default: yes.
- **D8. Medals are per vehicle class later, not now.** Courses keep their
  current medals (recorded for `rwd`). When the player is not in `rwd`, show
  the time but do not save a medal. Check how `main.ts` already treats `fwd`
  and `awd` for medal saving and do the same; if it saves them today, raise it
  with the user instead of changing it silently.
- **D9. Vehicle choice stays a URL parameter** plus an entry in the existing
  `?debug` map menu. A proper garage screen is out of scope.

## Stages

### Stage 0: Safety net

1. On a clean checkout of the branch point, run `npm run check` and
   `npm run feel-dossier`; save the dossier output to the scratchpad.
2. Write `tests/vehicle-rwd-golden.test.ts`: build a flat-ground world, create
   the car with `shippedTuning("rwd")`, drive a fixed 600-tick input tape
   (throttle, steer left, handbrake, brake; reuse the tape helpers in
   `tests/determinism.test.ts`), and assert the final position, rotation and
   velocity against literals recorded from the current code, to 1e-6.
   Do the same for `fwd` and `awd`.

This test must stay green, unmodified, through every later stage. If it goes
red, the stage has changed the shipped car: stop and fix the stage.

### Stage 1: Per-class ranges (D2)

Files: `src/core/vehicle-tuning.ts`, `src/core/vehicle-class.ts`,
`src/debug/tuning-panel.ts`, `src/main.ts`, tests.

1. Export the type of `TUNING_RANGES` as `TuningRanges`.
2. `clampTuning(t, ranges = TUNING_RANGES)` and
   `parseSavedTuning(raw, fallback, ranges = TUNING_RANGES)`.
3. `classTuningRanges(id)` in `vehicle-class.ts`. For now it returns
   `TUNING_RANGES` for every id.
4. Thread it through `main.ts` (the `parseSavedTuning` call near line 201) and
   the tuning panel (it builds sliders from ranges; pass the class ranges in
   through the existing `persist` options object).
5. Tests: default behaviour unchanged; a custom range clamps to its own
   bounds.

Done when: golden test green, `npm run check` green.

### Stage 2: Per-axle suspension (D3)

Files: `src/core/vehicle-tuning.ts`, `src/physics/vehicle.ts`,
`src/render/vehicle-view.ts`, `src/render/ai-vehicle-view.ts`, tests.

1. Add the optional `wheels.rear` override object and a pure helper
   `wheelParams(tuning, i)` returning the effective values for wheel `i`
   (front values for 0 and 1; front values overlaid with `rear` for 2 and 3).
2. In `vehicle.ts`, replace reads of the per-wheel fields with
   `wheelParams(t, i)` in three places: `addWheel` at creation, the live
   re-apply loop (about lines 378 to 391), and the per-tick suspension
   stiffness write (about line 559). Search for every `t.wheels.` and
   `w.` use and check each one; rear-only friction logic is not part of this.
3. Serialise and parse `rear` only when present. Range-check with the same
   ranges as the front fields.
4. `buildCarMeshes`: accept an optional rear wheel radius; default equal to
   front. Update the wheel rig so each wheel uses its own radius for roll.
5. Tests: with no `rear`, `wheelParams` returns the front values for all four;
   with `rear.radius` set, wheels 2 and 3 differ; saved blob without `rear`
   parses as before.

Done when: golden test green, `npm run check` green.

### Stage 3: Class spec carries the new data (D1, D6)

Files: `src/core/vehicle-class.ts`, `src/physics/vehicle.ts`, tests.

1. Extend `VehicleClassSpec` with `surfaceGripScale` (D6). Existing classes
   get all-ones.
2. Pass it into `createVehicle` via a new optional options object as the last
   parameter (`{ surfaceGripScale }`), so existing call sites compile
   unchanged. Apply the multiplier where surface grip is applied.
3. Tests: all-ones scale leaves the golden test green (it will, by
   construction; the point is to prove it); a 0.5 lateral scale on tarmac
   measurably lowers steady-state cornering speed in a skidpad routine.

### Stage 4: Rally coupe (the easy one first)

Files: `src/core/vehicle-class.ts`, tests.

The rally car fits inside today's ranges, so it proves the roster mechanism
before any range widening.

1. Add `"rally"` to `KNOWN_VEHICLE_CLASS_IDS`; spec with label, colour (must be
   distinct from the AI paints listed in the comment in `vehicle-class.ts`),
   `frontDriveShare` 0.45, `storageKey: "heat-street.tuning.rally.v1"`,
   `surfaceGripScale` from D6.
2. `classDefaultTuning("rally")`: start from `defaultTuning()`, set the D5
   values, then tune headlessly with the telemetry routines in
   `src/physics/telemetry/routines.ts` (accel, brake, skidpad per surface,
   handbrake, ramp, stability). Targets: 0-60 mph about 4 s; stable hands-off
   at top speed; a handbrake turn rotates the car on gravel and it pulls
   straight under power.
3. Check `tests/vehicle-class.test.ts` and any test that iterates
   `KNOWN_VEHICLE_CLASS_IDS` or `VEHICLE_CLASSES`.
4. Add the id to the `?debug` map/vehicle menu if one lists classes (search
   `src/debug/` for `KNOWN_VEHICLE_CLASS_IDS`).

Done when: `?car=rally` loads; routines report the targets; `npm run check`.

### Stage 5: Buggy

Same steps as stage 4. The buggy's mass (750) is below the `mass` minimum of
800, so this is the first use of a widened range: make `classTuningRanges`
return a copy with `mass.min` 500 for `buggy`.

Watch for: very light bodies bouncing on the landing cushion and assists that
were scaled for 1390 kg. The assists scale against the cached inertia
(`boxPrincipalInertia`); check `src/physics/vehicle-assists.ts` for any
absolute forces and report them rather than guessing. Stage 0's golden test
protects the shipped cars if you need to make a gain mass-relative.

### Stage 6: Monster truck spike (do this before the pickup)

This is the risky one. Time-box it. The question: can Rapier's raycast vehicle
hold a 4500 kg body on 0.9 m wheels with 1 m of travel without jitter,
tunnelling or exploding?

1. On a throwaway branch, widen ranges for `monster` (mass to 6000, radius to
   1.2, rest length to 1.6, travel to 1.3, `halfExtents.y` to 1.4,
   `comOffset.y` to 0.6, `maxSuspensionForce` to 200000, `halfTrack` to 1.8).
2. Headless test on flat ground and on `feel-test` terrain: settle for 5 s,
   then drive the standard routines. Record ride height stability (should
   settle within 2 s and stay within 1 cm), max tilt in a full-lock turn at
   15 m/s, behaviour off the feel-test ramps, and whether any wheel loses
   contact on flat ground.
3. Known things to check: `maxSuspensionForce` must exceed static load per
   wheel with margin (4500 kg x 9.81 / 4 is about 11 kN static, so allow 5 to
   10 times that); suspension stiffness in Rapier's raycast vehicle is
   per-unit-mass-like in effect, so re-derive it from the target static sag
   (aim for sag of 30 to 40 percent of travel) rather than copying the car's
   number; the wheel ray patch (`src/physics/wheel-ray-patch.ts`) and the
   bump-stop logic assume car-sized wheels, so read them for constants; chassis
   underside clearance (`connectionY`, rest length and radius together) must
   leave the box well clear of the ground.
4. Driving over obstacles: place a 0.6 m high box in front of it. A raycast
   wheel reads one ray at the wheel centre, so it steps up abruptly rather
   than rolling over. Measure how bad that is. If it is unacceptable, the
   mitigation is in the wheel ray patch: sample several rays across the wheel
   arc and use the highest hit. Do that only if needed and only for classes
   that opt in.
5. Write the result to `.planning/plans-ahead/03-monster-spike-result.md`:
   numbers, what worked, what did not, recommended ranges and values.

**Stop here and report to the user.** If the spike fails after the time box,
the fallback named in `CLAUDE.md` is an arcade-assist layer (extra downforce,
roll-limiting torque) on top, and only then considering Jolt. Do not start
either without the user.

### Stage 7: Pickup and monster truck

Using the spike's ranges and values:

1. Add `truck` and `monster` exactly as in stage 4, with their own widened
   ranges and storage keys.
2. Trucks roll: raise `comOffset.y` and check rollover is possible but not
   constant. Target: full-lock at 20 m/s on tarmac lifts the inside wheels;
   at 12 m/s it does not.
3. Slow steering: lower `steerRampPerSec` and `maxSteerLock`.
4. Check the helicopter camera frames a taller, longer vehicle (the camera
   tuning in `src/core/camera-tuning.ts` may need a per-class height offset;
   add it to the class spec only if the truck is visibly cropped).
5. Collisions with AI muscle cars: drive the monster into the AI field
   headlessly and check nothing is launched at absurd speed. If a 4500 kg
   body launches a 1390 kg car, cap the contact response by lowering
   restitution, not by changing masses.

### Stage 8: Gate and docs

1. `npm run check`; golden test still unmodified and green.
2. `npm run feel-dossier` for `rwd`: output identical to stage 0's saved copy.
3. `docs/vehicle-tuning-guide.md`: add a section per vehicle with its targets
   and measured numbers, and document per-class ranges and the rear override.
4. Close or update the pending todo
   `.planning/todos/pending/2026-09-20-support-configurable-drivetrain-type-per-car-class.md`.

## Human check (short, on the feel-test map)

For each of `?map=feel-test&car=buggy`, `rally`, `truck`, `monster`: one
minute of driving across the surface bands and over one ramp. Ask one
question per vehicle: "does it feel like a <buggy/rally car/pickup/monster
truck>?" Then one check of `?car=rwd` to confirm the muscle car is unchanged.
Tell the user to use a private window or clear saved tuning first (rule 7).

## Traps

- **Silent clamping.** A value outside the active ranges is clamped on load
  and by the panel. If a new vehicle "ignores" a default, check ranges first.
- **Saved tuning per class.** Each class has its own `storageKey`. A stale
  saved blob hides new defaults (rule 7).
- **Wheel index contract.** FL, FR, RL, RR = 0, 1, 2, 3 in physics, render and
  FX. Never reorder.
- **Forward is -Z and engine force is negative for forward.** See the comments
  in `vehicle.ts` and `vehicle-class.ts` before touching drive code.
- **Rear-only oversteer terms** (handbrake, power, flick, pivot, lift) assume a
  rear-drive muscle car. For AWD vehicles turn them down through tuning
  (`powerOversteerGain` and friends), as `fwd` and `awd` already do. Do not
  delete or restructure them.
- **Do not unit-test feel.** Test numbers you can measure (0-60, settle time,
  tilt angle), then ask the user to drive.
- **Mass properties.** After changing mass or half extents, inertia must be
  recomputed; `createVehicle` already tracks `lastMass`/`lastHalfExtents`.
  Follow that path rather than setting mass elsewhere.
- **The AI fleet shares the RWD tuning object with the player when the player
  is RWD.** New classes must never leak into `aiTuning`.
