---
status: complete
quick_id: 261105-vu8
---
# Landing cushion (open-feel-problems #8, car side)

Cause (measured headless on the playground gap jumps): a 12-14 m/s touchdown needs ~25 g of braking over 0.4 m of suspension travel; the suspension gives ~6 g, so all four wheels pin at minimum length and the chassis slab hits the ground (43-66 g), and its 0.15 friction turns that into a 5-9 g horizontal stop. Suspension knobs alone (force cap, travel, bump stop) only reached 34 g.

Fix: `applyLandingCushion` (src/physics/vehicle-assists.ts), capped upward force along the mean ground normal, proportional to normal sink speed above `assists.landingCushionSinkMs`. Tuning `assists.landingCushionG` (12) and `landingCushionSinkMs` (3), in the debug panel and the tuning guide.

Result (medium jump, 85 mph pad): 66 g -> ~18 g vertical, 8.9 g -> ~1.5 g horizontal stop. Total g is bounded by stroke.

Tried and dropped: chassis friction 0. It removes the remaining horizontal stop but breaks the "ramp without assist" load-bearing proof in tests/vehicle-telemetry.test.ts, and the cushion already removes most of it.

Not touched: ramp geometry, overshoot (#8 part 3), surface-transition spin (#7).

Test: tests/landing-cushion.test.ts.
