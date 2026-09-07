---
title: Night pursuit with helicopter searchlight
trigger_condition: Surface when scoping Phase 8 (Getaway) in detail, or when deciding v1 vs v2 lighting presets. Low cost, strong thematic fit — worth an explicit yes/no rather than being forgotten.
planted_date: 2026-09-08
---

## The idea

Night-set Getaway chases where the pursuit helicopter's searchlight
actively illuminates the area around the player — strong Heat/Bullitt-at-
night chase-cinema imagery, and visually distinct from daytime pursuits.

## Why this is cheap relative to how good it sounds

Two things already in the plan connect directly to this:

- `.planning/research/FEATURES.md`'s pursuit-HUD deep dive already lists
  "spotlight cone" as one of the three simultaneous feedback channels for
  a heat pursuit (audio/visual/camera) — a searchlight isn't a new system,
  it's giving that existing concept a physical light cone + shadow-casting
  light source.
- The same research file's anti-features section already recommends
  "per-level fixed lighting presets (golden-hour chase, night pursuit,
  dusty noon)" as the correct alternative to a simulated day/night system
  (which is out of scope). "Night pursuit" was already the literal example
  given — this seed just confirms someone actually wants it built.

Net: mostly a lighting-preset + spotlight-cone-with-shadows feature, not a
new system. Worth scoping into Phase 8 or a v1.x follow-up rather than
deep v2, once Phase 3's camera/lighting groundwork exists to build on.

## Breadcrumbs

- `.planning/research/FEATURES.md` — pursuit HUD deep dive (3-channel feedback), anti-features "Weather and day/night" row
- `.planning/ROADMAP.md` — Phase 8 (Getaway: Heat, Damage & Dispatch)
