---
title: Moddable content support
trigger_condition: Surface once v1's physics/handling model is stable and the core loop is validated. Research (FEATURES.md) already flags custom-level tooling as the highest-ceiling long-term replayability feature in the genre (it's what makes Trackmania eternal) — but explicitly requires a stable physics build and an editor before it's viable.
planted_date: 2026-09-08
---

## The idea

Player floated adding a moddable element to the game — likely custom
levels/routes at minimum, possibly custom vehicles. Framed as a "might be
veering from the main theme, but always fun" addition, not a core pillar.

## Why deferred

- Already independently identified in `.planning/research/FEATURES.md`
  under "Future Consideration (v2+)": "Community/custom level tooling —
  defer: the highest-ceiling replayability feature in the genre... but it
  needs a stable physics build and an editor."
- A mod/editor system is a substantial standalone project in itself
  (level format stability, an authoring UI, sharing/distribution) — not
  something to design prematurely while the core physics/handling model
  is still being tuned in Phases 1-2. Any editor built before physics
  stabilizes would need to be redone.
- Worth deciding, when this surfaces, whether "moddable" means levels only
  (lowest cost, reuses the map-compiler pipeline from Phase 4), or extends
  to vehicles/cars too (bigger scope, ties into VEH-05's car-roster plans).

## Breadcrumbs

- `.planning/research/FEATURES.md` — "Future Consideration (v2+)" section
- `.planning/ROADMAP.md` — Phase 4 (Map Pipeline) is the natural foundation a level editor would build on
