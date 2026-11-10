# Quick 261110-rdx: Terrain editor lockable roads and re-grade - Summary

**Per-road lock/unlock state (edge id) with a "Re-grade road to terrain" action in the terrain editor, one undo step each, with stale unlocked roads refused at save.**

## Commits (branch tools/road-regrade)
- 1fc7189 test: golden hash of road edits, committed BEFORE any src/tools change (hash 81d74486)
- 9079cf9 feat: lock-state data model, sidecar `unlockedEdgeIds`, undo lock snapshots
- bc0f2a7 feat: lock-aware road mask, `regradeRoads`, `setRoadLock`, split-lock carry
- 1b351f0 feat: editor Lock tool (L), four buttons, overlay, stale-road save guard

## Verification run (real results)
- `npm run typecheck`: clean.
- `npm test`: 155 files, 1998 passed, 1 skipped, 2 todo, 0 failed. All pre-existing tests pass unchanged.
- `npx biome check` on every touched path: clean.
- Golden hash test still passes after all changes, also with an empty unlocked list and an empty free set.
- NOT verified: the browser UI. The Chrome tool cannot reach localhost on this machine, so the editor.ts / index.html wiring is typechecked and linted only. The dispatcher, overlay math and save guard behind it are unit tested.

## Design decisions DD-1..DD-10 as implemented
All ten implemented as written in the plan. Specifics worth knowing:
- DD-1: lock unit is the edge id. `terrain-graph` now returns `splitFrom` (fresh-id piece to parent edge) from `addRoadStroke` and `eraseGraphDisc`; pieces inherit the parent's lock. New stroke edges are locked; removed/replaced edges drop out.
- DD-2: `unlockedEdgeIds?: number[]` in the sidecar, written after `buildings` only when non-empty, strict parse (array, non-negative integers, distinct, existing edge ids), no version bump. All-locked sidecars are byte-identical to before (tested).
- DD-3: stale = any point or end node of an unlocked edge differs from terrain by more than 0.05 m. Save is refused client-side (`save()`, hence Drive here) and in the dev-server PUT (`validateAreaPair` -> `assertGradedRoads`, `terrain-save:` prefix).
- DD-4: Lock on a stale road re-grades first in the same diff.
- DD-5: `StrokeDiff.lock {before, after}`; undo/redo restore heights, graph and lock together.
- DD-6/7/8: `regradeRoads` re-samples terrain, runs the existing `gradeProfile` (vertical curve 15..80 m, banking, pin taper), `levelRoadBand` with a new `hold` option, then `limitSlope` with every non-re-graded road held. Junction pins per DD-8. Graph y is written back from levelled terrain; free node y = terrain sample at the node, and every incident endpoint is set to exactly that value so shared nodes agree.
- DD-9: Lock tool click toggles, Alt+click selects, `L` shortcut. Radius control also shown for the Lock tool (pick tolerance).
- DD-10: new road strokes use the lock-aware mask for their protect/limiter masks.

## Deviations from Plan
1. [Process] Early in Task 1 I edited `src/core/terrain-graph.ts` before the golden commit. I caught it immediately, saved the diff to a scratch patch, reverted the file, wrote and committed the golden test first (1fc7189), and re-applied the patch in Task 2. No src/tools change precedes the golden commit.
2. [Minor] The golden commit (1fc7189) already references `roadVertexMask`'s 5th argument (case 2 of the golden check), so `npm run typecheck` was red at commits 1fc7189 and 9079cf9 and green from bc0f2a7 onward.
3. [Scope] Added tests to `tests/terrain-plugin.test.ts` (not in the plan's file list) for the `validateAreaPair` stale-road rejection.
4. [Helper exports] Test helpers in new test files are not exported (Biome `noExportsInTest`); each test file keeps its own small builders.
5. `ToolResult` gained `lockChanged` and `selectionChanged`; `UndoRedoResult` and `ApplyResult` gained `lockChanged`. Existing tests unaffected.

## Known limitations / notes
- Re-grade uses the preset's own bank cap (DD-6); a highway stroked with a custom bank slider re-grades at the default cap.
- The lock overlay draws the graph centreline (graph y + 0.4 m), so an unlocked road's orange line stays where the graph is, not where the sculpted terrain now is, until it is re-graded.
- A road split by junctions is several edges; Lock tool toggles one edge per click, Lock all / Unlock all / Re-grade all unlocked cover whole roads.
- Bank behaviour on re-grade is covered indirectly (street preset has bank 0 in tests); the banking arithmetic is the shared stroke code.

## Known Stubs
None.

## Threat Flags
None beyond the plan's threat model (T-rdx-01 parse validation and T-rdx-02 server-side stale guard are both implemented and tested).

## Manual checks for the user (npm run dev, open the terrain editor)
1. Load an existing area: all roads draw grey (locked). Sculpt beside and over a road: road height does not change (as before).
2. Press L, click a road: it turns orange and status says Unlocked. Raise a hill over it: the terrain moves under it.
3. Press Save terrain: refused with the "no longer match the terrain" message. Drive here is refused the same way.
4. Alt+click the road (cyan), press Re-grade selected: the road follows the hill, status shows max height change and max grade. Save now succeeds; reload the area: the road is still orange (unlocked).
5. Ctrl+Z: heights, road and lock state go back together; Ctrl+Shift+Z re-applies.
6. Draw a new road crossing a locked road and an unlocked road: the new road is grey; both halves of the crossed unlocked road stay orange.
7. Unlock a road that meets a locked road, sculpt, Re-grade: the locked road's height at the junction does not move.
8. Click a stale unlocked road with the Lock tool: it re-grades and turns grey in one step (one Ctrl+Z undoes both).
9. Lock all / Unlock all toggle every road; each is one undo step.

## Self-Check: PASSED
- Files exist: src/core/terrain-road-lock.ts, tests/terrain-road-lock.test.ts, tests/terrain-road-lock-golden.test.ts.
- Commits 1fc7189, 9079cf9, bc0f2a7, 1b351f0 present in git log.
