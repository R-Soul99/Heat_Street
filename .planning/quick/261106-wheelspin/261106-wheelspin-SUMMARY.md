---
status: complete
quick_id: 261106-wheelspin
---
# Wheelspin oversteer (option A for "more rear power should start slides")

Finding (headless, shipped car): more engine force could not start a slide. Slide initiation came only from a steer-and-throttle term that never read engine force and was faded out between ~56 and 90 mph (the tap-spin fix). ×1.5 power gave 0-60 3.5 -> 2.4 s and slightly SHORTER slides.

Change: `spinBlend` in src/physics/vehicle.ts pulls the tail toward the power-slide rear grip when rear drive demand exceeds rear traction. Demand = hypot(per-wheel engine force, cornering load) / (frictionSlip x surface forward grip x tyre falloff x rear suspension load); gated on real drive demand (coasting never triggers it); steer-weighted (0.3 + 0.7 |steer|); crawl and counter-steer fades; deliberately NOT scaled by the speed steering lock (a first version was, and did almost nothing). New knobs `drive.wheelspinGain` (1, 0 = off) and `drive.wheelspinOnset` (0.9), in the ?debug panel and the guide. New rear-term label "spin".

Result (full steer, throttle held): 60 mph slip peak 15 -> 25 deg, 75 mph 14 -> 22, time over 10 deg 0.45 -> 0.87 s. Coasting identical; straight launches under 1 deg slip. 30-45 mph already maxed out. More engine force does not deepen it (saturates). Tap-correction tests still pass. Feel dossier: 19 of 22 runs byte-identical, 3 changed slightly (handbrake-180, power-slide x2).

Tests: tests/wheelspin.test.ts; vehicle.test.ts throttle-term test now zeroes wheelspin; surface-blend threshold 0.6 -> 0.5.

Noted, not changed: at 90 mph with full steer and NO throttle the car spins with or without this change (lift-off oversteer).

## Follow-up (same day): the drift floor was the real lever

User drove the wheelspin build (recordings/heat-street-drive-2026-11-06T00-31-17.csv, full lock + throttle held): "not much different, not drifty enough". Replayed headless: slip held at 19-25 deg with the tail already at its 0.024 floor (`rear_term power`), so the wheelspin term had nothing to add; more engine power just drove the car out of the slide (x1.5: slip 1 deg, 97 mph); tyre falloff and lower overall grip did not help.

The dial is the rear side-friction floor under throttle: 0.024 -> steady 19-25 deg, 0.016 -> held 31-34 deg drift (max 43, no spin, also from 45 mph), 0.013 -> 53 deg then bogs down, <=0.010 -> spin. A flat 0.016 pushed `hold-slide-70` to 67 deg (guard < 60) and the flick/pivot/lift terms share the same constant, so the change is a NEW knob `drive.powerOversteerLowSpeedRearSideFriction` (0.016) used by the throttle terms only, fading to the old 0.024 over the power-fade speeds (25-40 m/s). Feel dossier: power-slide-30 slip 25 -> 42, power-slide-40 23 -> 36, 100 mph taps identical.

Tests: tests/wheelspin.test.ts (held drift, no spin from 24 and 45 mph); the old 0.024 literal test updated; the pivot hairpin test isolates the pivot by restoring the old floor.
