---
phase: 10
slug: off-road-stages
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-11-23
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Scope: stages and road routes only. Ramps/structures (D-14 to D-20) moved to Phase 10.1 and get their own validation file.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 5.0.0, environment `node` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm run check` (typecheck + biome + vitest) |
| **Estimated runtime** | ~120 seconds (full suite) |

Known baseline: `tests/demo-hills.test.ts` "respects the max slope over the whole grid (D-03)" fails before this phase. It is the only allowed failure.

---

## Sampling Rate

- **After every task commit:** Run the new/changed test file via `npx vitest run <file>`
- **After every plan wave:** Run `npm run check`
- **Before `/gsd-verify-work`:** Full suite green except the known demo-hills failure
- **Max feedback latency:** 30 seconds per task

---

## Per-Task Verification Map

Filled in by the planner per task. Decision → test file map from research:

| Decision | Behavior | Test Type | Automated Command | File Exists | Status |
|----------|----------|-----------|-------------------|-------------|--------|
| MODE-04 / D-02 | Stage parser round-trip and rejections | unit | `npx vitest run tests/stage.test.ts` | ❌ W0 | ⬜ pending |
| D-03 | Ordered, forward-only plane-crossing gates | unit | `npx vitest run tests/stage-run.test.ts` | ❌ W0 | ⬜ pending |
| D-05 | Respawn at last gate, facing onward, +5 s penalty | unit | `npx vitest run tests/stage-run.test.ts` | ❌ W0 | ⬜ pending |
| D-04/D-06/D-10 | Coordinator: no wrong-way, no-medal timing, splits, empty road graph safe | unit | `npx vitest run tests/stage-coordinator.test.ts` | ❌ W0 | ⬜ pending |
| D-07 | PB per area+stage+class, all classes saved | unit | `npx vitest run tests/stage-persistence.test.ts` | ❌ W0 | ⬜ pending |
| D-08 | `?mode=stage` resolver and legacy-map fallback | unit | `npx vitest run tests/stage-mode.test.ts` | ❌ W0 | ⬜ pending |
| D-09 | Dev API path safety and PUT validation | unit | `npx vitest run tools/terrain-editor/stages-api.test.ts` | ❌ W0 | ⬜ pending |
| D-09/D-11 | Editor pure route ops, caps, undo part | unit | `npx vitest run tools/terrain-editor/stages.test.ts tests/terrain-undo.test.ts` | ❌ W0 / extend | ⬜ pending |
| D-12 | Relaxed `parseCourseData`, optional medals | unit | `npx vitest run tests/course-data.test.ts tests/medal-reference.test.ts` | ✅ update | ⬜ pending |
| D-13 | `nearestRoadNode` empty graph → -1; off-node checkpoints | unit | `npx vitest run tests/route-validation.test.ts tests/navigation.test.ts` | ✅ extend | ⬜ pending |
| heading | YAW/BEARING converters round trip | unit | `npx vitest run tests/heading.test.ts` | ✅ extend | ⬜ pending |
| layering | New `src/core` files stay pure | unit | `npx vitest run tests/layering.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/stage.test.ts`, `tests/stage-run.test.ts`, `tests/stage-persistence.test.ts`, `tests/stage-coordinator.test.ts`, `tests/stage-mode.test.ts`
- [ ] `tools/terrain-editor/stages.test.ts`, `tools/terrain-editor/stages-api.test.ts` (and `paths.test.ts` if absent)
- [ ] Shared fixture: tiny flat `TerrainGrid` + empty `RoadGraph` (pattern: `tests/fixtures/terrain-race-harness.ts`)
- No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-minute stage drive with gates, arrow, timer, splits, results | MODE-04 | Feel and visuals | Author a stage on `demo-hills` in the editor, press Test stage, drive it, restart, respawn at a gate |
| Road route authored in editor and raced | D-11/D-12 | Editor + game round trip | Author a point-to-point and a circuit on a terrain map, race each |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
