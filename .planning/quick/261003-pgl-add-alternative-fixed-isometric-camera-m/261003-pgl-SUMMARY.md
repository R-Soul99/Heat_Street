---
status: complete
---
# Quick 261003-pgl Summary

Added `createFixedIsoCameraRig` (kind "fixed-iso"): perspective, FOV 22, pitch 50, heading locked north (PI; map is ENU, Z south), arm 170 m, follows target position only (damped with existing positionLambda). Default rig unchanged; debug key `K` (needs ?debug) toggles helicopter <-> fixed-iso. `C` still toggles helicopter <-> chase.

Files: camera-math.ts (FIXED_ISO, fixedIsoOffset), helicopter-camera.ts, main.ts, tests/camera-fixed-iso.test.ts. Typecheck, biome, camera tests pass. Checked in the running app (?debug, K both ways, no console errors).

Executed inline by the orchestrator (no planner/executor subagents) on branch quick/261003-pgl-fixed-iso-camera, forked from local HEAD because local main has unpushed phase-07 work. Pre-existing uncommitted vehicle-tuning changes were left uncommitted.

Known issues (not fixed, out of scope): occlusion still runs against the iso pose; audio listener on camera; 30 m shadow box; skid-mark FX; no look-ahead; HUD panel overlap.

## Follow-ups (user playtest)
- Fixed iso rig now damps a focus point (constant pitch/heading) instead of damping camera position only.
- Road shimmer/wobble was depth precision (z-fighting vs terrain sunk 0.1 m): fixed by near 40 m / far 400 m on the iso rig (FIXED_ISO.nearM/farM), restored on every rig swap via `swapRig` in main.ts. Confirmed fixed by user.
- TEMPORARY: `DISABLE_SPEED_FRAMING = true` in helicopter-camera.ts holds the helicopter rig at low-speed framing. Set to false to restore the speed zoom.
- Still open (unverified): shadow box, occlusion, audio listener, skid-mark FX, no look-ahead.

## Later changes (user playtest, same day)
- Occlusion fade-in stalled below opacity 1 (Float32), leaving buildings depth-write-off forever: fixed by snapping to 1 above 0.999 (tests/occlusion-controller.test.ts).
- Fixed iso is now the boot default; K swaps to helicopter.
- Buildings no longer fade by default (occlusion "off"); `src/render/car-xray.ts` draws a translucent ghost of the car through them. Accepted by user as good enough for now.

## Deferred (user wants later)
- Better car silhouette in the x-ray: currently chassis box only, no wheels (wheel ghosts leak through the roof because they sit inside the chassis box; a proper silhouette likely needs a stencil pass). Also player car only, and a true outline rather than a fill.
- Skid marks: too heavy/black, and stay on at speed after wheels regain grip (trigger not releasing) — not yet investigated.
- Revisit `DISABLE_SPEED_FRAMING` (temporary) in helicopter-camera.ts.
