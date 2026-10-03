---
status: complete
---
# Quick 261003-vio Summary

Skid marks, smoke and tyre screech now trigger on a tyre slip RATIO (force over the wheel's friction limit) with an on/off hysteresis latch, instead of raw impulse magnitude.

Measured (headless, default tuning, rear wheels): old metric = 80 constant at full throttle on every surface (> tarmac threshold 65). Ratio: tarmac full-throttle straight 0.88 (grip); launch ~1.0-1.6; sustained turn ~1.1; handbrake 1.25-1.4; loose surfaces higher by design (gravel/dirt ~1.15, grass 1.6, sand 1.95, mud 2.0 at full throttle). Thresholds: tarmac 1.0, grass 0.95, sand/mud 0.9, gravel/dirt 0.85; release margin 0.08.

Look: tarmac decal colour 0x101014 -> 0x26262b, size 1.4 -> 0.9 m, spacing 1.2 -> 1.0 m, peak opacity 0.6.

Verified by unit tests and headless physics measurements only. NOT verified visually: the browser harness could not drive the car (throttled tab). Needs a playtest; all thresholds are first-pass.

Known: hard braking measures ratio 1.7-2.0 (brake impulse vs. the same limit), so it will lay marks/screech — arguably right (wheel lock) but unconfirmed by feel. Smoke emit-rate scaling changed (0.3 ratio per step); loose-surface dust ramps less than before.

Side effect: `biome check --write src` reformatted line endings in src/input/race-commands.ts and src/loop.ts; left uncommitted (a discard was blocked by the sandbox).
