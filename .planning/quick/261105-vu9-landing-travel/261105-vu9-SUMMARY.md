---
status: complete
quick_id: 261105-vu9
---
# Landing travel (open-feel-problems #8, car side, follow-up to 261105-vu8)

Hand-driven recordings (recordings/heat-street-drive-2026-11-05T23-07-43.csv, 23-08-04.csv) showed the horizontal stop was gone (forward speed rises through touchdown) but all four wheels sat at minimum suspension length for 20-29 ticks (0.33-0.5 s), with up to 8.5 m/s compression speed on a nose-first landing.

Change (src/core/vehicle-tuning.ts): connectionY -0.3 -> -0.15, suspensionRestLength 0.45 -> 0.6, maxSuspensionTravel 0.4 -> 0.55, maxSuspensionForce 20000 -> 40000, landingCushionG 12 -> 14. Ride height is unchanged (body y 0.941 at rest both ways; the strut is 0.15 m longer, same compression).

Headless gap jumps (small 70, medium 70/85): fully-pinned ticks 14-16 -> 0, peak jerk 1950-3700 g/s (original) / up to 876 (cushion only) -> ~500 g/s, peak vertical 20 g, horizontal loss 0.3 g or less.

Correction to an earlier table in chat: a first probe raised the rest length without moving connectionY, so the car sat 0.15 m higher and the lowest-point numbers were inflated. The numbers above use the ride-height-preserving change.

Flat-ground driving unchanged: feel dossier slip/yaw peaks and summary.txt identical to the cushion-only branch (22 runs).

Test updates: vehicle-tuning literal (force cap 40000); feel-test-ramps 95 mph climb test (no longer bottoms even with bump stop 1); landing-cushion test gains pinned/minY assertions.

Not touched: overshoot, surface-transition spin (#7).
