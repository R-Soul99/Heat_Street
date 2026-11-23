---
phase: 10-off-road-stages
plan: 05
subsystem: hud-render
tags: [hud, results, gates, three, stage]
requires: [10-01, 10-02, 10-04]
provides:
  - RaceHud.showStageInfo / flashStageSplit (satisfies StageHudPort)
  - formatStageStatus / formatStageBest / formatStageThresholds
  - buildStageResultLines / ResultsView.showStageCompletion
  - createStageView (satisfies StageGatePort, reusable by the editor)
affects: [10-09]
tech-stack:
  added: []
  patterns: [single-vertex-colour-buffer banners, instanced posts, textContent-only DOM]
key-files:
  created: [src/render/stage-view.ts, tests/stage-view.test.ts]
  modified: [src/hud/race-hud.ts, tests/race-hud.test.ts, src/hud/results-view.ts, tests/results-view.test.ts]
key-decisions:
  - "Stage results use a dedicated showStageCompletion path; showCompletion untouched so medal-less stages never print NONE/UNEARNED"
  - "Gate visuals use 3 draw calls: InstancedMesh posts, one RGBA vertex-colour banner mesh (incl. 8x2 finish chequer), one beam"
metrics:
  tasks: 3
  completed: 2026-11-23
---

# Phase 10 Plan 05: Stage presentation Summary

Stage HUD (gate counter, PB line, medal thresholds, 2.5 s coloured split flash), a stage results panel with no medal row for medal-less stages, and a three-draw-call gate view with editor display mode and dimming.

## Commits
- 1cadd9f feat(10-05): stage status, PB line, thresholds and split flash in race HUD
- 26b33a6 feat(10-05): stage results panel without medal row for medal-less stages
- 334c9ab feat(10-05): stage gate visuals in three draw calls
- (follow-up) style(10-05): biome formatting

## Deviations from Plan
- [Rule 3] Biome formatting violations in new tests/code fixed in a follow-up style commit so `npm run check` is clean.
- Beam stays visible when `setDim(true)`; dimming only scales banner alpha (plan only specified banners).

## Verification
`npm run check`: only the known pre-existing failure `tests/demo-hills.test.ts` (D-03 max slope) remains. tsc clean. vehicle-rwd-golden untouched.

## Known Stubs
None.

## Self-Check: PASSED
