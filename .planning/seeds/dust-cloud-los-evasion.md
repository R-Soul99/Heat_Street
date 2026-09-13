---
title: Dukes-style doughnut dust cloud breaks pursuer line-of-sight
trigger_condition: Surface when scoping Phase 7 (NPC Driving AI) or Phase 8 (Getaway) in detail — specifically when the LOS/heat-cooldown system from `.planning/research/FEATURES.md` gets implemented. Needs to be decided alongside the existing "tunnels/overpasses break chopper LOS" counter-play idea, since this is the same mechanic (a legible, learnable way to break pursuer LOS) with a player-triggered rather than geometry-triggered source.
planted_date: 2026-09-13
---

## The idea

A classic Dukes-of-Hazzard manoeuvre: doughnut on a loose surface (gravel/
dirt/dust) to kick up a big dust cloud, which obscures the pursuing police's
line of sight, then drive off while they can't see through it. Raised as
something that "needs to be a thing in the final product" — a specific,
skill-based evasion technique the player can deliberately execute, not just
ambient dust FX.

Surfaced directly out of this session's Phase 3 surface-FX playtest: the
player wanted sand/mud to kick up dust continuously while driving through
them (not just during a detected tire slide), and separately wanted
particles to hang longer and visually build up into a cloud rather than
dispersing quickly. Both of those cosmetic requests turn out to be
functional prerequisites for this mechanic — a LOS-breaking cloud needs
density and hang-time to actually occlude, not just look nicer.

## Why deferred

- Pursuer AI, heat, and the LOS/detection system don't exist yet — this is
  Phase 7/8 territory (`.planning/ROADMAP.md` Phase 7 "Other cars share the
  road and actually drive," Phase 8 "the chase pillar lands"). Nothing to
  hook this into yet.
- `.planning/research/FEATURES.md` already designs a LOS/heat-cooldown
  system in real depth: heat should only decay once the player is BOTH out
  of line of sight AND outside the search radius, units should path to
  last-known-position rather than give up on contact loss, and AI must
  guard against being cheesed by driving in circles through scenery. A
  temporary dust-cloud LOS break needs to compose cleanly with that
  existing design (e.g. a cloud has to actually occlude a raycast/vision
  check, and pursuers should reasonably path toward last-known-position
  through/around it, not just stand there confused) — not be designed in
  isolation.
- That same research file already names one LOS-breaking counter-play:
  "Helicopter counter-play (tunnels/overpasses break chopper LOS)," flagged
  LOW cost but requiring tunnel/covered geometry in maps. The dust cloud is
  the same category of mechanic (a legible, learnable way to lose the
  chopper) but player-triggered via driving skill rather than geometry —
  worth deciding both together so the game doesn't end up with two
  unrelated ad hoc LOS-break systems.
- Needs Phase 3's particle system to grow past its current placeholder
  shape first (see this session's related note: sand/mud FX are currently
  a slide-detector, on/off tied to a slip threshold, not a continuous
  rolling-through-material effect; particles are short-lived single sprite
  puffs, not a persistent buildable cloud). A LOS-occluding cloud is a
  harder requirement than a cosmetic one — it likely needs a genuine
  density/opacity volume check against the pursuer's sightline, not just
  "particles are visually present."

## Breadcrumbs

- `.planning/research/FEATURES.md` — heat/LOS cooldown design (lines ~92,
  103), "Helicopter counter-play (tunnels/overpasses break chopper LOS)"
  row, `[Pursuer AI] + [LOS/detection] + [spawn director]` dependency chain
- `.planning/ROADMAP.md` — Phase 7 (NPC Driving AI & Circuit Racers), Phase
  8 (Getaway — Heat, Damage & Dispatch), Phase 8's stated success criterion
  "heat only begins decaying once the player is both out of line of sight
  and outside the search radius; units path to last-known position"
- `src/render/surface-fx.ts` — current per-surface particle FX, the
  slip-threshold-gated emission model this mechanic would need to extend
  or add a channel alongside
- This session's live playtest notes (continuous rolling-material dust,
  longer particle hang-time) — cosmetic requests that turn out to be
  functional prerequisites for this mechanic
