---
phase: 04-map-pipeline-first-area
plan: 06
subsystem: infra
tags: [ngraph, ngraph.graph, ngraph.path, validation, build-gate, map-compiler]

# Dependency graph
requires:
  - phase: 04-map-pipeline-first-area (plan 04-03)
    provides: buildRoadGeometry / RoadGeometry (src/core/road-geometry.ts) — the ribbon/junction
      geometry the self-intersection check validates
  - phase: 04-map-pipeline-first-area (plan 04-05)
    provides: real elevation-applied RoadGraph and the committed public/maps/juliette-ga.map.json
      artifact this plan validates
provides:
  - tools/map-compiler/validate/validator.ts — validateGraph/formatValidationFailures,
    independent named checks (referential integrity, undirected reachability, directed
    oneway-honouring pathability via ngraph.path aStar, geometry sanity), never short-circuiting
  - The validator wired as a build gate in tools/map-compiler/cli.ts between applyElevation and
    the artifact write (D-P18) — a failing map is never written
  - A --no-validate diagnosis-only escape hatch
  - Real-artifact proof: the committed juliette-ga map passes with zero failures, and a paired
    negative test proves the gate is not trivially green
affects: [phase-05-navigation-substrate, phase-07-ai-pursuit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validators are lists of independent named check functions, each returning their OWN
      failures with a single terminal return, concatenated (never short-circuited) by a top-level
      validateGraph — a new check is an addition, not an edit to a monolith"
    - "A build gate runs BETWEEN the last data-mutation stage and the artifact write, never after
      — a failing build must never leave a partial or stale artifact on disk"
    - "Real-artifact test suites (tests/compiled-map.test.ts) get a positive assertion against the
      committed output AND a paired negative case that mutates real data to prove the check is not
      trivially green"

key-files:
  created:
    - tools/map-compiler/validate/validator.ts
    - tools/map-compiler/validate/validator.test.ts
  modified:
    - tools/map-compiler/cli.ts
    - tests/compiled-map.test.ts

key-decisions:
  - "D-P17 (reachability checked twice, undirected and directed) and D-P18 (validator is a build
    gate, not a report) — both already decided in the plan, implemented as specified"
  - "The validation gate runs after the self-check parseRoadGraph call (schema conformance) but
    before mkdir/writeFile (artifact write) — schema validation and topology/geometry validation
    are kept as two distinct, independently-failing stages"
  - "--no-validate is argv-gated with no environment-variable equivalent, and prints a warning
    containing its own flag name (T-04-24) — grep-able proof it can never silently ship in a
    committed script"

patterns-established:
  - "printValidationSummary in cli.ts mirrors printBuildReport/printElevationReport's existing
    convention (a report-printing function per pipeline stage, called from main), rather than
    inlining console output at the call site"

requirements-completed: [SC5, SC3]

# Metrics
duration: 45min
completed: 2026-09-14
---

# Phase 04 Plan 06: Reachability/Pathability/Geometry Validator as a Build Gate Summary

**A build gate that proves every road in the compiled Juliette, GA map is reachable and pathable honouring oneway, proves the graph is consumable by ngraph.path with zero adaptation, and refuses to write an artifact on any failure — verified against real data in both directions with zero code changes needed to make the real map pass.**

## Performance

- **Duration:** ~45 min (this session; Task 1 was completed and committed in a prior, separately-tracked session)
- **Started:** 2026-09-14 (this session, Task 2 only)
- **Completed:** 2026-09-14T18:41Z
- **Tasks:** 2 (Task 1 pre-committed before this session; Task 2 executed this session)
- **Files modified:** 4 total (2 created by Task 1, 2 modified by Task 2)

## Accomplishments

- `validateGraph`/`formatValidationFailures` (Task 1, already committed) implement referential
  integrity, undirected reachability, directed oneway-honouring pathability (via a real
  `ngraph.path` `aStar.find` call), and four geometry-sanity checks — every failure named by
  category and node/edge id, never a bare boolean.
- `tools/map-compiler/cli.ts` now runs `buildRoadGeometry` + `validateGraph` as a hard gate
  between `applyElevation` and the artifact write: any failure prints the full failure list plus
  a per-category summary to stderr and exits non-zero **without writing an artifact**.
