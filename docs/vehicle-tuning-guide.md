# Vehicle Tuning Guide

This is the explainer for the live `?debug` tuning panel: what every control does, its
live-panel range, and — the part that matters — how it interacts with the other controls.
The panel exposes 72 numeric controls across eight folders plus the Telemetry pointer and
the Export/Import/Reset root controls; this document covers all of them.

**This file and `src/debug/tuning-panel.ts` are mirrors of each other.**
`tests/tuning-guide-sync.test.ts` extracts every control identifier the panel actually
binds and asserts each one is named here. Add a control to the panel, add it here too, or
the build goes red.

SOURCE DISCIPLINE: every non-obvious claim below carries a file-and-field citation back to
the doc comment it is mined from — `[MEASURED]` means it was actually driven and recorded,
`[TUNED]` means a feel-session correction to a measured baseline, `[ASSUMED]` means a
starting point nobody has swept yet. This document does not invent numbers; it launders
nothing.

## 1. How to open it

- Load the game with `?debug` on the URL. This is the single gate
  (`src/debug/debug-gate.ts`'s `DEBUG_ENABLED`) that decides whether ANY debug tooling —
  this panel, the telemetry HUD, the profiler HUD, the nav pointer — is constructed at
  all. Without it, none of this exists in the built page.
- Press `G` to show/hide the tuning panel (`TuningPanel.toggle()`,
  `src/debug/tuning-panel.ts`). It starts hidden.
- Press `T` for the separate telemetry RESULTS panel (`src/debug/telemetry-hud.ts`). The
  Telemetry folder inside the tuning panel itself is just a disabled pointer control
  reading "Press T for telemetry results" — it holds a fixed slot in the folder order but
  carries no sliders of its own.
- "Reset to defaults" is a two-click confirm, no modal dialog (the project is explicitly
  hostile to confirmation dialogs, NAV-07). First click renames the control to "Click
  again to confirm" for 3000 ms (`RESET_CONFIRM_MS`); a second click inside that window
  writes every leaf of `defaultTuning()`/`defaultSurfaceProfiles()`/`defaultCameraTuning()`
  back onto the live objects, clears all three `localStorage` keys, and re-applies.
- "Export tuning to file" downloads a pretty-printed JSON snapshot of the CURRENT live
  values of all three tuning domains (vehicle, surfaces, camera) —
  `heat-street-tuning-YYYYMMDD-HHMMSS.json` — built by
  `serializeTuningSnapshot` (`src/core/tuning-snapshot.ts`).
- "Import tuning from file" opens the native file picker and re-applies a previously
  exported file: every slider snaps to the imported values and physics, surfaces and
  camera are all re-applied. Import routes every byte read back from the file through
  `parseTuningSnapshot` rather than a direct `JSON.parse` — an imported file is untrusted
  input on exactly the same footing as the `localStorage` blob this panel already guards.
  **A failed import (not valid JSON, wrong `kind`, or an envelope carrying none of the
  three domains) changes NOTHING and reports through the control's own label** ("Import
  failed — file invalid", shown for 3000 ms then reverted) — never an `alert()`, never a
  thrown exception. An import carrying only one or two of the three domains applies only
  those and leaves the others untouched, mirroring the shipped three-independent-
  `localStorage`-keys rationale (`src/debug/tuning-panel.ts`'s D-17 comment).

## 2. How a value reaches the tyres

The composition chain, end to end, in the order `src/physics/vehicle.ts` actually runs it
(lines ~296-387 as of this writing):

1. **Per-wheel surface lookup (step 0).** For each of the four wheels, `wheelGroundObject`
   returns the collider the wheel is standing on this tick, mapped to a `SurfaceType`.
   Each surface has a `SurfaceProfile` (`forwardGrip`, `lateralGrip`) from the Surfaces
   folder. This reflects the PREVIOUS tick's raycast — a one-tick (~16.6 ms) lag between
   crossing a surface boundary and the new friction values taking effect, intentional and
   accepted (`src/physics/vehicle.ts`'s own comment there).
2. **Front axle, written immediately:**
   `setWheelFrictionSlip(i, wheels.frictionSlip * profile.forwardGrip)` and
   `setWheelSideFrictionStiffness(i, wheels.frontSideFriction * profile.lateralGrip)` for
   the two front wheels. The base `VehicleTuning` value is multiplied by the per-surface
   grip — the surface SCALES the base value, it never replaces it.
3. **Rear axle, captured now but WRITTEN LATER (step 4).** The rear wheels' `lateralGrip`
   multipliers are captured into a local `rearLateralGrip` array in step 0, but the actual
   `setWheelSideFrictionStiffness` call for the rear wheels happens in a separate, later
   step — because the rear side-friction VALUE itself depends on throttle/steer/handbrake
   state that is not known until step 4 runs. With no surface data at all,
   `rearLateralGrip` stays at its `[1, 1]` initialiser, so the whole Phase 2 (pre-surface)
   behaviour is byte-identical when surfaces are absent.
4. **Rear side friction: handbrake, or the authored throttle-oversteer term.** This is
   where `rearSideFriction`, `powerOversteerGain` and `handbrakeRearSideFriction` compose:
   ```
   rearSfs = handbrake
     ? handbrakeRearSideFriction
     : lerp(rearSideFriction, handbrakeRearSideFriction,
            clamp(powerOversteerGain * throttle * |steer|, 0, 1))
   setWheelSideFrictionStiffness(RL, rearSfs * rearLateralGrip[0])
   setWheelSideFrictionStiffness(RR, rearSfs * rearLateralGrip[1])
   ```
   The surface's `lateralGrip` multiplier SCALES this already-blended value — it is
   COMPOSITION, not replacement. Step 2 deliberately does not write the rear wheels' side
   friction at all, specifically so this step's blend is the only writer and the surface
   effect is never silently discarded on the two wheels the oversteer feel depends on.
5. **`vc.updateVehicle(DT)` solves the vehicle** — suspension and tire impulses are
   written onto the chassis body using the values set in steps 1-4. Every fresh per-wheel
   telemetry read (`wheelIsInContact`, slip impulses, etc.) is only valid AFTER this call.

## 3. Per-folder control reference

Folder order is a contract, exactly as the panel enforces it: Chassis, Suspension, Grip,
Drive, Assists, Telemetry, Surfaces, Camera (with Camera's own sub-folders: Framing,
Damping, Heading, Occlusion, Chase fallback).

### Chassis

`mass`, `comOffset.x`/`comOffset.y`/`comOffset.z`, and `halfExtents.x`/`halfExtents.y`/
`halfExtents.z` bind on drag-RELEASE only (`.onFinishChange`), never live
(`.onChange`) — every other control in this folder and every control in every folder
below it applies live. This is Pitfall 10: Rapier's `setAdditionalMassProperties`
OVERRIDES ALL previous additional mass properties and invalidates the cached principal
inertia the assists scale against, so a slider DRAG through this call mid-motion would
produce discontinuities or a launched car. Only a drag-release (or an input blur) should
trigger the rebuild. (`src/debug/tuning-panel.ts`, Chassis section comment.)

| Control | Range (min/max/step) | Default | What it does | Interacts with |
|---|---|---|---|---|
| `mass` | 800 / 2600 / 10 | 1390 | Kilograms. Scales every impulse the vehicle controller applies. Drag-release only (Pitfall 10). `[TUNED live, 260920-sm2]`: corrected from 1600 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). | All engine force, brake, and assist gains were originally tuned against the earlier 1600 kg mass; see the interaction deep-dive below for the revised static-load arithmetic. |
| `comOffset.x` | -0.3 / 0.3 / 0.01 | 0 | Centre-of-mass X offset, metres. Drag-release only. | `bodyRollGain`, `autoLevelGain` — an off-centre CoM changes the assists' effective lever arm. |
| `comOffset.y` | -0.5 / 0.1 / 0.01 | -0.25 | Centre-of-mass Y (vertical) offset, metres. Drag-release only. `[TUNED live, 260920-sm2]`: corrected from -0.15 (lower CoM) via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). | Lower values (more negative) lower the CoM, the single biggest lever on the "weighty muscle car" feel per the stack research. |
| `comOffset.z` | -0.5 / 0.5 / 0.01 | 0 | Centre-of-mass Z offset, metres. Drag-release only. | Rearward bias here compounds with `rearSideFriction`'s own RWD-loose bias. |
| `halfExtents.x` | 0.5 / 1.5 / 0.01 | 0.95 | Chassis collider half-width, metres. Drag-release only. | Track width relative to `wheels.halfTrack`. |
| `halfExtents.y` | 0.2 / 1.0 / 0.01 | 0.5 | Chassis collider half-height, metres. Drag-release only. | Affects `bodyRollMaxDeg`'s visual read at the same angle — a taller car looks more tilted at the same roll angle. |
| `halfExtents.z` | 1.5 / 3.0 / 0.01 | 2.35 | Chassis collider half-length, metres. Drag-release only. | Wheelbase relative to `wheels.halfWheelbase`. |
| `linearDamping` | 0 / 0.5 / 0.01 | 0.03 | Linear velocity damping, per second. Live. | Higher values bleed speed passively — interacts with top speed reached under `engineForcePerRearWheel`. |
| `angularDamping` | 0 / 2 / 0.01 | 0.3 | Angular velocity damping, per second. Live. | Higher values damp the spin that `bodyRollGain`/`autoLevelGain`/`slideCatchGain` all fight. |

### Suspension

All ten controls bind live (`.onChange`) — Rapier's per-index wheel setters are genuinely
per-frame safe, unlike `setAdditionalMassProperties` above (`src/debug/tuning-panel.ts`).

| Control | Range (min/max/step) | Default | What it does | Interacts with |
|---|---|---|---|---|
| `halfTrack` | 0.5 / 1.3 / 0.01 | 0.85 | Half the left-right wheel spacing, metres. | `chassis.halfExtents.x` — should stay roughly proportional for a plausible silhouette. |
| `halfWheelbase` | 1.0 / 2.2 / 0.01 | 1.55 | Half the front-rear wheel spacing, metres. | `chassis.halfExtents.z`. |
| `connectionY` | -0.6 / 0 / 0.01 | -0.3 | Wheel connection point Y offset from the chassis origin, metres. | `suspensionRestLength` — together they set ride height. |
| `radius` | 0.2 / 0.55 / 0.01 | 0.36 | Wheel radius, metres. | Visual wheel rig scale; ground clearance. |
| `suspensionRestLength` | 0.2 / 0.8 / 0.01 | 0.45 | Suspension rest length, metres. Longer values give more visible 70s-era body roll and dive, per the stack research direction. | `bodyRollGain` — a longer rest length gives the roll assist more room to be visually legible. |
| `maxSuspensionTravel` | 0.1 / 0.6 / 0.01 | 0.3 | Maximum suspension travel, metres. Rapier's own default is 5.0 metres — a Bullet-scale leftover — and MUST be set explicitly here or the suspension effectively never bottoms out (`src/core/vehicle-tuning.ts`, Pitfall 5 citation). | `maxSuspensionForce` — travel and force ceiling together define landing behaviour. |
| `suspensionStiffness` | 6 / 40 / 0.5 | 14 | Suspension spring stiffness, mass-normalised by Rapier's own solver. Lower values give more visible weight transfer and dive under braking, per the stack research direction. | `suspensionCompression`/`suspensionRelaxation` damping ratios. |
| `suspensionCompression` | 0.2 / 4 / 0.05 | 1.3 | Suspension compression damping ratio. | `suspensionStiffness`. |
| `suspensionRelaxation` | 0.2 / 4 / 0.05 | 1.4 | Suspension relaxation (rebound) damping ratio. | `suspensionStiffness`. |
| `maxSuspensionForce` | 5000 / 40000 / 500 | 20000 | Maximum suspension force, newtons. Rapier's default (6000 N) clips a 1600 kg car whose static per-wheel load is already 3924 N; 20000 N is roughly 5x static load, leaving headroom for landings and weight transfer (`src/core/vehicle-tuning.ts`, Pitfall 4 citation). `[TUNED live, 260920-sm2]` note: shipped mass is now 1390 kg (static per-wheel load ~3409 N), so the unchanged 20000 N ceiling is now roughly 5.9x static load rather than 5x — more headroom, not less. | `chassis.mass` — static load scales with mass. |

### Grip

| Control | Range (min/max/step) | Default | What it does | Interacts with |
|---|---|---|---|---|
| `frictionSlip` | 0.4 / 3 / 0.05 | 1.2 | Friction-circle radius multiplier, applied to BOTH axes. `[MEASURED]` (`src/core/vehicle-tuning.ts`): this dial is DEAD above ~10 — Rapier's default 10.5 and the three.js example's 1000.0 produced numerically identical skidpad results (3.48 g vs 3.49 g). The useful band is 0.6-2.0: 0.6 -> 0.52 g (sloppy, washes out), 1.0 -> 0.84 g (period-correct muscle car), 1.5 -> 1.25 g (modern sports car). This is why the range is bounded to 0.4-3, not a naive 0-1000 that would waste the whole slider on a dead zone. | The shared friction-circle CEILING both `frontSideFriction` and the rear blend are clamped against — see the interaction deep-dive below. |
| `frontSideFriction` | 0.2 / 1.5 / 0.01 | 1.21 | Front-axle lateral grip multiplier, applied before the friction-circle clamp. `[TUNED live, 260920-sm2]`: corrected from 1.0 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). | `rearSideFriction` — the balance between the two is the RWD-loose bias dial (deep-dive below). |
| `rearSideFriction` | 0 / 0.3 / 0.005 | 0.2 | Rear-axle lateral grip multiplier — the PERMANENT RWD-loose bias, independent of the handbrake. `[MEASURED]` (`src/core/vehicle-tuning.ts`): 1.0 -> 0.9deg of slip at 45 mph/0.3 rad steer, 0.12 -> 2.2deg, 0.06 -> 6.5deg (looser). The useful range for this style of dial sits in a narrow band near zero, which is why the range stays 0-0.3, not a naive 0-1 (Pitfall 14). `[TUNED]` in the plan 02-10 feel session: raised 0.12 -> 0.2 after sustained full-throttle straight-line driving spontaneously spun the car at ~89 mph at the old value — see the deep-dive below for the full onset-speed sweep. | `powerOversteerGain`, `handbrakeRearSideFriction` — see the deep-dive below. |

