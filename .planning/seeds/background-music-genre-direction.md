---
title: Background music genre direction by area/mode
trigger_condition: Surface when scoping a music/audio pass — likely Phase 5 (Objectives, Navigation & Race Modes) once real areas and modes exist, or whenever the developer has self-generated tracks ready to wire in. Low cost to slot in once `THREE.Audio` music playback exists at all; the genre direction itself needs no further research, it's already decided.
planted_date: 2026-09-13
---

## The idea

Background music genre keyed to area/mode, not one global soundtrack:

- **Dukes-style levels** (rural, dusty, gravel/dirt-heavy) — lively banjo music
- **City/street racing and chases** — funk
- **Point-to-point / free-roam** — noodly jazz

The developer intends to generate these tracks themselves, so this is a
content-direction decision, not a licensing/sourcing question.

## Why this is cheap relative to how good it sounds

- The stack already names the right technology for this with zero new
  research needed: `CLAUDE.md`'s audio table is explicit — `THREE.Audio`
  (non-positional) is for "Music, UI, mission-brief VO," distinct from
  `THREE.PositionalAudio`'s per-source diegetic sounds (engine, sirens, tire
  screech). Background music is a solved technical slot already; this seed
  is purely about what goes in it.
- Matches an existing design precedent almost exactly: `FEATURES.md`'s
  anti-features section already argues for fixed per-level lighting presets
  (golden-hour chase, night pursuit, dusty noon) over a simulated day/night
  system, specifically because curated fixed presets beat a dynamic system
  the project doesn't need. A fixed per-area/mode music preset is the same
  philosophy applied to audio instead of lighting, and the same
  `night-stages-dynamic-headlights.md` / `night-pursuit-searchlight.md`
  seeds already assume exactly this kind of fixed-preset structure.
- Genre choices are period-correct for the project's stated cinematic
  reference points (`PROJECT.md`): banjo is the literal Dukes of Hazzard
  signature, and funk/jazz is not a stretch for Bullitt/French Connection —
  Lalo Schifrin's Bullitt score is genuinely jazz-funk, so "noodly jazz" and
  "funk" both land inside the project's own named influences rather than
  needing new tonal justification.

## Open question for whoever implements this

The three pairings mix two different axes — some by **area aesthetic**
(Dukes-style rural vs. city/street) and one by **mode** (point-to-point/
free-roam is one of v1's three named modes: P2P/Circuit/Getaway). Worth
deciding at implementation time whether the actual selection key is area,
mode, or some combination (e.g. a Circuit race through a Dukes-style rural
area — which track plays?) — not pre-solved by this seed, just flagged so
it isn't accidentally decided by whichever axis gets coded first.

## Breadcrumbs

- `CLAUDE.md` — Audio table, `THREE.Audio` for music (non-positional)
- `.planning/research/FEATURES.md` — anti-features "Weather and day/night"
  row (fixed presets over a simulated system)
- `.planning/seeds/night-pursuit-searchlight.md`,
  `.planning/seeds/night-stages-dynamic-headlights.md` — the same
  fixed-preset-by-context pattern, already seeded for lighting
- `.planning/PROJECT.md` — the project's named chase-cinema reference films
- `.planning/ROADMAP.md` Phase 5 (Objectives, Navigation & Race Modes) —
  where real areas and the three v1 modes (P2P/Circuit/Getaway) first exist
  to key music off of
