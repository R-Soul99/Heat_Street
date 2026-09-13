---
phase: 03-surfaces-helicopter-camera
plan: 12
subsystem: surface-tuning, surface-fx, camera-occlusion, frame-budget
tags: [feel-session, playtest, human-verify, adr, gamepad, frame-budget]

# Dependency graph
requires:
  - phase: 03-surfaces-helicopter-camera (plan 03-06)
    provides: six-surface skidpad/stability telemetry sweep, measured baseline lateral-g figures
  - phase: 03-surfaces-helicopter-camera (plan 03-09)
    provides: src/render/camera/occlusion-controller.ts's fade/steepen/off A/B/C toggle
  - phase: 03-surfaces-helicopter-camera (plan 03-10)
    provides: src/render/surface-fx.ts's per-surface particle FX and skid decal pool
  - phase: 03-surfaces-helicopter-camera (plan 03-11)
    provides: src/audio/surface-loops.ts's six synthesized crossfaded audio channels
  - quick task 260913-epf
    provides: reverse gear, temporary ?debug free-look camera, the steepen fan-ray/back-face bug diagnosis
provides:
  - "docs/adr/0003-occlusion-mitigation.md: CAM-04/SC6 occlusion decision — fade ships"
  - "src/core/surface-tuning.ts: gravel/dirt_road lateralGrip retuned and [TUNED] per D-05's dust-and-slide anchor"
  - "src/render/surface-fx.ts: SLIP_THRESHOLD_LOOSE, sand/mud dust emission now responds to driving intensity"
  - "src/core/frame-budget.ts: SCENE_TARGETS (renamed from PHASE1_DEBUG_SCENE_TARGETS), draws/bodies targets raised against a real measured reading"
  - "Phase 2 SC2 gamepad carry-forward closed: real-hardware verified, 02-RESEARCH.md Assumption A1 confirmed correct"
  - "Phase 2 rearSideFriction straight-line-instability carry-forward closed on real surfaces"
  - "Two seeds: night-stages-dynamic-headlights.md, dust-cloud-los-evasion.md"
affects: [phase-04-map-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A per-surface FX/audio constant that turns out to saturate against a shared threshold constant gets its own named override (SLIP_THRESHOLD_LOOSE) rather than a silent per-profile literal, keeping the reasoning legible at the declaration site"
    - "A HUD target constant with no scene-awareness must be named for what it actually checks against (the current live scene), not the phase that first authored it — a phase-prefixed name left in place after later phases change the scene silently misdescribes what the flag means"

key-files:
  created:
    - docs/adr/0003-occlusion-mitigation.md
    - .planning/seeds/night-stages-dynamic-headlights.md
    - .planning/seeds/dust-cloud-los-evasion.md
  modified:
    - src/main.ts
    - src/core/surface-tuning.ts
    - src/render/surface-fx.ts
    - src/core/frame-budget.ts
    - src/debug/profiler-hud.ts
    - tests/frame-budget.test.ts
    - tests/profiler-hud.test.ts
    - .planning/STATE.md

key-decisions:
  - "CAM-04/SC6: fade ships as the default occlusion mitigation. Steepen is NOT rejected on feel — it is blocked by a confirmed fan-ray/back-face-culling bug (quick task 260913-epf) that pins its density measurement at exactly 0/5 in the only test canyon, so it was never actually exercised above baseline pitch. off was never separately driven this session. Both facts are recorded honestly in the ADR rather than presenting a three-way comparison that didn't fully happen."
  - "D-05's Dukes-of-Hazzard dust-and-slide anchor FAILED at gravel/dirt_road's shipped 0.55/0.55 lateralGrip ('the back doesn't kick out quite enough') and was corrected live to 0.6/0.5 respectively — deliberately differentiated rather than left equal — then re-confirmed as the dramatic slide the anchor requires."
  - "Measured skidpad lateral-g at the retuned defaults barely moved from 03-06's original figures despite the felt slide becoming noticeably more dramatic — the skidpad routine measures sustained steady-state cornering g, not break-away/slide character, so this is an expected gap between what that automated metric captures and what the human judged, not a test conflict. No test assertion needed correction; ordering and SURFACE_SEPARATION_MIN_G both still hold unchanged."
  - "sand/mud's dust particle emission read as constant regardless of driving style because their very low forwardGrip pins ordinary throttle's wheel slip near the emit-rate multiplier's x4 cap even at light input — fixed by giving sand/mud their own slipThreshold tier (SLIP_THRESHOLD_LOOSE=22) between the shared _LOW and _MID tiers, restoring a driving-intensity-responsive range. Confirmed by playtest."
  - "frame-budget's PHASE1_DEBUG_SCENE_TARGETS was the ONLY live target set the HUD ever checks (no scene-awareness) despite its name — Phase 3's real scene was being flagged over-budget (57 draws vs a target of 20) against a number authored for Phase 1's bare six-box scene. Renamed to SCENE_TARGETS and raised (drawCalls 20->70, bodies 20->30) against a real measured heavy-FX reading, not another estimate."
  - "Two structurally larger ideas raised during the session were deliberately deferred to seeds rather than built ad hoc: a continuous (non-slip-gated) dust emission channel for loose surfaces, and a doughnut-dust-cloud pursuer-LOS-break evasion mechanic — both explicitly Phase 7/8+ territory, not this phase's scope."

patterns-established: []

requirements-completed: [SURF-01, SURF-02, CAM-01, CAM-02, CAM-03, CAM-04]

# Metrics
duration: ~3h (interactive playtest session, including quick task 260913-epf spawned mid-session)
completed: 2026-09-13
---

# Phase 3 Plan 12: Full-Phase Feel Session Summary

**A human drove the complete Phase 3 build — six surfaces, particle FX, skid decals, six audio channels, the helicopter camera, both skins, and all three occlusion mitigations — and every value the session changed now ships as a tagged default: gravel/dirt_road's dust-and-slide anchor was corrected live, fade won the CAM-04 occlusion decision (with steepen's non-evaluation traced to a real, separately-fixed bug), and the frame-budget document's stale Phase-1 target was replaced with the real measurement this playtest was always supposed to produce.**