### Drive

| Control | Range (min/max/step) | Default | What it does | Interacts with |
|---|---|---|---|---|
| `engineForcePerRearWheel` | 1000 / 10000 / 100 | 4800 | Engine force applied to each rear wheel at full throttle, newtons. `[MEASURED]` (`src/core/vehicle-tuning.ts`, plan 02-07): 3650 N measured 6.52s 0-60mph against the then-shipped vehicle/assist code, centred in the locked 6.0-7.0s band. `[TUNED live, 260920-sm2]`: corrected from 3650 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). Re-measured at the new default (and the new 1390 kg mass, also from this session): 4.15s 0-60mph — OUTSIDE the D-14 6.0-7.0s band. This is reported as a finding, not silently re-anchored; see STATE.md for the open follow-up. | `frictionSlip`'s friction-circle clamp — see "why raising engine force alone cannot produce oversteer" below. |
| `brakeImpulsePerWheel` | 10 / 150 / 1 | 60 | Brake impulse applied to each wheel at full brake, newton-seconds. | Zeroed automatically while `engineForce` is non-zero (Rapier's own solver quirk) and while reversing. |
| `maxSteerLock` | 0.2 / 1.2 / 0.01 | π/4 ≈ 0.785 | Maximum steering angle at the front wheels, radians. | `steerRampPerSec`/`steerReturnPerSec` govern how fast this angle is reached. |
| `steerRampPerSec` | 0.5 / 8 / 0.1 | 2.5 | Steering ramp-IN rate while steer input is held, radians per second. | `maxSteerLock`. |
| `steerReturnPerSec` | 0.5 / 10 / 0.1 | 4.0 | Steering ramp-OUT (return to centre) rate, radians per second. | `maxSteerLock`. |
| `handbrakeRearSideFriction` | 0 / 0.05 / 0.001 | 0.005 | Rear-axle lateral grip multiplier WHILE THE HANDBRAKE IS HELD. `[MEASURED]` (`src/core/vehicle-tuning.ts`): the entire useful range is 0.004-0.04 — a 10x span inside the bottom 4% of a naive 0-1 slider (Pitfall 14). 0.04 -> a 12deg slide (mild); 0.01 -> a 34-66deg recoverable Bullitt/Dukes-style slide (the previous default); 0.0 -> the car spins out uncontrollably rather than sliding. `[TUNED live, 260920-sm2]`: corrected from 0.01 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature) — the developer wanted a bigger handbrake kick-out. 0.005 stays inside the documented 0.004-0.04 useful band and above the 0.0 spin-out floor. | `rearSideFriction` (the lerp target), `powerOversteerGain` (the lerp driver), `slideCatchGain` — see the deep-dive below. |
| `powerOversteerGain` | 0 / 2 / 0.05 | 1.1 | Authored throttle-oversteer gain. `[MEASURED]` (`src/core/vehicle-tuning.ts`): power oversteer does NOT emerge from tuning alone — the friction-circle clamp scales the side impulse down proportionally rather than releasing it, so no engine force at any magnitude broke the rear loose in testing. This gain blends `rearSideFriction` toward `handbrakeRearSideFriction` as a function of throttle and steer angle, authoring the effect directly. `[TUNED]` in plan 02-10: 0.5 and 1.0 produced no oversteer at full throttle+lock, 1.3 spun a full doughnut; 1.1 is the controllable, readable step-out. | `rearSideFriction`, `handbrakeRearSideFriction` — see the deep-dive below. |
| `reverseEngineForcePerRearWheel` | 0 / 6000 / 50 | 1500 | `[ASSUMED]` (`src/core/vehicle-tuning.ts`, quick task 260913-epf): reverse engine force per rear wheel, newtons. A starting value, not swept — roughly 40% of `engineForcePerRearWheel`'s default, on the reasoning that reverse gear is materially lower-geared than any forward gear. | `reverseEngageSpeedMs`. |
| `reverseEngageSpeedMs` | 0 / 1 / 0.01 | 0.1 | `[ASSUMED]` (`src/core/vehicle-tuning.ts`): the forward-speed threshold below which holding brake engages reverse instead of braking, m/s. Deliberately below `STOP_SPEED_MS` (0.15) so the 60-0 braking telemetry routine provably terminates before reverse can engage. | The 60-0 braking telemetry routine's own stop condition — do not raise this above 0.15 without re-checking that routine. |

