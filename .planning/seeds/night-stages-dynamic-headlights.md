---
title: Night stages with dynamic headlight lighting
trigger_condition: Surface when scoping Phase 4 (Map Pipeline) or later, once real road/building geometry and materials exist to light. Also cross-check against `night-pursuit-searchlight.md` when either surfaces — likely the same lighting-preset system with two different primary light sources (car headlights here vs. helicopter searchlight there), worth designing together rather than twice.
planted_date: 2026-09-13
---

## The idea

Dedicated night stages/levels where the scene is mostly dark and the
player mainly sees the world through their own car's headlights (and
presumably other traffic/pursuer headlights) illuminating the road and
surroundings dynamically as they drive — rather than a lit, day-style
scene with a night skybox swapped in.

Raised in the same conversation as a note about real police-helicopter
chase footage: on fast roads the chopper climbs and widens its view (see
`src/core/camera-tuning.ts`'s `framing` speed curve, which already does
this — not part of this seed, just the same conversation). Night stages
were raised as a separate, additive idea: mood and readability built
around headlight cones rather than ambient/day lighting.

## Why deferred

- `.planning/research/FEATURES.md`'s anti-features section already argues
  against a simulated day/night cycle and recommends fixed per-level
  lighting presets instead (golden-hour chase, night pursuit, dusty noon)
  — night stages fit that model directly, so this isn't a new lighting
  *architecture*, just a preset that centers car headlights specifically
  rather than the helicopter searchlight `night-pursuit-searchlight.md`
  already seeds for Getaway.
- Needs real geometry to read as atmospheric rather than empty — right
  now Phase 3's placeholder scene is 14 flat-colored boxes and colored
  ground bands (confirmed placeholder, not final art direction, in this
  same conversation). A night preset would look worse, not better, tested
  against that scene. Phase 4's real OSM-derived buildings/roads are the
  natural point to try it.
- Per-car dynamic headlights (likely `THREE.SpotLight` or similar, with
  shadow-casting) have a flagged performance question already on record:
  `.planning/research/STACK.md` names "thousands of dynamic lights (dense
  night-time city with per-car headlights)" as one of the explicit
  triggers for revisiting WebGPU over WebGL. Worth a real profiling pass
  once pursuer/traffic counts are known (Phase 7/8), not assumed now.
- Overlaps enough with `night-pursuit-searchlight.md` that the two should
  be scoped as one lighting-preset decision, not two separate features —
  a searchlight cone and headlight cones are the same rendering technique
  with different owners and intents (hunter vs. hunted visibility).

## Breadcrumbs

- `.planning/seeds/night-pursuit-searchlight.md` — the earlier, Getaway-specific
  half of this same idea (helicopter searchlight rather than car headlights)
- `.planning/research/FEATURES.md` — anti-features "Weather and day/night" row
  (fixed lighting presets, not a day/night cycle)
- `.planning/research/STACK.md` — WebGPU-over-WebGL revisit trigger: "dense
  night-time city with per-car headlights"
- `.planning/ROADMAP.md` — Phase 4 (Map Pipeline & First Area) is the first
  point real geometry exists to light; Phase 8 (Getaway) is where pursuit
  context and `night-pursuit-searchlight.md` would meet this
