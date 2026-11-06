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
