---
created: 2026-09-22T00:12:31.135Z
title: Author a shorter, tighter course on the Juliette map
area: general
files:
  - public/maps/juliette-ga.routes.json
---

## Problem

Circuit (and possibly P2P) courses on the Juliette map are too spread out — checkpoints require long drives between them, which is difficult given the car's slidey/loose RWD handling (the intended "core value" feel per PROJECT.md, not a bug to fix on the car side).

Raised during playtesting after fixing navigation-arrow/minimap directional bugs (debug session `.planning/debug/resolved/nav-arrow-and-circuit-order.md`). Confirmed this is not a targeting/ordering bug: the current 3-lap circuit loop (`juliette-three-lap-loop`) is a genuine, non-backtracking 5-edge cycle, but it has two long legs (~650m and ~943m) vs. three short ones (85m/101m/266m) because that's the only real loop available in the current demo road network near that area.

## Solution

TBD — options to consider when picked up:
- Author a shorter/tighter loop or P2P route using checkpoints already on the existing Juliette road graph (`public/maps/juliette-ga.map.json`), if a tighter cycle/path exists.
- If no tighter loop exists in the current compiled area, may need a small map-compiler re-run over a denser road cluster, or a second, smaller course area.
- Consider whether medal-time thresholds (Phase 6) should account for course length/difficulty, independent of this fix.
