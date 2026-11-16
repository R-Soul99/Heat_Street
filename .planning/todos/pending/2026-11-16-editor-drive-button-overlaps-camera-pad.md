---
created: 2026-11-16T09:00:00.000Z
title: Drive button overlaps the camera pad in the terrain editor
area: editor
files:
  - tools/terrain-editor/editor.ts
  - tools/editor-shell/shell.css (.bar-group:has(.drive-btn) margin-left:auto)
---

## Problem

Quick task 261116-a53 added an always-visible "▶ Drive" button at the right end of the top bar. In
Chrome (1440 px wide) it renders on top of the camera navigation pad at the top right of the canvas
instead of sitting cleanly at the end of the bar.

## Solution

Give the Drive button its own space: either keep it in the bar flow (no auto margin pushing it over
the camera pad) or move the camera pad down. Check at 1280 and 1920 widths.
