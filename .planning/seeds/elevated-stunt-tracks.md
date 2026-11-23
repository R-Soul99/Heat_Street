---
added: 2026-11-23
source: user, during phase 10 ramps discussion
---

# Elevated stunt tracks

Raised, roller-coaster-style stunt tracks: track sections on supports above the terrain, banked curves, dips and crests, gaps to jump, drops. Driven at speed with the risk of falling off the track.

Build on the phase 10 "structure piece" base (D-20 in `.planning/phases/10-off-road-stages/10-CONTEXT.md`): each track section is a parametric piece with a profile, transform, material and supports, placed and snapped in the terrain editor like ramps.

Open questions for later: how pieces join (end-to-end snapping with matching bank and height), collider build for curved banked sections (trimesh with FIX_INTERNAL_EDGES), falling-off and respawn rules, and how a track becomes a stage or race route.