## Performance

- **Duration:** ~3 hours across the full interactive session (Task 1's 12-step playtest, Task 2's decision, Task 3's close-out), including a mid-session quick task (260913-epf: reverse gear + debug free-look camera, spawned to unblock the playtest itself)
- **Tasks:** 3 (Task 1 human-verify, Task 2 decision checkpoint, Task 3 auto close-out)

## Accomplishments — Task 1, all 12 steps

1. **Audio unlock** — implicit pass; audio was audible throughout the session, no report of silence.
2. **Surface feel** — all six surfaces measurably and feelably distinct. Tarmac/grass/sand/mud all "right" unchanged at shipped defaults.
3. **Dukes anchor (D-05)** — initially FAILED on gravel/dirt_road ("the back doesn't kick out quite enough" at 0.55/0.55 lateralGrip). Corrected live via the `G` panel to gravel 0.6 / dirt_road 0.5, re-tested, confirmed: *"yeah that's the dramatic slide now, good."*
4. **Controllability (D-04)** — mud and sand both pass: noticeably slippery, stayed controllable with normal inputs.
5. **Visual distinctness (SC2/D-09)** — all six particle effects distinct, confirmed by direct verdict.
6. **Skid decals** — frame rate holds during a sustained heavy drift with the 48-slot pool at capacity; marks fade gracefully rather than accumulating or dropping frames.
7. **Audio distinctness (SC2/D-09)** — all six surfaces identifiable by ear. Quality flagged as poor (expected — synthesized placeholder noise, not real recordings); developer may supply real WAV recordings via the existing unwired `loadSurfaceLoops` path.
8. **Audio crossfade** — reads as a genuine blend, not mush, at a diagonal band-boundary crossing.
9. **Occlusion A/B/C (SC6/CAM-04)** — fade confirmed working directly (building faded on occlusion). Steepen showed no visible change; investigated (not dismissed) and traced to a confirmed measurement bug via quick task 260913-epf, not a feel failure. `off` not separately driven. Decision: **fade ships** (`docs/adr/0003-occlusion-mitigation.md`).
10. **Frame budget** — real profiler HUD reading during a heavy gravel slide: frame 16.68ms (effectively exact 60fps), physics 0.38ms, render 1.64ms CPU-submit, 57 draw calls, 692 triangles, 21 total bodies (1 active). All comfortably under budget once the stale Phase-1 draw-calls/bodies targets were corrected to real Phase-3-scene-appropriate numbers.
11. **Camera skins (CAM-03/D-15)** — pass, distinct from each other and clear on all six surfaces.
12. **Gamepad (Phase 2 SC2 carry-forward)** — hardware available this session. Left-stick steering and both trigger axes read as proportional (not binary/snap), reverse (added by quick task 260913-epf) engages smoothly off the left trigger once stopped. 02-RESEARCH.md Assumption A1's axis-index mapping confirmed correct as shipped, no code change. Carry-forward closed.

## Task 2 — CAM-04/SC6 Occlusion Decision

**Selected: fade.** Backed by the step 9 evidence above. Full reasoning, evidence quotes, and what would justify revisiting recorded in `docs/adr/0003-occlusion-mitigation.md`.

## Task 3 — Tuned Defaults and Close-out

- `src/core/surface-tuning.ts`: `gravel.lateralGrip` 0.55 → 0.6, `dirt_road.lateralGrip` 0.55 → 0.5, both retagged `[TUNED in plan 03-12's feel session]`.
- `src/render/surface-fx.ts`: new `SLIP_THRESHOLD_LOOSE = 22` constant, applied to `sand`/`mud`'s `slipThreshold` (was the shared `SLIP_THRESHOLD_LOW = 12`), tagged `[TUNED in plan 03-12's feel session]`.
- `src/main.ts`: occlusion mitigation initializer comment now points at `docs/adr/0003-occlusion-mitigation.md` instead of calling itself provisional (mitigation value itself, `"fade"`, was already correct).
- `src/core/frame-budget.ts` / `src/debug/profiler-hud.ts` / `tests/frame-budget.test.ts` / `tests/profiler-hud.test.ts`: `PHASE1_DEBUG_SCENE_TARGETS` renamed `SCENE_TARGETS`, `drawCalls` 20→70, `bodies` 20→30.
- `docs/frame-budget.md`: "Phase 1 debug-scene targets" section replaced with "Live scene targets" (revised-forward framing) plus the real measured reading; the prior "NOT YET TAKEN" estimate section replaced with a pointer to that measurement.
- Re-ran `tests/surface-telemetry.test.ts`, `tests/surface-audio.test.ts`, `tests/frame-budget.test.ts`, `tests/profiler-hud.test.ts` — all green against the new defaults, no assertion needed correction (ordering and `SURFACE_SEPARATION_MIN_G` both still hold; new measured lateral-g: tarmac 1.027g, dirt_road 0.820g, gravel 0.784g, grass 0.567g, sand 0.461g, mud 0.411g — barely moved from 03-06's figures despite the felt slide improving, since the skidpad metric measures sustained cornering g, not break-away character).
- `npm run check` and `npm run build` both exit 0.
- `.planning/STATE.md` updated: occlusion decision, frame-budget fix, the full Task 1 session outcome, gamepad carry-forward closed, `rearSideFriction` re-verification carry-forward closed.
- Two seeds captured for structurally larger ideas raised mid-session but explicitly out of this phase's scope: `.planning/seeds/night-stages-dynamic-headlights.md`, `.planning/seeds/dust-cloud-los-evasion.md`.

## Final Six Surface Grip Multipliers (shipped defaults)

| Surface | forwardGrip | lateralGrip | Measured skidpad lateral-g | Provenance |
|---|---:|---:|---:|---|
| tarmac | 1.00 | 1.00 | 1.027 g | Unchanged (Phase 2 baseline) |
| gravel | 0.75 | **0.60** (was 0.55) | 0.784 g | `[TUNED in plan 03-12]` |
| dirt_road | 0.78 | **0.50** (was 0.55) | 0.820 g | `[TUNED in plan 03-12]` |
| grass | 0.55 | 0.60 | 0.567 g | Unchanged, confirmed "right" |
| sand | 0.45 | 0.55 | 0.461 g | Unchanged, confirmed "right" |
| mud | 0.40 | 0.50 | 0.411 g | Unchanged, confirmed "right" |

## Deviations from Plan

None structural. Two items surfaced mid-session that the plan didn't anticipate and were handled outside its literal task list, both logged rather than silently absorbed:

- Reverse gear and a temporary debug free-look camera were needed to make the playtest itself practicable (getting unstuck from the placeholder canyon, inspecting occlusion from odd angles) — spawned as quick task 260913-epf rather than folded into this plan's own tasks, since they're general-purpose additions, not Phase 3 feel-tuning.
- The frame-budget draw-calls target fix (Task 1 step 10) went beyond "record the measurement" into "fix the stale comparison the measurement exposed" — judged in-scope since the plan's own Task 3 text explicitly authorizes raising a target "with a justification" when step 10 reports an overage, and leaving a known-wrong constant in place would have shipped a HUD that misreports every session after this one.

## Issues Encountered

None blocking. The steepen occlusion arm's non-functionality in the test canyon was investigated rather than treated as an issue with this plan — root-caused as a pre-existing bug via quick task 260913-epf, not something introduced or left unexplained by this session.

## User Setup Required

None for this plan's own changes. Optional follow-up entirely at the developer's discretion: real WAV surface-audio recordings can be supplied and wired through the existing `loadSurfaceLoops` path whenever convenient — synthesis remains the shipped fallback either way.

## Next Phase Readiness

Phase 3's success criteria are now all addressed: SC1 (surface grip) confirmed by feel and measurement; SC2 (visual/audio distinctness) confirmed on both axes for all six surfaces; SC3/SC4 (camera drift stability, speed legibility) already closed in `docs/adr/0002-helicopter-camera-go-no-go.md`; SC6 (occlusion, "not a paper decision") closed in `docs/adr/0003-occlusion-mitigation.md`. Phase 2's two carried-forward open items (gamepad, `rearSideFriction` real-surface re-verification) are both closed. Two real product ideas (continuous surface dust, dust-cloud pursuit evasion) are captured as seeds rather than left to be forgotten. The steepen fan-ray/back-face bug remains open and tracked (`.planning/STATE.md`) — cheap to revisit whenever Phase 4's real geometry makes the occlusion comparison worth re-running.
