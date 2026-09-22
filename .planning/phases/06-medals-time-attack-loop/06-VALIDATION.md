# Phase 6 Validation

nyquist_compliant: true
phase: 06-medals-time-attack-loop

## Automated Checks

Run the narrow check after each plan:

- `npm test -- --run tests/medal-timing.test.ts tests/sim-clock.test.ts tests/race-state.test.ts`
- `npm test -- --run tests/medal-persistence.test.ts tests/tuning-persist.test.ts tests/tuning-snapshot.test.ts`
- `npm test -- --run tests/medal-reference.test.ts tests/course-data.test.ts tests/route-validation.test.ts`
- `npm test -- --run tests/race-coordinator.test.ts tests/medal-timing.test.ts tests/minimap.test.ts`
- `npm test -- --run tests/results-view.test.ts tests/medal-reference.test.ts tests/medal-persistence.test.ts`

Run phase gates after integration:

- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run lint`

The known Phase 2 vehicle telemetry failures and pre-existing repository-wide lint findings are unrelated baselines and must be recorded, not silently changed by Phase 6.

## Manual-Only Verification

The following require a desktop browser and cannot be reduced to a reliable Node test:

- Phase 5 handoff smoke in both `http://127.0.0.1:5173/` and `http://127.0.0.1:5173/?mode=circuit`: route guidance, checkpoint completion, three-lap Circuit, respawn, restart, no duplicate overlays, and no console errors.
- Handling-lock/reference-authoring sign-off: current shipped tuning is the intentional baseline; no stale Phase 2 performance band is used as a proxy. Reference totals and all checkpoint/lap cumulative splits are recorded from the fixed simulation clock and reproduced once before commit.
- Final Phase 6 browser sign-off: timer before/during run, first-movement behavior, threshold visibility, source-labelled splits, respawn penalty, restart reset, medal result, localStorage reload persistence, course-card grid, 15 Circuit sectors, and single slowest-sector highlight.

## Requirement Sampling

- `NAV-02`: `tests/medal-timing.test.ts`, `src/hud/race-hud.ts`, final browser timer/threshold check.
- `MEDAL-01`: `tests/medal-timing.test.ts`, `tests/medal-reference.test.ts`, committed reference artifact, threshold boundary checks.
- `MEDAL-02`: `tests/medal-persistence.test.ts`, `tests/results-view.test.ts`, reload persistence checkpoint.
- `MEDAL-03`: coordinator/timing tests, source-labelled split HUD, P2P/Circuit checkpoint smoke.
- `MEDAL-04`: sector/lap identity tests, results view model tests, final slowest-sector browser check.

## Source Coverage Audit

| Source | Item | Planned coverage |
|---|---|---|
| ROADMAP goal | Graded, persisted replay loop with localized failure | 06-01 through 06-05; final browser gate |
| ROADMAP success criteria | Live thresholds, medals, PB grid, live splits, sector table | 06-01, 06-03, 06-04, 06-05 |
| REQUIREMENTS | NAV-02 | 06-01, 06-04, 06-05 |
| REQUIREMENTS | MEDAL-01 | 06-01, 06-03, 06-04, 06-05 |
| REQUIREMENTS | MEDAL-02 | 06-02, 06-05 |
| REQUIREMENTS | MEDAL-03 | 06-01, 06-03, 06-04, 06-05 |
| REQUIREMENTS | MEDAL-04 | 06-01, 06-04, 06-05 |
| RESEARCH | SimClock-only timing and no wall-clock HUD timing | 06-01, 06-04 validation |
| RESEARCH | strict reference content and handling lock | 06-03 |
| RESEARCH | versioned hostile-input persistence | 06-02, 06-05 |
| RESEARCH | coordinator event boundary and minimal DOM surface | 06-04, 06-05 |
| CONTEXT D-01/D-02 | one fixed percentage formula and exact bands | 06-01, 06-03 |
| CONTEXT D-03 | fixed-clock per-course/mode committed references after handling lock | 06-03 checkpoint |
| CONTEXT D-04/D-05/D-06 | first movement, retry lifecycle, frozen completion | 06-01, 06-04 |
| CONTEXT D-07/D-08/D-09 | versioned local PBs, course cards, local-only scope | 06-02, 06-05 |
| CONTEXT D-10/D-11/D-12/D-13 | checkpoint sectors, comparison sources, Circuit laps, shared contract | 06-01, 06-04, 06-05 |
| Out of scope | AI, ghosts, customization, online services, new maps/courses, Getaway | Explicit negative checks in 06-03/06-04/06-05 and no planned files/dependencies |

## Handoff Risks

Phase 5 metadata is stale in the current worktree: `STATE.md` and `ROADMAP.md` do not agree with the four present Phase 5 plans/summaries, and the Phase 5 browser checkpoint remains pending. Phase 6 plan 06-03 therefore blocks reference recording on a fresh browser smoke and handling-baseline confirmation. A failing smoke routes back to Phase 5 rather than allowing stale route behavior to contaminate reference times.
