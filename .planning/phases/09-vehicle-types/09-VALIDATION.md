---
phase: 9
slug: vehicle-types
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-11-22
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 5.0.0 (`environment: node`, Rapier inlined via `server.deps.inline`) |
| **Config file** | `vitest.config.ts` (dossier: `vitest.dossier.config.ts`) |
| **Quick run command** | `npx vitest run tests/vehicle-rwd-golden.test.ts tests/vehicle-class.test.ts tests/vehicle-tuning.test.ts` |
| **Full suite command** | `npm run check` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run the golden test plus the touched module's test file
- **After every plan wave:** Run `npm run check`
- **Before `/gsd-verify-work`:** Full suite must be green, golden test unmodified, rwd feel-dossier output identical to the stage 0 capture
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled in by the planner/executor per task. Requirement-level map:

| Req / SC | Behavior | Test Type | Automated Command | File Exists | Status |
|----------|----------|-----------|-------------------|-------------|--------|
| SC2 / D-09 | rwd/fwd/awd end state on fixed tape unchanged (flat + painted-surface run) | golden | `npx vitest run tests/vehicle-rwd-golden.test.ts` | ❌ W0 | ⬜ pending |
| VEH-06 | `resolveVehicleClassId` accepts 4 new ids, rejects hostile values | unit | `npx vitest run tests/vehicle-class.test.ts` | ✅ (update) | ⬜ pending |
| VEH-06 | `classTuningRanges`: existing ids return `TUNING_RANGES` by reference; defaults/shipped inside own ranges | unit | `npx vitest run tests/vehicle-class.test.ts` | ✅ (extend) | ⬜ pending |
| VEH-06 | `clampTuning`/`parseSavedTuning` default behaviour unchanged; blob without `rear` gains no `rear` key | unit | `npx vitest run tests/vehicle-tuning.test.ts tests/tuning-persist.test.ts` | ✅ (extend) | ⬜ pending |
| VEH-07 | `wheels.rear` override: absent → front values; present → rear wheels differ; hostile values clamped | unit | `npx vitest run tests/vehicle-tuning.test.ts` | ✅ (extend) | ⬜ pending |
| VEH-07 | `surfaceGripScale` < 1 lowers skidpad g; all-ones identical | integration | `npx vitest run tests/surface-grip-scale.test.ts` | ❌ W0 | ⬜ pending |
| SC4 | Per-vehicle 0-60 (±15%), settle < 2 s, tilt, no wheel lift on flat | integration | `npx vitest run tests/vehicle-types-targets.test.ts` | ❌ W0 | ⬜ pending |
| SC3 | Monster spike result written | doc | `test -f .planning/plans-ahead/03-monster-spike-result.md` | ❌ W0 | ⬜ pending |
| SC1 | Storage keys unique; colours distinct from `AI_PAINTS` | unit | `npx vitest run tests/vehicle-class.test.ts` | ✅ (extend) | ⬜ pending |
| Docs | Every bound panel control named in tuning guide | unit | `npx vitest run tests/tuning-guide-sync.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/vehicle-rwd-golden.test.ts` — literals recorded from the untouched tree before any source change
- [ ] `runRoutine` options (`frontDriveShare`, `spawnY`) with byte-identical default call
- [ ] `tests/vehicle-types-targets.test.ts` — per-class target measurement (read `.value`, not muscle-car `.pass`)
- [ ] Skidpad scale test for `surfaceGripScale`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Each new vehicle feels distinct | SC4 | Feel is subjective | Drive each `?car=` for one minute on `?map=feel-test` |
| Muscle car unchanged | SC2 | Confirms golden test in play | Drive `?car=rwd` briefly on `?map=feel-test` |
| User reads spike result before stages 7-8 | SC3 / D-10 | Human gate | Read `.planning/plans-ahead/03-monster-spike-result.md`, approve continuing |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
