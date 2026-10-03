---
status: complete
---
# Quick 261003-pgl Summary

Added `createFixedIsoCameraRig` (kind "fixed-iso"): perspective, FOV 22, pitch 50, heading locked north (PI; map is ENU, Z south), arm 170 m, follows target position only (damped with existing positionLambda). Default rig unchanged; debug key `K` (needs ?debug) toggles helicopter <-> fixed-iso. `C` still toggles helicopter <-> chase.

Files: camera-math.ts (FIXED_ISO, fixedIsoOffset), helicopter-camera.ts, main.ts, tests/camera-fixed-iso.test.ts. Typecheck, biome, camera tests pass. Checked in the running app (?debug, K both ways, no console errors).

Executed inline by the orchestrator (no planner/executor subagents) on branch quick/261003-pgl-fixed-iso-camera, forked from local HEAD because local main has unpushed phase-07 work. Pre-existing uncommitted vehicle-tuning changes were left uncommitted.

Known issues (not fixed, out of scope): occlusion still runs against the iso pose; audio listener on camera; 30 m shadow box; skid-mark FX; no look-ahead; HUD panel overlap.