### Assists

| Control | Range (min/max/step) | Default | What it does | Interacts with |
|---|---|---|---|---|
| `autoLevelGain` | 0 / 2 / 0.05 | 0.4 | In-air auto-level torque gain, applied ONLY while zero wheels are grounded. `[MEASURED]` (`src/core/vehicle-tuning.ts`, D-07): LOAD-BEARING, not decoration — without it a 120mph ramp launch with an off-axis spin tumbles to 127deg of tilt and lands inverted EVERY TIME; with gain 0.4 it lands at ~21deg and settles under 5deg within a second. | `bodyRollGain` — mutually exclusive by construction, see the deep-dive below. |
| `autoLevelDamping` | 0 / 2 / 0.05 | 0.6 | Auto-level angular-rate damping term, as a multiple of the gain. | `autoLevelGain`. |
| `bodyRollGain` | 0 / 0.15 / 0.005 | 0.075 | Body-roll assist torque gain, applied only while >=3 wheels are grounded and current roll is under `bodyRollMaxDeg`. `[MEASURED]` (`src/core/vehicle-tuning.ts`, D-06): Rapier hardcodes `roll_influence = 0.1` and does not expose it to JS, so lateral tire forces alone produce almost no roll moment (~1.5-2deg at 0.85g, versus a real car's 4-6deg). This is an OPEN-LOOP torque, not closed-loop — POSITIVE FEEDBACK: gain 0.10 -> ~5.5deg (Bullitt range) at the research probe conditions, gain 0.20 -> the car FLIPS ONTO ITS ROOF. `[TUNED]` three times: plan 02-07 lowered it to 0.08 after the handbrake routine's own 34deg slide reached 15.40deg of tilt (over the CI gate's 15deg cutoff); plan 02-10 raised it back to 0.12 for the Bullitt-anchor feel, re-verified under the same CI gate (5.42deg max, well under 15). `[TUNED live, 260920-sm2]`: lowered further to 0.075 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature) — BELOW plan 02-07's own 0.08. Re-verified under the same CI gate at the new baseline (new mass/engine-force/friction values too): worst measured tilt across the six canonical routines is 9.84deg (`ramp`), still comfortably under the 15deg cutoff. | `bodyRollMaxDeg` (the runaway cutoff), `autoLevelGain` (mutually exclusive) — see the deep-dive below. |
| `bodyRollDamping` | 0 / 3 / 0.05 | 1.2 | Body-roll rate damping term, as a multiple of the gain. | `bodyRollGain`. |
| `bodyRollMaxDeg` | 0 / 25 / 1 | 15 | Hard cutoff, degrees: the body-roll assist is disabled once the chassis has rolled past this angle in either direction. Required BECAUSE `bodyRollGain` is positive feedback, not a decoration. | `tests/vehicle-telemetry.test.ts`'s "roll assist stability" gate asserts no scripted routine ever exceeds this. |
| `slideCatchGain` | 0 / 0.6 / 0.02 | 0.1 | Slide-catch yaw assist gain, nudging yaw rate back toward zero slip angle. `[MEASURED]` (`src/core/vehicle-tuning.ts`, D-03): at the recommended handbrake tuning this assist is NEAR-INERT ON ITS OWN — restoring `rearSideFriction` on handbrake release, not this torque, is what actually catches the slide. `[TUNED]` in plan 02-10: raising it further to 0.3 during the straight-line-instability diagnosis made an UNRELATED high-speed spin trigger EARLIER, not later, so 0.3 was rejected and 0.12 kept. `[TUNED live, 260920-sm2]`: minor adjustment down to 0.1 alongside the other session changes, via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). | `rearSideFriction`, `handbrakeRearSideFriction` — see the deep-dive below. |
| `slideCatchDamping` | 0 / 2 / 0.05 | 0.35 | Slide-catch yaw-rate damping term, as a multiple of the gain. | `slideCatchGain`. |
| `downforcePerSpeed2` | 0 / 40 / 0.5 | 0 | Speed-scaled downforce impulse coefficient (`impulse = gain * groundSpeed^2`). `[MEASURED]` (`src/core/vehicle-tuning.ts`, D-08): DEFAULT IS DELIBERATELY ZERO — full steering lock at both 60mph and 110mph produced no more than 1.5deg of tilt at every `frictionSlip` tested on flat ground, so the rollover risk D-08 anticipated does not exist there. Retained for Phase 3/4 surfaces and uneven terrain, where the risk may reappear. | Uneven off-road terrain (not yet exercised by any CI gate). |

### Telemetry

A single disabled pointer control, `"Press T for telemetry results"` — a reserved slot in
the fixed folder order, not a duplicate control set. The actual telemetry RESULTS live in
their own DOM panel (`src/debug/telemetry-hud.ts`, `KeyT`).

### Surfaces

Twelve controls: `forwardGrip` + `lateralGrip` per `SURFACE_TYPES` entry (`tarmac`,
`gravel`, `dirt_road`, `grass`, `sand`, `mud`), named `"{surface} fwd"` / `"{surface} lat"`
so both the surface and the axis stay visible inside the panel's 320px width. All twelve
bind live (`.onChange`) — none of them invalidates cached mass properties the way
`chassis.mass` does, so Pitfall 10's drag-release restriction does not apply here. Every
surface leaf shares the same range: 0.2 / 1.2 / 0.01 — the floor is 0.2 (never 0) because
D-04 rules out a surface that can bog the car down entirely, and the ceiling sits above
1.0 so a feel session can try a grippier-than-tarmac surface without a code edit
(`src/core/surface-tuning.ts`).

| Surface | forwardGrip default | lateralGrip default | Provenance |
|---|---|---|---|
| `tarmac fwd` / `tarmac lat` | 1.0 | 1.0 | Baseline — matches the pre-surfaces tuned default exactly, so tarmac driving is byte-for-byte unchanged from Phase 2. |
| `gravel fwd` / `gravel lat` | 0.75 | 0.6 | forwardGrip `[CITED: hpwizard.com/tire-friction-coefficient.html]` (~0.67 real-world mu ratio to asphalt). lateralGrip `[TUNED]` in plan 03-12: corrected 0.55 -> 0.6 after the handbrake/power-oversteer slide read as merely "somewhat loose" rather than the dramatic Dukes-of-Hazzard break-loose D-05 requires. |
| `dirt_road fwd` / `dirt_road lat` | 0.78 | 0.5 | forwardGrip `[CITED: hpwizard.com/tire-friction-coefficient.html]` (~0.76-0.85). lateralGrip `[TUNED]` in plan 03-12: corrected 0.55 -> 0.5, deliberately looser than gravel's own retune rather than sharing one identical number. |
| `grass fwd` / `grass lat` | 0.55 | 0.6 | `[ASSUMED]` (`src/core/surface-tuning.ts`) — grass reads as "washes out" more than "slides" in driving games generally, hence lateralGrip is not pushed as low as gravel/dirt_road despite the lower forwardGrip. |
| `sand fwd` / `sand lat` | 0.45 | 0.55 | `[ASSUMED]` — loose sand's real rolling resistance suggests heavy forward drag; D-04 requires "noticeably slippery but controllable," so forwardGrip is cut without bogging the car down. |
| `mud fwd` / `mud lat` | 0.4 | 0.5 | `[ASSUMED]` — the loosest surface per D-04's explicit ranking, floored well above zero so the car never becomes genuinely undriveable. |

### Camera

Twenty-one controls, grouped into five sub-folders in their own fixed order: Framing,
Damping, Heading, Occlusion, Chase fallback. All bind live (`.onChange`) — the rig
re-reads its `CameraTuning` object by reference every `update(dtMs)`.

#### Framing

| Control | Range (min/max/step) | Default | What it does |
|---|---|---|---|
| `lowSpeedMs` | 0 / 80 / 0.5 | 8.94 (20mph) | Below this speed, framing holds at its `low*` values. `[ASSUMED]`. |
| `highSpeedMs` | 0 / 80 / 0.5 | 53.64 (120mph) | At or above this speed, framing holds at its `high*` values. Aligned to the speedometer's own 120mph amber (`REDLINE_MPH`) transition. `[ASSUMED]`. |
| `lowAltitudeM` | 3 / 120 / 0.5 | 45 | Camera height above the target at `lowSpeedMs`, metres. `[ASSUMED]`. |
| `lowDistanceM` | 3 / 80 / 0.5 | 8 | Camera follow distance at `lowSpeedMs`, metres. `[ASSUMED]`. |
| `lowFovDeg` | 25 / 100 / 1 | 48 | Vertical FOV at `lowSpeedMs`, degrees. `[ASSUMED]`. |
| `highAltitudeM` | 3 / 120 / 0.5 | 90 | Camera height above the target at `highSpeedMs`, metres. `[ASSUMED]`. |
| `highDistanceM` | 3 / 80 / 0.5 | 16 | Camera follow distance at `highSpeedMs`, metres. `[ASSUMED]`. |
| `highFovDeg` | 25 / 100 / 1 | 62 | Vertical FOV at `highSpeedMs`, degrees. `[ASSUMED]`. Together with the seven leaves above, this gives a constant ~79.9deg geometric pitch (`atan(altitudeM/distanceM)`) across the ENTIRE speed range — `lowAltitudeM`/`lowDistanceM` and `highAltitudeM`/`highDistanceM` are exact multiples of the same 45:8 ratio, deliberately, so linear interpolation never drifts the pitch. This is the near-overhead "news helicopter" framing (`src/core/camera-tuning.ts`). |

#### Damping

| Control | Range (min/max/step) | Default | What it does |
|---|---|---|---|
| `positionLambda` | 0.2 / 20 / 0.1 | 3.3 | `THREE.MathUtils.damp` lambda for camera position, per second. `[TUNED live, 260920-sm2]`: corrected from the previous `[ASSUMED]` default of 6.0 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). Lower means the rig follows the car more loosely. |
| `headingLambda` | 0.2 / 20 / 0.1 | 4.5 | Slerp lambda for the camera's heading lag — the literal implementation of D-11: "like a real chopper pilot tracking a car, not a rigid instant lock" (`src/core/camera-tuning.ts`). `[TUNED live, 260920-sm2]`: corrected from the previous `[ASSUMED]` default of 2.5 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). Higher narrows (but does not erase) D-11's deliberate chopper-pilot lag. |
| `framingLambda` | 0.2 / 20 / 0.1 | 1.9 | `THREE.MathUtils.damp` lambda for altitude/distance/FOV, per second. `[TUNED live, 260920-sm2]`: corrected from the previous `[ASSUMED]` default of 1.5 via the developer's own hand-tuning session through the `?debug` panel (exported via quick task 260920-l94's Export feature). |

