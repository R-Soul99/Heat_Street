# Quick 261003-vio: Skid marks, smoke and tyre audio trigger on real tyre slip

Branch: quick/skid-marks-real-slip (stacked on quick/261003-pgl-fixed-iso-camera, PR #2).

Root cause: effects used `hypot(wheelSideImpulse, wheelForwardImpulse)`, which under full throttle is just `engineForce * DT` (80 at current tuning) at every speed — above the tarmac threshold (65, calibrated on an older engine tune). Every flat-out run laid marks, smoke and screech.

Tasks
1. `src/core/tyre-slip.ts`: `tyreSlipRatio` (force / (frictionSlip * suspensionForce * DT)) and `nextSliding` hysteresis latch, with tests.
2. main.ts: feed the ratio to FX and audio instead of the raw impulse.
3. surface-fx.ts: thresholds in ratio units, per-wheel latch shared by particles and decals, emit-rate scaling, lighter/narrower tarmac decals with a 0.6 peak opacity.
4. surface-audio.ts: audible 0.95 / full gain 1.5 in ratio units.
