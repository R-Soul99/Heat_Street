---
status: complete
quick_id: 261105-vu (surface-blend)
---
# Surface regrip blend (open-feel-problems #7)

Cause (measured headless, playground mud strip east edge x=660): wheel surface grip stepped instantly per wheel from the paint under it. The front axle reached tarmac ~0.15 s before the rear, so the front regripped while the rear still slid on mud; yaw rate jumped 0.2 -> 1.0 rad/s (25 deg / 45 mph) and some crossings spun.

Fix: per-wheel first-order blend of the lateral and forward surface grip multipliers (`blendToward` in src/physics/vehicle.ts): `wheels.surfaceRegripSec` 0.5 s when grip rises, `wheels.surfaceDegripSec` 0.08 s when it falls. Seeded on reset. Live in the ?debug panel (Grip) and the tuning guide. User: crossing from mud/sand to tarmac should keep some slideyness before gripping.

Result (25 deg / 45 mph, coasting / on throttle): yaw peak 1.02 / 0.68 -> 0.62 / 0.34 (control without crossing 0.19 / 0.13). Slides beyond ~35 deg spin on mud alone and are unaffected. Feel dossier on flat tarmac byte-identical.

Test: tests/surface-blend.test.ts.
