---
phase: 07
slug: npc-driving-ai-circuit-racers
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-09-22
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 [VERIFIED: package.json] |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/<new-file>.test.ts` |
| **Full suite command** | `npm run test` (= `vitest run`); `npm run check` runs typecheck + lint + test |
| **Estimated runtime** | Quick run (single non-sim test file): ~10 seconds. Full suite: well above the ~10s unit-test baseline — `tests/ai-lap.test.ts` (07-01, 120000ms timeout) and `tests/ai-field.test.ts` (07-03, 180000ms timeout) are headless full-lap/field physics-sim outliers over real map data, up to 2-3 min worst case each |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test files>`
- **After every plan wave:** Run `npm run test` (full suite)
- **Before `/gsd-verify-work`:** `npm run check` (typecheck + lint + full suite) must be green, plus the human browser checkpoint(s) this phase's plan should schedule for feel-tuning (stuck thresholds, avoidance feel, Silver-pace calibration — none of these are meaningfully verifiable by automated test alone, matching this project's own established pattern for vehicle-feel work in Phases 2/3)
- **Max feedback latency:** ~10 seconds (per-file vitest run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | CIRC-02 (SC1 e2e lap, heading conventions) | T-07-02 | Shared yaw/bearing helpers; failing headless lap test written first | unit + e2e (RED) | `npx vitest run tests/heading.test.ts tests/race-coordinator.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-01-02 | 01 | 1 | CIRC-02 (SC4 no corner-cutting) | T-07-01 | Racing line within widthM/2 - margin, on centreline near DEFECT_COORDINATES, braking-feasible, grid poses face down-course | unit | `npx vitest run tests/racing-line.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-01-03 | 01 | 1 | CIRC-02 (SC1, SC2, SC4) | T-07-02, T-07-04 | AI via unmodified createVehicle(), InputFrames only; no player/placement reads (source guard); one lap within ±6% of Silver lap 161 s; quiet straights | unit + headless sim | `npx vitest run tests/ai-driver.test.ts tests/ai-lap.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-02-01 | 02 | 2 | CIRC-02 (D-01..D-04) | T-07-06 | Countdown/hold frame (brake 0, no reverse), coordinator contract incl. SC5 source guard | unit | `npx vitest run tests/race-start.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-02-02 | 02 | 2 | CIRC-02 (SC5, D-04, D-08) | T-07-06 | N-racer coordinator never imports medal-timing/persistence | unit | `npx vitest run tests/circuit-race-coordinator.test.ts tests/race-coordinator.test.ts` | ❌ W0 (created in 07-02-01) | ⬜ pending |
| 07-02-03 | 02 | 2 | CIRC-02 (D-02 paints, mode wiring) | T-07-05, T-07-07 | AI meshes in the shared scene (no extra Scene); `?mode=` exact-match | unit + build | `npx vitest run tests/ai-vehicle-view.test.ts && npm run typecheck && npm run build` | ❌ W0 (created by task) | ⬜ pending |
| 07-03-01 | 03 | 2 | CIRC-02 (D-10) | T-07-09 | Avoidance is throttle-only: never steers or brakes | unit | `npx vitest run tests/ai-driver.test.ts` | ✅ (from 07-01) | ⬜ pending |
| 07-03-02 | 03 | 2 | CIRC-02 (D-10) | T-07-10, T-07-11 | castRay probe sees chassis only, never itself | unit (headless Rapier) | `npx vitest run tests/ai-avoidance.test.ts tests/ai-lap.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-03-03 | 03 | 2 | CIRC-02 (SC1, SC2) | T-07-09 | 3-AI field laps the real map, no flips/deadlock | headless sim | `npx vitest run tests/ai-field.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-04-01 | 04 | 3 | CIRC-02 (D-13 same reset rule) | T-07-14 | Reset pose faces down-course (yaw convention); snapBody range-checked | unit | `npx vitest run tests/checkpoint-pose.test.ts tests/transform-cache.test.ts tests/determinism.test.ts` | ❌ W0 / ✅ existing | ⬜ pending |
| 07-04-02 | 04 | 3 | CIRC-02 (SC3) | T-07-12 | Stuck/flip/no-progress detection with hysteresis and camera-aware deferral | unit | `npx vitest run tests/ai-stuck-detector.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-04-03 | 04 | 3 | CIRC-02 (SC3, D-13) | T-07-12, T-07-13 | Reset charges RaceState.respawn() 5 s; never onto another car | unit | `npx vitest run tests/circuit-race-coordinator.test.ts` | ✅ (from 07-02) | ⬜ pending |
| 07-05-01 | 05 | 4 | CIRC-02 (SC4, D-15) | T-07-16, T-07-17 | Overlay pure label/geometry; textContent only; no internal gate | unit | `npx vitest run tests/ai-debug-overlay.test.ts tests/circuit-race-coordinator.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-05-02 | 05 | 4 | CIRC-02 (D-15) | T-07-15 | Overlay only constructed under DEBUG_ENABLED, KeyI | build + layering | `npm run typecheck && npm run build && npx vitest run tests/layering.test.ts` | ✅ | ⬜ pending |
| 07-05-03 | 05 | 4 | CIRC-02 (SC3, SC4, D-10, D-12, frame budget) | — | Human feel session | manual (checkpoint) | `npm run check` after any retune | — | ⬜ pending |
| 07-06-01 | 06 | 5 | CIRC-02 (D-16 placing/gap) | T-07-19 | Leg-bounded progress, standings, time-based gaps | unit | `npx vitest run tests/race-placement.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 07-06-02 | 06 | 5 | CIRC-02 (D-14, D-16) | T-07-20 | HUD status format; minimap racer markers | unit | `npx vitest run tests/race-hud.test.ts tests/minimap.test.ts` | ❌ W0 (race-hud.test.ts new) / ✅ minimap | ⬜ pending |
| 07-06-03 | 06 | 5 | CIRC-02 (D-14, D-16) | T-07-19 | Placing never flows into AI control | unit | `npx vitest run tests/circuit-race-coordinator.test.ts` | ✅ | ⬜ pending |
| 07-07-01 | 07 | 6 | CIRC-02 (D-06 persistence) | T-07-22, T-07-23, T-07-24 | bestFinish range-validated in the same v1 envelope; cross-mode saves preserve each other | unit | `npx vitest run tests/medal-persistence.test.ts tests/race-placement.test.ts tests/results-view.test.ts` | ✅ existing, extended | ⬜ pending |
| 07-07-02 | 07 | 6 | CIRC-02 (D-05, D-07, SC5) | T-07-25 | Exactly-once classification/save under `<id>.race`; solo medal path untouched | unit + build | `npx vitest run tests/circuit-race-coordinator.test.ts tests/race-coordinator.test.ts tests/medal-timing.test.ts && npm run build` | ✅ | ⬜ pending |
| 07-07-03 | 07 | 6 | CIRC-02 (D-09 Silver pace, SC5) | — | End-of-phase human sign-off | manual (checkpoint) | `npm run check` | — | ⬜ pending |

*Map filled by the planner from 07-01..07-07-PLAN.md. Wave 0 test files are created inside the tasks listed (TDD: test first). The two manual rows are blocking checkpoints; every auto task has an automated command.*

---

## Wave 0 Requirements

- [ ] `tests/racing-line.test.ts` — racing-line derivation, smoothing-within-`widthM`, curvature/speed-profile math, defect-coordinate avoidance
- [ ] `tests/ai-driver.test.ts` — pure-pursuit steer output, velocity-scaled lookahead, `InputFrame` shape/range compliance
- [ ] `tests/ai-stuck-detector.test.ts` — the 3-state stuck/recover/reset machine on synthetic telemetry
- [ ] `tests/race-hud.test.ts` — does not currently exist; D-16's HUD extension needs its own test file (same DOM-light pattern `race-hud.ts`'s sibling files already use)
- [ ] A headless lap-time harness for calibrating/verifying Silver pace: `tests/ai-lap.test.ts` (07-01-01) and `tests/ai-field.test.ts` (07-03-03), reusing `src/physics/telemetry/run.ts`'s throwaway-world pattern
- [ ] `tests/heading.test.ts`, `tests/race-start.test.ts`, `tests/circuit-race-coordinator.test.ts`, `tests/ai-vehicle-view.test.ts`, `tests/ai-avoidance.test.ts`, `tests/checkpoint-pose.test.ts`, `tests/ai-debug-overlay.test.ts`, `tests/race-placement.test.ts` (created by their tasks)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| AI steering feel / no visible oscillation on straights in the actual browser render | SC4 | Lookahead-gain and `aLatMax` tuning constants are feel parameters — a passing unit test on synthetic curvature data does not guarantee the in-browser feel is oscillation-free | Load `?debug`, watch all 4 AI racing lines + steer values live on the `juliette-three-lap-loop` circuit for at least 2 full laps; confirm no visible steering chatter on the long straights |
| Stuck/flipped/wedged recovery thresholds and drive-out feel | SC3, D-13 | Exact numeric thresholds (time-near-zero-velocity, up-vector inversion angle, drive-out duration) are a feel-tuning task, not derivable from research | Deliberately wedge/flip an AI car (e.g. ram it into scenery) and confirm it attempts drive-out, then resets to last checkpoint if still stuck, preferably off-camera |
| Silver-pace calibration against a clean human Silver-level drive | D-09 | Confirms AI lap time is genuinely "beatable by clean Silver, beats messy" — not just numerically close to the reference split in isolation | Drive a clean Silver-band lap and a deliberately messy lap; confirm AI finishes between them |
| Avoidance feel (mild avoidance, not blocking/defending) | D-10 | "Feels like mild avoidance, not defensive blocking" is a subjective read on live AI-vs-player contact, not something a unit test on a forward-raycast slowdown value can confirm | Deliberately drive alongside/behind AI cars and confirm they nudge away from rear-ending but do not swerve to block passing |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