#### Heading

| Control | Range (min/max/step) | Default | What it does |
|---|---|---|---|
| `blendSpeedMs` | 0.1 / 10 / 0.1 | 1.5 | Passed straight through to `blendedHeadingRad`'s own `blendSpeedMs` parameter, m/s. `[ASSUMED]`. |

#### Occlusion

| Control | Range (min/max/step) | Default | What it does |
|---|---|---|---|
| `nearTargetMarginM` | 0 / 10 / 0.1 | 2.0 | `classifyOcclusion`'s near-target margin, metres. `[ASSUMED]`. |
| `fadeFloorOpacity` | 0.05 / 0.6 / 0.01 | 0.15 | The low-but-non-zero opacity floor an occluded building fades to — a fully-invisible building removes spatial context. The 0.05 floor is strictly greater than zero because a zero floor here is a Denial of Service, not merely an unhelpful tuning value (`src/core/camera-tuning.ts`, T-03-11). `[ASSUMED]`. |
| `fadeLambda` | 0.2 / 20 / 0.1 | 8.0 | Damping lambda for the fade-opacity mitigation, per second. Strictly greater than zero for the same DoS reason as `fadeFloorOpacity`. `[ASSUMED]`. |
| `basePitchDeg` | 10 / 89 / 1 | 80 | The rig's baseline (non-steepened) pitch, degrees. Kept aligned to Framing's own geometric pitch (~79.9deg) — a few tenths of a degree of drift is expected and negligible. `[ASSUMED]`. |
| `maxPitchDeg` | 10 / 89 / 1 | 88 | The steepen mitigation's near-overhead pitch ceiling, degrees. Must stay above `basePitchDeg`. `[ASSUMED]`. |
| `fanRayCount` | 1 / 9 / 1 | 5 | Number of rays in the steepen mitigation's occlusion-density fan. `[ASSUMED]`. |

