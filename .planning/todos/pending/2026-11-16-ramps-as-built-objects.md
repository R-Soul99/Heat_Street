---
created: 2026-11-16T09:00:00.000Z
title: Let ramps have a surface other than grass (needs a format change)
area: terrain-format
files:
  - src/core/terrain-format.ts (parseObject / parseRamp)
  - src/core/crest-geometry.ts (two hard-coded surface: "grass" stamps)
  - tools/terrain-editor/editor.ts (ramp placement options, Selected ramp panel)
---

## Problem

Every ramp and crest is drawn and driven as grass. The crest/ramp object format has no surface field
and buildCrestGeometry stamps "grass" in two places. The user noticed new ramps are always grass
(phase 07.1.3 plan 11 check). Undecided whether to change it.

## Solution

1. Optional surface on the crest object (e.g. AuthoredCrest.surface?: SurfaceType).
2. Parse, validate and serialise it; decide on format versioning for older files.
3. crest-geometry uses crest.surface ?? "grass".
4. Surface choice in ramp placement options and the Selected ramp panel, default tarmac for palette
   ramps, one undo step per change.
5. Confirm the physics grip lookup reads the entry surface; tests.