- The real committed `public/maps/juliette-ga.map.json` passes the gate with **zero failures on
  the first run** — the regenerated artifact is byte-identical (verified by SHA-256) to the
  already-committed one, confirming the gate adds no side effects to a clean build.
- `tests/compiled-map.test.ts` gained a positive real-artifact assertion (`formatValidationFailures`
  is the empty string) and a paired negative case that deletes a real edge from the real graph to
  disconnect a genuine dead-end node (id 18), asserting the gate reports a failure naming that
  node — proving the gate is not trivially green against real data, in both directions.
- Manually proved (not part of the automated suite, per the plan's own "demonstrate ... record the
  observed output in the SUMMARY" instruction) that a deliberately broken compile exits non-zero
  and leaves the committed artifact byte-unchanged on disk. See "Deliberately Broken Compile
  Demonstration" below for the full transcript and methodology.

## Task Commits

Each task was committed atomically:

1. **Task 1: Reachability, oneway pathability and geometry sanity, with failures named by id** -
   `87549bd` (feat) — completed and committed in a prior session before this executor was spawned;
   rescued from an interrupted prior run, verified (28/28 validator tests passing, typecheck
   clean, acceptance criteria spot-checked) and committed. Not re-done in this session.
2. **Task 2: Wire the validator as a build gate and prove it blocks a real broken map** - `e9ad17f`
   (feat) — this session's work.

**Plan metadata:** (this commit, after final review)

## Files Created/Modified

- `tools/map-compiler/validate/validator.ts` — (Task 1, pre-existing) `validateGraph` /
  `formatValidationFailures`; seven independent checks concatenated, never short-circuited.
- `tools/map-compiler/validate/validator.test.ts` — (Task 1, pre-existing) hand-authored graphs
  proving every `<behavior>` bullet.
- `tools/map-compiler/cli.ts` — (Task 2, this session) imports `buildRoadGeometry` and
  `validateGraph`/`formatValidationFailures`; adds `printValidationSummary`; inserts the gate
  between the self-check `parseRoadGraph` call and the `mkdir`/`writeFile` artifact write; adds
  the `--no-validate` escape hatch; updates the module header's pipeline-stage comment.
- `tests/compiled-map.test.ts` — (Task 2, this session) two new `it()` blocks: a positive
  zero-failures assertion against the real artifact, and a paired negative case mutating the real
  graph to disconnect node 18.

## Decisions Made

- The validation gate is placed after the existing self-check `parseRoadGraph(JSON.stringify(elevatedGraph), ...)`
  call rather than replacing or merging with it — schema conformance (parseRoadGraph) and
  topology/geometry validation (`validateGraph`) are orthogonal concerns with independent failure
  modes, and keeping them as two distinct stages makes a future failure's cause unambiguous from
  which stage's log line fired.
- `printValidationSummary` follows the existing `printBuildReport`/`printElevationReport`
  convention already established in `cli.ts` (a dedicated report-printing function per pipeline
  stage, invoked from `main`) rather than inlining `console.log`/`console.error` calls at the
  gate's call site — keeps the stage-report style consistent across the whole file.
- Chose node id 18 (a real degree-1/dead-end node in the committed artifact, reached only via edge
  34) for the paired negative test, rather than node id 0. Node 0 is the validator's own BFS/aStar
  root (`graph.nodes[0].id`); disconnecting the root's only edge would have flagged nearly every
  other node as unreachable rather than isolating a single named node, which would not have
  demonstrated the "names the offending node" behaviour as cleanly. The test defensively
  re-verifies both assumptions (edge 34 touches node 18, and no other edge touches node 18) before
  mutating, so it fails loudly rather than passing vacuously if the compiled artifact's topology
  ever changes upstream.

## Deviations from Plan

None — plan executed exactly as written. The validation gate location, `--no-validate` flag
behaviour, real-artifact test additions, and the demonstration of a blocked broken compile all
match the plan's `<action>` and `<acceptance_criteria>` verbatim.

## Deliberately Broken Compile Demonstration

Per the plan's acceptance criterion ("demonstrate ... confirm `public/maps/juliette-ga.map.json`
is unchanged on disk, then restore; record the observed output in the SUMMARY"), the following was
done and then fully reverted before the Task 2 commit:

1. Hashed the committed artifact: `sha256(public/maps/juliette-ga.map.json) =
   d5d22f89485b2b3ddaf03b1a95bdfa918c6e11c7b9846f5e906089c81247b7a2`.
2. Temporarily inserted an env-var-gated hook (`HEAT_STREET_DEBUG_BREAK_EDGE=1`) into `cli.ts`
   right after `printElevationReport`, deleting edge id 34 (the same dead-end-disconnecting edge
   used in the paired negative test) from the elevated graph before it reached `buildRoadGeometry`/
   `validateGraph`/the write.
3. Ran `HEAT_STREET_DEBUG_BREAK_EDGE=1 npm run compile-map -- --area juliette-ga`. Observed output:
   ```
   REFERENTIAL_INTEGRITY node 18: is not referenced by any edge
   UNDIRECTED_REACHABILITY node 18: is not reachable (undirected) from root node 0
   DIRECTED_PATHABILITY node 18: cannot be reached (directed, honouring oneway) from root node 0
   DIRECTED_PATHABILITY node 18: cannot reach root node 0 (directed, honouring oneway) — entered only through a one-way edge with no way back
     validation: FAILED — 4 failure(s) (REFERENTIAL_INTEGRITY:1, UNDIRECTED_REACHABILITY:1, DIRECTED_PATHABILITY:2)
   compile-map: ABORTED — validation failed with 4 failure(s). No artifact written.
   ```
4. Confirmed the process's real exit code was `1` (captured directly, not through a pipe to
   `tail`, which masks the upstream exit code).