#### Chase fallback

| Control | Range (min/max/step) | Default | What it does |
|---|---|---|---|
| `altitudeM` | 3 / 80 / 0.5 | 8 | D-12's fallback rig's fixed altitude above the target, metres. MUST MATCH `src/main.ts`'s `CHASE_OFFSET.y`, so selecting the fallback reproduces the exact view plan 02-10's feel session was signed off through. |
| `distanceM` | 3 / 80 / 0.5 | 16 | D-12's fallback rig's fixed distance behind the target, metres. MUST MATCH `src/main.ts`'s `CHASE_OFFSET`. |
| `fovDeg` | 25 / 100 / 1 | 55 | D-12's fallback rig's fixed FOV, degrees. MUST MATCH `src/render/renderer.ts`'s `FOV_DEG`. |

`chaseFallback` is deliberately NOT kept in sync with the permanent helicopter rig above —
it exists to reproduce the Phase 2 feel-session view byte-for-byte, not to match the
permanent rig's near-overhead angle.

## 4. Interaction deep-dives

### `rearSideFriction` vs `powerOversteerGain` vs `handbrakeRearSideFriction`

These three compose in one lerp (see section 2, step 4):
`rearSfs = lerp(rearSideFriction, handbrakeRearSideFriction, clamp(powerOversteerGain *
throttle * |steer|, 0, 1))`, replaced outright by `handbrakeRearSideFriction` while the
handbrake is held.

