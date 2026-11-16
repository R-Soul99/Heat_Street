---
created: 2026-11-16T09:00:00.000Z
title: Left-pane header and View section still show when an item is selected
area: editor
files:
  - tools/terrain-editor/pane-state.ts
  - tools/terrain-editor/editor.ts
---

## Problem

With a ramp selected (quick task 261116-a53, contextual left pane), the pane header still reads
"Select / No selection" and the View section (Grid spacing, Contour interval) still appears below the
"Selected ramp" panel. The user asked for the pane to show only the selected item's controls.

## Solution

When an item is selected, set the header to the item kind (e.g. "Ramp") and hide the View section
(or move View options to the top-bar View menu). Extend the pane-state tests.