5. Re-hashed the artifact on disk: identical
   `d5d22f89485b2b3ddaf03b1a95bdfa918c6e11c7b9846f5e906089c81247b7a2` — confirmed byte-unchanged.
6. Fully reverted the temporary hook (both the injection block and its two call-site references)
   before making any commit. Confirmed with `grep -n "HEAT_STREET_DEBUG_BREAK_EDGE"
   tools/map-compiler/cli.ts` returning no matches, and `git diff` showing no trace of the hook in
   the final `cli.ts`.

This is the best possible evidence the gate works: it caught a real disconnection on its first
genuinely broken input, naming the exact node across three independent check categories, and left
no artifact-write side effect.

## Issues Encountered

None. The real committed map passed validation with zero failures on the first attempt — no
pruning-stub or ribbon-fold defect needed fixing, unlike the plan's own anticipated failure modes
("most likely on connectivity where the bbox cut left a stub... or on a ribbon fold at a genuinely
sharp OSM corner"). Plan 04-04's pruning and 04-03's miter clamp were already doing their job
correctly on this area.

One pre-existing, out-of-scope issue was found and left untouched per the Scope Boundary rule:
`npm run check`'s Biome lint step reports 4 formatting/organize-imports errors in
`tools/map-compiler/validate/validator.ts` and `validator.test.ts` (Task 1's files, committed in
`87549bd` before this session began). Confirmed via `git stash` + a clean re-check against the
base commit that these errors pre-date any Task 2 change and are not caused by this plan's work.
Logged here rather than fixed, since Task 1 is out of this session's scope; a caretaker should run
`npx biome check --write tools/map-compiler/validate/` in a follow-up to keep `npm run check` fully
green.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SC5 (fail loudly, name the offending id, non-zero exit) and SC3 (`npm run compile-map -- --area
  juliette-ga` as the one-command pipeline) are both now real and proven against real data.
- The compiled Juliette, GA map is proven reachable, pathable (honouring oneway), and
  geometrically sane — the substrate Phase 5's navigation and Phase 7's AI pathfinding will consume
  is confirmed consumable by `ngraph.path` with zero adaptation.
- Blocker/carry-forward: `npm run check`'s Biome step is not fully green due to the pre-existing
  Task 1 formatting issues noted above — worth a quick `biome check --write` pass before or during
  phase verification so `npm run check` is trustworthy again as a single green/red signal (mirrors
  the same kind of carry-forward STATE.md already tracks from Phase 2's CRLF issue).

---
*Phase: 04-map-pipeline-first-area*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: commit 87549bd (Task 1)
- FOUND: commit e9ad17f (Task 2)
- FOUND: tools/map-compiler/validate/validator.ts
- FOUND: tools/map-compiler/validate/validator.test.ts
- FOUND: tools/map-compiler/cli.ts
- FOUND: tests/compiled-map.test.ts
- FOUND: .planning/phases/04-map-pipeline-first-area/04-06-SUMMARY.md