`powerOversteerGain` is exactly INERT at zero steering input — its lerp factor is
`gain * throttle * |steer|`, which is precisely 0 when `steer` is 0 regardless of
throttle or gain. This means `rearSideFriction` ALONE governs straight-line high-speed
stability; `powerOversteerGain` cannot rescue (or worsen) a straight-line spin, because it
literally cannot activate without steering input.

This is exactly what plan 02-10 found the hard way: at `rearSideFriction = 0.12`,
sustained full-throttle straight-line driving with ZERO steering input spontaneously spun
the car out at ~89 mph — reproduced headlessly with every assist disabled, and confirmed
NOT purely speed-dependent (coasting at zero throttle is stable at every speed up to
120 mph; only sustained throttle triggers it). The measured onset-speed sweep at full
throttle: 0.06 -> 67 mph, 0.12 -> 89 mph, 0.2 -> 128 mph, 0.3 -> stable through a full 20
second / 1200-tick run. The shipped default (0.2) was chosen to sit comfortably above
realistic sustained-chase speeds. Raising `rearSideFriction` does NOT blunt the deliberate
full-lock power-oversteer move: at full throttle + full steer, `powerOversteerGain`
already drives the lerp factor to 1 regardless of the baseline, so only
`handbrakeRearSideFriction` matters there.

