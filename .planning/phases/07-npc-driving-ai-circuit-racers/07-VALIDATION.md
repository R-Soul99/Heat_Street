---
phase: 07
slug: npc-driving-ai-circuit-racers
status: draft
nyquist_compliant: false
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
| **Estimated runtime** | ~10 seconds (existing suite is fast, unit-only) |

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
| 07-XX-XX | TBD | TBD | CIRC-02 (SC1: identical physics, rammable/spinnable, nothing writes transforms) | — | AI vehicle built via unmodified `createVehicle()`; AI driver only returns `InputFrame` | unit | `npx vitest run tests/ai-driver.test.ts` | ❌ W0 | ⬜ pending |
| 07-XX-XX | TBD | TBD | CIRC-02 (SC2: fixed pace, no rubber-banding/speed multipliers) | — | `AiDriver`/`RacingLine` never read player state; lap time against Silver-pace target within tolerance when run headlessly | unit (headless sim harness, mirroring `src/physics/telemetry/run.ts`'s pattern) | `npx vitest run tests/racing-line.test.ts` + headless lap-time harness test | ❌ W0 | ⬜ pending |
| 07-XX-XX | TBD | TBD | CIRC-02 (SC3: stuck/flipped/wedged detect-and-recover) | — | `StuckDetector` state transitions on synthetic telemetry sequences | unit | `npx vitest run tests/ai-stuck-detector.test.ts` | ❌ W0 | ⬜ pending |
| 07-XX-XX | TBD | TBD | CIRC-02 (SC4: no oscillation on straights, no corner-cutting through scenery) | — | Pure-pursuit steer output stays within a small band on a synthetic straight; racing line stays within `widthM/2` of centreline everywhere, clear of `DEFECT_COORDINATES` | unit | `npx vitest run tests/racing-line.test.ts tests/ai-driver.test.ts` | ❌ W0 | ⬜ pending |
| 07-XX-XX | TBD | TBD | CIRC-02 (SC5: player medal time unaffected by AI presence) | — | Solo Time Attack composition path unchanged; `createRaceState` single-call-site behavior byte-identical | regression (existing) | `npx vitest run tests/race-state.test.ts tests/medal-timing.test.ts` (must stay green, unmodified expectations) | ✅ existing | ⬜ pending |
| 07-XX-XX | TBD | TBD | D-06 (best finish persisted) | — | Extended `MedalProgressRecord`/persistence round-trips a new `bestFinish` field, corruption-tolerant | unit | `npx vitest run tests/medal-persistence.test.ts` (extended) | ✅ existing, needs extension | ⬜ pending |
| 07-XX-XX | TBD | TBD | D-16 (HUD gap/position/lap) | — | `RaceHud` renders position/lap/gap text from a snapshot | unit (DOM-light, matching `race-hud.ts` test style) | `npx vitest run tests/race-hud.test.ts` | ❌ W0 (no existing file) | ⬜ pending |

*Task IDs and plan/wave assignments will be filled once PLAN.md files exist — the planner should update this map or the gsd-plan-checker will flag it as a gap.*

---

## Wave 0 Requirements

- [ ] `tests/racing-line.test.ts` — racing-line derivation, smoothing-within-`widthM`, curvature/speed-profile math, defect-coordinate avoidance
- [ ] `tests/ai-driver.test.ts` — pure-pursuit steer output, velocity-scaled lookahead, `InputFrame` shape/range compliance
- [ ] `tests/ai-stuck-detector.test.ts` — the 3-state stuck/recover/reset machine on synthetic telemetry
- [ ] `tests/race-hud.test.ts` — does not currently exist; D-16's HUD extension needs its own test file (same DOM-light pattern `race-hud.ts`'s sibling files already use)
- [ ] A headless lap-time harness for calibrating/verifying Silver pace — reuse `src/physics/telemetry/run.ts`'s existing "drive N ticks against a fixed tuning, measure the result" pattern rather than building a new one from scratch

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
