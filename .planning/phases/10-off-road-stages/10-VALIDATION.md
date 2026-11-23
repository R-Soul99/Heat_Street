---
phase: 10
slug: off-road-stages
status: approved-automated
nyquist_compliant: true
wave_0_complete: true
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

Filled by the planner (2026-11-23). Every task has an automated command; no 3 consecutive tasks lack one.

| Plan-Task | Wave | Decision | Behavior | Test Type | Automated Command | File Exists | Status |
|-----------|------|----------|----------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 1 | MODE-04 / D-01 / D-02 / D-06 | Stage parser round trip and every rejection; classifyStageMedal; drafts | unit | `npx vitest run tests/stage.test.ts tests/layering.test.ts` | ❌ W0 (created in task) | ✅ green |
| 10-01-T2 | 1 | heading | YAW/BEARING converters round trip; schema doc | unit | `npx vitest run tests/heading.test.ts` | ✅ extend | ✅ green |
| 10-02-T1 | 1 | D-03 / D-04 / D-05 | Ordered, forward-only plane crossing (0/45/90 deg, reverse, sideways slide, height window), respawn pose, penalty, reset; RaceSnapshot "stage" | unit | `npx vitest run tests/stage-run.test.ts tests/layering.test.ts && npx tsc --noEmit` | ❌ W0 | ✅ green |
| 10-02-T2 | 1 | D-07 | PB per area+stage+class, merge only improves, bad data dropped, quota safe | unit | `npx vitest run tests/stage-persistence.test.ts` | ❌ W0 | ✅ green |
| 10-03-T1 | 1 | D-12 | parseCourseData 0..20 routes, relaxed counts/laps, start x/z, serializer | unit | `npx vitest run tests/course-data.test.ts tests/medal-reference.test.ts tests/route-validation.test.ts` | ✅ update | ✅ green |
| 10-03-T2 | 1 | D-13 | RouteDraft -> Course with nearest node/edge; back | unit | `npx vitest run tests/route-draft.test.ts` | ❌ W0 | ✅ green |
| 10-03-T3 | 1 | D-13 | nearestRoadNode empty -> -1; authored validation; Juliette-only defects; partial medals | unit | `npx vitest run tests/navigation.test.ts tests/route-validation.test.ts tests/medal-reference.test.ts` | ✅ extend | ✅ green |
| 10-04-T1 | 2 | D-03 / D-04 / D-06 / D-10 | Coordinator: gate sectors, PB split deltas, one completion, no wrong-way, no navigation import | unit | `npx vitest run tests/stage-coordinator.test.ts` | ❌ W0 | ✅ green |
| 10-04-T2 | 2 | D-05 | Restart / respawn, penalty counted once | unit | `npx vitest run tests/stage-coordinator.test.ts` | ❌ W0 | ✅ green |
| 10-05-T1 | 2 | UI-SPEC E | Stage status, PB, thresholds formatters; split flash | unit | `npx vitest run tests/race-hud.test.ts` | ✅ extend | ✅ green |
| 10-05-T2 | 2 | D-06 | Stage results lines, no medal row / UNEARNED when no medals | unit | `npx vitest run tests/results-view.test.ts` | ✅ extend | ✅ green |
| 10-05-T3 | 2 | D-10 | Gate view: 3 draw calls, next/dim/passed/finish/editor modes | unit | `npx vitest run tests/stage-view.test.ts` | ❌ W0 | ✅ green |
| 10-06-T1 | 2 | D-09 | resolveRouteFile path safety | unit | `npx vitest run tools/terrain-editor/paths.test.ts` | ❌ W0 | ✅ green |
| 10-06-T2 | 2 | D-09 / D-12 | PUT validators (parser messages, areaId), 400 classification | unit | `npx vitest run tools/terrain-editor/stages-api.test.ts` | ❌ W0 | ✅ green |
| 10-07-T1 | 2 | D-09 / D-11 | Pure stage ops, caps, rows, length, warnings | unit | `npx vitest run tools/terrain-editor/stages.test.ts` | ❌ W0 | ✅ green |
| 10-07-T2 | 2 | D-11 / D-12 | Pure route ops, caps, rows | unit | `npx vitest run tools/terrain-editor/route-ops.test.ts` | ❌ W0 | ✅ green |
| 10-07-T3 | 2 | undo | stages/routes undo parts, commitStages/commitRoutes, never in sidecar | unit | `npx vitest run tests/terrain-undo.test.ts tools/terrain-editor/tool-dispatch.test.ts` | ✅ extend | ✅ green |
| 10-08-T1 | 3 | D-08 | `?mode=stage` / `?stage=` resolver and fallbacks | unit | `npx vitest run tests/stage-mode.test.ts` | ❌ W0 | ✅ green |
| 10-08-T2 | 3 | MODE-04 / D-05..D-08 | main.ts stage composition | typecheck + suite | `npx tsc --noEmit` then `npm run check` | n/a | ✅ green |
| 10-09-T1 | 3 | D-09 | Place entry 8, test URLs | unit | `npx vitest run tools/terrain-editor/rail-tools.test.ts tools/terrain-editor/drive-url.test.ts` | ✅ extend | ✅ green |
| 10-09-T2 | 3 | D-09 / D-11 | Route tool module (stage kind) | typecheck + lint | `npx tsc --noEmit && npx biome check tools/terrain-editor/route-tool.ts` | n/a | ✅ green |
| 10-10-T1 | 4 | D-09 | Editor hosting: dispatch, keys | typecheck + editor tests | `npx tsc --noEmit && npx vitest run tools/terrain-editor` | n/a | ✅ green |
| 10-10-T2 | 4 | D-09 | Load/save/undo/sculpt hooks | typecheck + suite | `npx vitest run tools/terrain-editor` then `npm run check` | n/a | ✅ green |
| 10-11-T1 | 4 | D-12 | `?route=` selection; race coordinator without reference | unit | `npx vitest run tests/route-select.test.ts tests/race-coordinator.test.ts` | ❌ W0 / ✅ extend | ✅ green |
| 10-11-T2 | 4 | D-12 / D-13 | main.ts N routes, optional medals, soft validation, route spawn | typecheck + suite | `npx tsc --noEmit` then `npm run check` | n/a | ✅ green |
| 10-12-T1 | 5 | D-11 / D-12 / D-13 | Road kinds in the Route tool | typecheck + editor tests | `npx tsc --noEmit && npx vitest run tools/terrain-editor tests/route-draft.test.ts` | n/a | ✅ green |
| 10-12-T2 | 5 | brief stage 8 | docs/stages.md | content check | `node -e` key-string check (see plan) | n/a | ✅ green |
| 10-13-T1 | 6 | gate | Full suite | suite | `npm run check` | n/a | ✅ green |
| 10-13-T2 | 6 | MODE-04 | Human check | manual | see Manual-Only | n/a | ⬜ pending |
| all | - | layering | New `src/core` files stay pure | unit | `npx vitest run tests/layering.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/stage.test.ts`, `tests/stage-run.test.ts`, `tests/stage-persistence.test.ts`, `tests/stage-coordinator.test.ts`, `tests/stage-mode.test.ts`
- [x] `tools/terrain-editor/stages.test.ts`, `tools/terrain-editor/stages-api.test.ts` (and `paths.test.ts` if absent)
- [x] Shared fixture: tiny flat `TerrainGrid` + empty `RoadGraph` (pattern: `tests/fixtures/terrain-race-harness.ts`)
- No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-minute stage drive with gates, arrow, timer, splits, results | MODE-04 | Feel and visuals | Author a stage on `demo-hills` in the editor, press Test stage, drive it, restart, respawn at a gate |
| Road route authored in editor and raced | D-11/D-12 | Editor + game round trip | Author a point-to-point and a circuit on a terrain map, race each |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** automated gate green 2026-11-23 (3015 pass; only the baseline demo-hills D-03 failure). Human check (10-13-T2) pending.