### `frictionSlip` as the shared friction-circle ceiling

`frictionSlip` is the multiplier BOTH axes are clamped against inside Rapier's own
friction-circle solver — it is not a per-axis dial. This is why raising
`engineForcePerRearWheel` alone cannot produce oversteer: measured at 4000 N -> 1.8deg
slip, 8000 N -> 0.8deg, 25000 N -> 0.4deg (`src/physics/vehicle.ts`'s own comment) — MORE
engine force under a fixed friction circle produces LESS slip, not more, because the
circle scales the side impulse down proportionally instead of releasing it. Power
oversteer is not emergent; it has to be authored, which is exactly what
`powerOversteerGain` does.

### Front vs rear side-friction balance — the RWD-loose bias dial

`frontSideFriction` (default 1.21, `[TUNED live, 260920-sm2]`, was 1.0) and `rearSideFriction`
(default 0.2) are the two ends of the permanent, handbrake-independent RWD-loose bias.
Widening the gap between them loosens the rear relative to the front; narrowing it (or
reversing it) moves the car toward neutral or front-loose (understeer) handling. This bias
sits underneath — and is independent of — the handbrake/`powerOversteerGain` blend above.

### `bodyRollGain` / `bodyRollDamping` / `bodyRollMaxDeg`

`bodyRollGain` is an OPEN-LOOP torque, not a closed-loop PD-toward-target controller — the
PD-toward-target formulation was tried and flipped the car at every gain/cap combination
tested. It is POSITIVE FEEDBACK: rolling the body shifts suspension load, which changes
lateral force, which feeds the torque further. Measured: gain 0.10 -> ~5.5deg of tilt at
the research probe conditions (45mph, 0.26rad steer); gain 0.20 -> the car FLIPS ONTO ITS
ROOF. `bodyRollMaxDeg` (default 15) is the runaway cutoff that keeps this assist from
running away — not an optional decoration. The CI gate a retune must keep green is
`tests/vehicle-telemetry.test.ts -t "roll assist stability"`, a 15-degree cutoff checked
against every scripted routine, not just the 45mph probe condition. At the shipped
default (0.075, `[TUNED live, 260920-sm2]` — down from plan 02-10's 0.12, which was itself
raised from plan 02-07's 0.08 for the Bullitt-anchor feel), re-verified at the new baseline
(new mass/engine-force/friction values too): the worst measured routine is 9.84deg
(`ramp`) — comfortably under the cutoff.

### `autoLevelGain` / `autoLevelDamping` vs `bodyRollGain`

These are mutually exclusive BY CONSTRUCTION, not by tuning: `autoLevelGain` runs only
while ZERO wheels are grounded (airborne), `bodyRollGain` runs only while THREE OR MORE
wheels are grounded. There is no operating point where both assists are active
simultaneously, so they cannot fight each other. `autoLevelGain` is load-bearing, not
cosmetic — without it, a 120mph ramp launch with an off-axis spin lands inverted every
single time.

### Per-surface profiles

The six surfaces rank tarmac > dirt_road > gravel > grass > sand > mud on forwardGrip, a
D-04-mandated ordering. `forwardGrip` on gravel and dirt_road is `[CITED]` from real-world
tire-friction-coefficient data; every `lateralGrip` value and every grass/sand/mud
forwardGrip is `[ASSUMED]` or `[TUNED]` by feel rather than measured from a citation — see
the per-surface table in section 3 above for which is which. The measured skidpad
lateral-g separation (`tests/surface-telemetry.test.ts`, `SURFACE_SEPARATION_MIN_G`) is a
regression gate a surface retune must not break: tarmac 1.027g, dirt_road 0.820g, gravel
0.784g, grass 0.567g, sand 0.461g, mud 0.411g, with the ordering itself asserted alongside
the minimum separation.

### Camera: framing endpoints and occlusion pitch alignment

The `framing.*` low/high endpoints interpolate on speed, holding a CONSTANT geometric
pitch (`atan(altitudeM/distanceM)`) of ~79.9deg across the entire range by construction —
`lowAltitudeM`/`lowDistanceM` and `highAltitudeM`/`highDistanceM` are exact multiples of
the same ratio. `occlusion.basePitchDeg`/`occlusion.maxPitchDeg` must stay aligned with
that same geometric pitch, or the occlusion mitigation's steepen behaviour will read as
disconnected from what the camera is actually doing. `chaseFallback` is deliberately NOT
kept in sync with the permanent rig — it exists specifically to reproduce the Phase 2
plan 02-10 feel-session view byte-for-byte, a fixed historical reference point, not a
live-tunable extension of the permanent camera.

## 5. If X doesn't do what you expect, check Y

| Symptom | Likely cause | Provenance |
|---|---|---|
| Lowered `handbrakeRearSideFriction` and nothing changed off-road | The surface's `lateralGrip` multiplier scales it — check the Surfaces folder for that surface's `lateralGrip` value. | Section 2, composition chain. |
| The car spins out on a straight at high speed with no steering input | `powerOversteerGain` is inert at zero steer, so it is `rearSideFriction` ALONE governing this. | Plan 02-10 feel session; deep-dive above. |
| `slideCatchGain` is not catching slides | Measured near-inert on its own — restoring `rearSideFriction` on handbrake release is what actually catches the slide. Raising `slideCatchGain` to 0.3 during the 02-10 diagnosis made an UNRELATED spin trigger EARLIER, not later. | `src/core/vehicle-tuning.ts`, `slideCatchGain` doc comment. |
| Raising `frictionSlip` past ~3 does nothing | The dial is dead above ~10; 10.5 and 1000 measured identical (3.48g vs 3.49g). | `src/core/vehicle-tuning.ts`, `frictionSlip` doc comment. |
| Dragged the `mass` slider and nothing moved until release | Drag-release binding, by design (Pitfall 10) — applies to `mass`, `comOffset.*`, `halfExtents.*` only. | `src/debug/tuning-panel.ts`, Chassis section comment. |
| The car flips when body roll is added | Positive feedback — `bodyRollMaxDeg` is the cutoff, not a suggestion. Check it hasn't been raised past the CI gate's 15deg. | Deep-dive above; `tests/vehicle-telemetry.test.ts`. |
| Throttle will not break the rear loose no matter how much engine force is added | The friction-circle clamp (`frictionSlip`) scales the side impulse down proportionally rather than releasing it — this is exactly why `powerOversteerGain` exists as an authored term. | `src/physics/vehicle.ts` comment; deep-dive above. |
| A good tuning is gone | Use Export/Import (section 1). The three domains persist under three separate `localStorage` keys, so a corrupt one never takes the others down with it. | `src/debug/tuning-panel.ts`, D-17 comment. |

## 6. Keeping this guide honest

`tests/tuning-guide-sync.test.ts` is the mechanical gate: it extracts every control
identifier bound through `addNumber(...)` in `src/debug/tuning-panel.ts`, plus every
surface's `fwd`/`lat` display form derived from `SURFACE_TYPES`, and asserts each one
appears somewhere in this document. Adding a control to the panel — or renaming one —
requires adding (or updating) its entry here, or the test suite goes red.
