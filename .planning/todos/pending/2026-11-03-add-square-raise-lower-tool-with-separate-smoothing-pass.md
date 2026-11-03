---
created: 2026-11-03T11:59:01.633Z
title: Add square raise/lower tool with separate smoothing pass
area: tooling
files:
  - src/core/terrain-brush.ts:284
  - src/core/terrain-brush.ts:309
---

## Problem

The user finds sculpting in the terrain editor slow and hard to read. Today's height tools are round falloff brushes (`raiseLower`, `smoothBrush`, `flattenBrush` in `src/core/terrain-brush.ts`): every stroke blends in softly, so it is hard to see what a stroke actually changed. Some of this may be visibility (not zoomed in while editing), but the user's own feeling is that the workflow itself is the problem.

## Solution

Add a blocky shaping mode:

- **Square raise/lower:** click or drag to step whole grid squares up or down by a fixed amount. Sharp edges are expected at this stage; it's for roughing out shape fast and visibly.
- **Smoothing pass:** run smoothing afterwards, either over a selection/area or the whole map, as a separate step (with undo through `terrain-undo.ts`).

Things to decide when planning:
- Step size and square size: one grid cell, or a chosen block size.
- Smoothing must keep the road-flagged cells levelled, the same as the slope limiter does (WR-02).
- Helping visibility: a grid overlay, height contours or a preview of the next step, plus a zoom check.

Raised 2026-11-03 at Phase 04.2 close, alongside the 04.2 follow-up fixes.
