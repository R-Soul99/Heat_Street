---
created: 2026-11-15T00:00:00.000Z
title: Author race routes in the editor (race nodes and checkpoints)
area: tooling
files:
  - src/core/course.ts
  - src/gameplay/race-coordinator.ts
  - tools/terrain-editor/tool-dispatch.ts
---

## Problem

The user wants to set up race routes themselves in the editor by adding race nodes and checkpoints. Today courses live in `public/maps/<id>.routes.json`, are written by hand or by script, and `parseCourseData` requires exactly one point-to-point and one circuit course per map. Not essential now, but wanted "at some point" (user, 2026-11-15).

## Solution

Not designed yet. Starting points:

- Reuse the Place tool, markers, sidebar list and undo pattern from Phase 07.1.3 (start points) and the ordered-gate authoring from Phase 10 (off-road stages). A road race route is the same kind of thing: a start, ordered checkpoints, a finish or a lap.
- Decide whether road routes and off-road stages become one format, or stay as `routes.json` and `stages.json` with one shared editor tool.
- The two-course rule in `parseCourseData` has to be relaxed so a map can hold any number of routes, including none.
- The race coordinator uses `nearestRoadNode`; hand-placed checkpoints may not sit on a road node.
- Medal times need not be preserved (user decision 2026-11-15); a route's medals can be recorded after it is authored.

Best planned after Phase 10, as its own phase.
