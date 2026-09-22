# Phase 6: Medals & Time-Attack Loop - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the replay and grading layer for the existing Juliette, GA P2P and Circuit courses: a deterministic run timer, four medal tiers, persistent best times, live checkpoint splits, and a post-run sector breakdown. This phase does not add new courses, AI racers, ghosts, car customization, online leaderboards, or Getaway systems.

</domain>

<decisions>
## Implementation Decisions

### Medal Thresholds
- **D-01:** Use one fixed percentage-band formula for every course rather than hand-authoring unrelated thresholds per level. This keeps medal difficulty comparable and makes re-recording after a handling change predictable.
- **D-02:** Use the designer reference run as the 100% baseline. Default bands are Ace at <=90% of reference, Gold at <=100%, Silver at <=115%, and Bronze at <=135%; slower results receive no medal. Keep the percentages in one documented, versioned tuning contract so they can be re-recorded deliberately after handling changes.
- **D-03:** Reference runs are recorded per course and mode using the fixed simulation clock, with the current shipped handling tune locked before recording. Reference data is content, not a player's saved best time.

### Timer and Attempt Lifecycle
- **D-04:** The run timer starts on first meaningful vehicle movement, not page load. The pre-drive state and any brief setup time do not count.
- **D-05:** The timer is derived from the fixed simulation clock and never from wall-clock frame delta. Respawn keeps the clock running and adds the existing flat retry penalty to the effective run time; restart creates a fresh attempt with zero elapsed time and zero penalty.
- **D-06:** A completed run freezes its final effective time and medal result for the results view. Only a valid completed run can update a saved best.

### Best-Time Persistence and Results Presentation
- **D-07:** Persist best results per stable course ID, storing best effective time, medal, and enough schema/version information for safe future migration. Corrupt or incompatible saved data must be ignored without crashing or wiping unrelated progress.
- **D-08:** Present results as course cards in the level-select/results surface. Each P2P or Circuit card shows the best time, earned medal, and the four threshold times for that course; unavailable results remain visibly unearned rather than being represented by fake zero values.
- **D-09:** Personal bests are local-browser progress only. Do not add accounts, online leaderboards, or cross-device synchronization.

### Splits and Sector Breakdown
- **D-10:** Use checkpoint-to-checkpoint intervals as sectors. A run records each sector's elapsed time and cumulative delta as checkpoints are hit.
- **D-11:** Live split feedback compares the current run against the personal best when one exists; otherwise it compares against the relevant target medal/reference split. The HUD must make the comparison source clear.
- **D-12:** Circuit results expose sectors across laps, preserving lap and checkpoint identity. The post-run table highlights the single slowest sector and includes enough context to locate the corner/interval that cost the most time.
- **D-13:** P2P and Circuit share one pure timing/medal/split contract; mode-specific differences are course metadata and lap labeling, not separate timing rules.

### Claude's Discretion
- Exact persistence schema field names and migration implementation.
- Exact first-movement threshold, provided it is deterministic and does not count stationary setup time.
- Exact HUD placement and typography, while respecting Phase 5's top-right speedometer and bottom-left minimap layout.
- Exact reference-run authoring tool/workflow, provided it produces deterministic committed course data and does not depend on a player's local best.
- Exact audio/visual result feedback, provided it does not obscure the driving or introduce a new narrative system.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and phase scope
- `.planning/ROADMAP.md` — Phase 6 goal, success criteria, dependency on Phase 5, and v2 exclusions.
- `.planning/REQUIREMENTS.md` — NAV-02, MEDAL-01 through MEDAL-04, and the out-of-scope rules for customization, ghosts, online leaderboards, and free roam.
- `.planning/STATE.md` — current project state, known handling-tune caveat, and Phase 5 handoff status.

### Existing race and timing systems
- `src/core/race-state.ts` — current pure P2P/Circuit progression, checkpoint targets, lap state, respawn penalty, and restart semantics.
- `src/gameplay/race-coordinator.ts` — fixed-tick checkpoint integration and presentation snapshot wiring.
- `src/loop.ts` — fixed-timestep simulation clock and command integration point.
- `src/core/sim-clock.ts` — deterministic simulation-time contract used by medal timing.
- `src/hud/race-hud.ts` — existing race HUD placement and presentation conventions.
- `src/hud/minimap.ts` — bottom-left minimap placement and reserved HUD space.
- `public/maps/juliette-ga.routes.json` — stable course IDs, checkpoint order, and Circuit lap metadata.

### Persistence and validation precedent
- `src/core/vehicle-tuning.ts` — parse-or-default localStorage validation pattern.
- `src/core/tuning-snapshot.ts` — versioned structured persistence/export pattern.
- `tests/determinism.test.ts` — fixed-step reproducibility expectations.
- `tests/race-state.test.ts` — pure race progression and restart/respawn behavior coverage.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SimClock.simTimeSec` and the fixed-tick loop provide the authoritative run-time source.
- `RaceState.effectiveTimeSec`, `penaltySec`, `restart()`, and `RaceSnapshot` already expose the retry semantics Phase 6 should extend rather than duplicate.
- `RaceCoordinator.onTickEnd()` is the existing checkpoint event boundary where timing samples and split events can be captured.
- The existing DOM HUD pattern can add timer, split, and result surfaces without putting text into the WebGL scene.

### Established Patterns
- Pure core contracts are tested without Three.js, Rapier, DOM, or wall-clock state.
- Untrusted localStorage is parsed through explicit schema validation and falls back safely.
- Fixed-step determinism is a project-level requirement; no Phase 6 timer may read `Date.now()`, `performance.now()`, or render delta.
- Phase 5's instant restart resets race state and vehicle state in place, so Phase 6 must reset attempt timing in the same command path.

### Integration Points
- Course IDs from the route sidecar are the persistence keys and reference-time keys.
- The race coordinator must emit or expose checkpoint completion events for split recording.
- The final race snapshot needs a completed result path consumed by the results/medal HUD.
- The level-select surface is not yet a standalone screen; planning should decide whether to introduce a minimal course-results view around the existing entry point without expanding into a full menu system.

</code_context>

<specifics>
## Specific Ideas

- The medal opponent is the designer reference time and then the player's own best, never an AI racer or configurable car build.
- Slow sectors should point back to a concrete checkpoint interval so the player knows which corner or stretch cost the run.
- Existing Phase 5 course IDs and checkpoint identities should remain stable so saved bests survive content-only UI changes.
- The current hand-tuned vehicle values are intentionally subject to future adjustment; reference runs must be re-recorded after a handling change rather than silently compared against stale times.

</specifics>

<deferred>
## Deferred Ideas

- Ghost-car playback remains a v2 requirement and is explicitly excluded from this phase.
- Online leaderboards, accounts, and cross-device synchronization remain out of scope.
- Additional courses, maps, cars, and configurable tuning/customization remain out of scope.

</deferred>

---

*Phase: 06-medals-time-attack-loop*
*Context gathered: 2026-09-21*
