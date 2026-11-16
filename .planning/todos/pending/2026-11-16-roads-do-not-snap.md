---
created: 2026-11-16T09:00:00.000Z
title: Snap to grid does not apply to roads
area: editor
files:
  - tools/terrain-editor/snap.ts
---

## Problem

Snap to grid (quick task 261116-a5q) applies to scenery, buildings, ramps, start points and hedge/fence
points, but not roads: roads are painted with a brush, so there is no single placement point to snap.
The user asked for snap "for objects/roads/other tools".

## Solution

Only meaningful if roads gain node/point-based drawing. Revisit with any future road-tool redesign.
