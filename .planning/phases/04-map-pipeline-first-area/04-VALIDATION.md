---
phase: 4
slug: map-pipeline-first-area
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (already installed, project-wide) |
| **Config file** | `vitest.config.ts` (root) — `environment: "node"` already set; no new config needed for `tools/map-compiler/**/*.test.ts`, picked up automatically by the default include glob |
| **Quick run command** | `npx vitest run tools/map-compiler` |
| **Full suite command** | `npm run check` (typecheck + lint + test — the project's standard gate) |
| **Estimated runtime** | ~4-10 seconds scoped, matching Phase 1-3's fast full-suite times |

---

## Sampling Rate

- **After every task commit:** `npx vitest run tools/map-compiler` (scoped, fast)
- **After every plan wave:** `npm run check` (full typecheck+lint+test)
- **Before `/gsd-verify-work`:** Full suite green, plus the human SC1 browser drivability checkpoint
- **Max feedback latency:** ~10 seconds (scoped run)

---

## Per-Task Verification Map

Task IDs are assigned once plans exist (this document is created before planning, per the
`gsd-plan-phase` workflow's Nyquist step). Mapped here by Success Criterion instead of REQ-XX,
since Phase 4 carries no requirement IDs of its own (enabling infrastructure for NAV-03/04/05/06,
P2P-01, CIRC-01/02, GET-01/03 in later phases). The planner should assign real task IDs against
this table when writing PLAN.md files.

| Success Criterion | Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| SC1 (no seams/bumps/wedging — topology) | Junction ribbon+fan geometry is watertight; per-vertex endpoint coincidence at every node | unit | `npx vitest run tools/map-compiler/geometry` | ❌ W0 | ⬜ pending |
| SC1 (no seams/bumps/wedging — human feel) | Actually drivable without judder, in a browser | manual | — human playtest, same pattern as Phase 2/3's SC sign-off steps | N/A — manual by nature | ⬜ pending |
| SC2 (surface carries through, no hand-tagging) | Compiler's surface-mapping table matches `road-graph.v1.md`'s locked enum exactly, throws on unmapped values, real compiled edges resolve to one of the six enum values | unit | `npx vitest run tools/map-compiler/graph/surface-mapping` | ❌ W0 | ⬜ pending |
| SC3 (one-command rebuild, shared source) | End-to-end CLI run against a fixture area produces both `.map.json` + `.glb`; `.map.json` passes the EXISTING `tests/road-graph-schema.test.ts` structural checks | integration | `node tools/map-compiler/cli.ts --area <fixture-id>` then `npx vitest run tests/road-graph-schema.test.ts` against real output | ❌ W0 (compiler); existing schema test already covers output shape | ⬜ pending |
| SC4 (no Google data, correct attribution) | `attribution.osm` exact string match; grep gate extended to cover the new `tools/` directory | unit + existing mechanical gate | `npx vitest run tests/no-google-pipeline.test.ts` (once extended) | ⚠️ Existing file, needs `SCANNED_GLOBS` extension | ⬜ pending |
| SC5 (validator: reachable + pathable, loud failures) | Undirected reachability via `ngraph`; geometry sanity (self-intersection, degenerate points, extreme gradient); non-zero exit + named node/edge ids on failure | unit + integration | `npx vitest run tools/map-compiler/validate` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tools/map-compiler/geometry/ribbon.test.ts` + `junction-fan.test.ts` — covers SC1's topology half
- [ ] `tools/map-compiler/graph/surface-mapping.test.ts` — covers SC2, mirrors `tests/road-graph-schema.test.ts`'s existing `surfaceEnumFromDoc` idiom (parse the doc, don't hardcode the enum) so the two tests can never silently drift apart
- [ ] `tools/map-compiler/validate/validator.test.ts` — covers SC5
- [ ] `tests/no-google-pipeline.test.ts` — extend `SCANNED_GLOBS` and its `import.meta.glob` calls to include `tools/**/*.ts` (an edit to an existing file, not a new one, but a genuine Wave 0 prerequisite for SC4 to mean anything for the new compiler code)
- [ ] `tsconfig.json` — add `"tools"` to `include` — prerequisite for `npm run typecheck` to cover the new tree at all
- [ ] A small, committed fixture OSM+DEM sample (not a live network call) for the SC3 integration test to run offline/deterministically — mirrors `fixtures/road-graph.sample.json`'s existing role

---

## Manual-Only Verifications

| Behavior | Success Criterion | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drivability feel — no invisible seams, floating edges, bumpy junctions, or wedged intersections | SC1 | Requires a human driving the compiled Juliette, GA area in a browser; topology unit tests prove geometric watertightness but not perceived drive feel | Compile the confirmed area, drive every road end to end at the profiler HUD's `?debug` gate, report any seam/bump/wedge by location |
| Junction surface-assignment feel (highest-road-class-wins default, `[ASSUMED]` per research) | SC1/SC2 | A reasoned default, not verified against any external source | Drive across a tarmac/gravel junction and confirm the apron reads as paved, matching real-world intersection paving practice |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — confirmed by gsd-plan-checker: no `MISSING` placeholders in any of the 11 plans
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — confirmed by gsd-plan-checker
- [x] Wave 0 covers all MISSING references (topology, surface-mapping, validator tests; `no-google-pipeline` and `tsconfig.json` extensions; fixture data) — all present in plan 04-01 Task 1/3, 04-03, 04-06
- [x] No watch-mode flags — confirmed by gsd-plan-checker
- [x] Feedback latency < 10s — scoped `vitest run` command, no full-suite requirement per task
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-13 (gsd-plan-checker VERIFICATION PASSED, decision-coverage gate 9/9)
