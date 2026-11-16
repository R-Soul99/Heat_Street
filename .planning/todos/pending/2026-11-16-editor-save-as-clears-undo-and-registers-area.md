---
created: 2026-11-16T09:00:00.000Z
title: Save as clears undo history and auto-registers the new area in the map lists
area: editor
files:
  - tools/terrain-editor/save-as.ts
  - tools/terrain-editor/editor.ts
  - tools/map-compiler/authored-maps.json
  - src/core/authored-maps.generated.ts
---

## Problem

File > Save as (quick task 261116-a53) switches to the new area by reloading it from disk, which
clears undo history. The existing sidecar PUT also auto-registers the new area, writing the generated
map lists (authored-maps.json, authored-areas.generated.ts, authored-maps.generated.ts).

## Solution

Decide whether undo should survive Save as (keep the in-memory state and history, just retarget the
area name), and whether Save as copies should be registered automatically or only on request.
