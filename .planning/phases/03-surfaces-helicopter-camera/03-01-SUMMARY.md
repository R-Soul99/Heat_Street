---
phase: 03-surfaces-helicopter-camera
plan: 01
subsystem: core-tuning
tags: [tuning, surfaces, validation, refactor, tdd]
dependency-graph:
  requires: []
  provides:
    - src/core/tuning-utils.ts (TuningRange, isPlainObject, isTuningRange, clampNode, copyLeaves)
    - src/core/surface-types.ts (SURFACE_TYPES, SurfaceType)
    - src/core/surface-tuning.ts (SurfaceProfiles, defaultSurfaceProfiles, SURFACE_PROFILE_RANGES, clampSurfaceProfiles, parseSavedSurfaceProfiles, serializeSurfaceProfiles, SURFACE_TUNING_STORAGE_KEY)
  affects:
    - src/core/vehicle-tuning.ts (rewired to import from tuning-utils.ts)
tech-stack:
  added: []
  patterns:
    - "Generic clamp/copy machinery factored once (tuning-utils.ts), every localStorage-persisted tuning domain delegates rather than re-implementing"
    - "SurfaceType lives in src/core/ (not src/physics/) so src/core/render/audio consumers can all import it without src/core/ pulling in Rapier"
key-files:
  created:
    - .gitattributes
    - src/core/tuning-utils.ts
    - src/core/surface-types.ts
    - src/core/surface-tuning.ts
    - tests/surface-tuning.test.ts
  modified:
    - src/core/vehicle-tuning.ts
    - src/physics/telemetry/routines.ts (incidental line-width formatting fix)
decisions:
  - "Repo-wide LF normalization via .gitattributes (`* text=auto eol=lf`) chosen over biome.json's `formatter.lineEnding: crlf`, since the committed git blobs are already LF and this is the smaller, non-Windows-specific fix"
  - "SurfaceType deliberately placed in src/core/surface-types.ts, not src/physics/surface.ts as 03-PATTERNS.md originally assigned — src/core/ must stay free of @dimforge/rapier3d imports, and src/core/surface-tuning.ts / src/render/surface-fx.ts / src/audio/surface-audio.ts all need the type"
  - "SURFACE_PROFILE_RANGES uses a uniform {min:0.2, max:1.2, step:0.01} for every leaf across all six surfaces, per 03-RESEARCH.md/03-PATTERNS.md's explicit floor-above-zero rationale (D-04)"
metrics:
  duration: "~10 min"
  completed: 2026-09-12
---

# Phase 3 Plan 01: Trustworthy check signal + shared surface tuning foundation Summary

Fixed the repo-wide CRLF-vs-LF lint blocker with a `.gitattributes` LF-normalization commit, extracted vehicle-tuning.ts's generic clamp/copy machinery into a shared `src/core/tuning-utils.ts`, and added a doc-parity-tested `SurfaceType` enum plus a `SurfaceProfiles` per-surface grip-multiplier tuning object built entirely on that shared machinery.

## What Was Built

**Task 1 — `.gitattributes` LF normalization.** Added a repo-root `.gitattributes` (`* text=auto eol=lf` plus `binary` attributes for `*.glb`/`*.wasm`/`*.png`/`*.jpg`/`*.wav`/`*.ogg`/`*.mp3`), ran `npx biome check --write .` to rewrite every tracked file to LF, then `git add --renormalize .`, committed as its own isolated commit. This closes the Phase 2 blocker recorded in `.planning/phases/02-vehicle-feel-core/deferred-items.md` — `npm run lint` now exits 0 on this Windows worktree, making `npm run check` a single trustworthy green/red signal again for every remaining Phase 3 plan.

**Task 2 — `src/core/tuning-utils.ts` extraction.** Moved `TuningRange`, `isPlainObject`, `isTuningRange`, `clampNode`, `copyLeaves` out of `vehicle-tuning.ts` verbatim into a new file, all five exported. `vehicle-tuning.ts` now imports the four functions/types it still needs from `./tuning-utils` and re-exports `TuningRange` so `src/debug/tuning-panel.ts`'s existing import keeps working unchanged. Pure refactor: `tests/vehicle-tuning.test.ts` and `tests/tuning-persist.test.ts` pass identically before and after (23/23 combined), no test file touched.

**Task 3 — `src/core/surface-types.ts` + `src/core/surface-tuning.ts` (TDD).** Wrote `tests/surface-tuning.test.ts` first (confirmed RED — failed on missing modules), then implemented:
- `SURFACE_TYPES` — the six-value tuple (`tarmac`, `gravel`, `dirt_road`, `grass`, `sand`, `mud`), doc-parity-tested against `docs/schemas/road-graph.v1.md`'s normative `SURFACE_ENUM` line using the same `surfaceEnumFromDoc` parser idiom `tests/road-graph-schema.test.ts` already established.
- `SurfaceProfiles` — `forwardGrip`/`lateralGrip` per surface, defaults copied verbatim from 03-RESEARCH.md's "Surface Grip Ranking" table (tarmac 1.00/1.00 baseline, gravel 0.75/0.55, dirt_road 0.78/0.55, grass 0.55/0.60, sand 0.45/0.55, mud 0.40/0.50), each carrying its `[CITED]`/`[ASSUMED]` provenance tag and a "retune in plan 03-11" note.
- `clampSurfaceProfiles`/`parseSavedSurfaceProfiles`/`serializeSurfaceProfiles` — all delegate to `tuning-utils.ts`'s `clampNode`/`copyLeaves`, mirroring `vehicle-tuning.ts`'s hostile-blob-proof parse contract exactly, persisted under its own `heat-street.surface-tuning.v1` key.

GREEN confirmed: 28/28 assertions in `tests/surface-tuning.test.ts` pass, `tests/layering.test.ts` passes with both new `src/core/` files included, `npm run check` exits 0 end to end (361/361 tests total).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Incidental line-width reformat in `src/physics/telemetry/routines.ts`**
- **Found during:** Task 1, running `npx biome check --write .`
- **Issue:** Two pre-existing lines exceeded biome's 100-column line width (unrelated to the CRLF issue), which biome's own `--write` pass reformatted alongside the line-ending fix.
- **Fix:** Accepted biome's auto-reformat (multi-line wrap, no logic change) since `npm run lint` exiting 0 is this task's own acceptance criterion and the change is purely whitespace.
- **Files modified:** `src/physics/telemetry/routines.ts`
- **Commit:** `d0504bb`

**2. [Rule 1 - Bug] Acceptance-grep-breaking literal in `surface-types.ts`'s doc comment**
- **Found during:** Task 3, self-verifying the acceptance criteria greps
- **Issue:** An early draft of the doc comment explaining "`dirt_road` is deliberately NOT `dirt`" quoted the word `"dirt"` with literal double quotes, which itself matched the acceptance criterion's `grep -c '"dirt"'` check (required to return 0).
- **Fix:** Reworded the comment to reference the word without wrapping it in literal quotes.
- **Files modified:** `src/core/surface-types.ts`
- **Commit:** `45f504d`

**3. [Rule 1 - Bug] Ineffective biome-ignore suppression in the RED test**
- **Found during:** Task 3, GREEN pass — running `npx biome check --write` on the new test file
- **Issue:** A `// biome-ignore lint/performance/noDelete` comment suppressed a rule that biome wasn't actually flagging on that line, itself producing a `suppressions/unused` warning.
- **Fix:** Removed the ineffective suppression comment (the `delete` statement itself was already lint-clean).
- **Files modified:** `tests/surface-tuning.test.ts`
- **Commit:** `45f504d`

None of these required an architectural decision (Rule 4) or user input.

### Auth Gates

None encountered.

## Known Stubs

None — every exported function in this plan is fully implemented and tested; no hardcoded empty values, no placeholder text.

## Threat Flags

None — every new surface added (`localStorage` parse boundary, doc-parity test) is exactly the surface the plan's own `<threat_model>` (T-03-01 through T-03-04, T-03-SC) anticipated and assigned a `mitigate`/`accept` disposition to; nothing new was introduced outside that register.

## Self-Check: PASSED

Verified the following exist on disk and in git history:
- `.gitattributes` — FOUND
- `src/core/tuning-utils.ts` — FOUND
- `src/core/surface-types.ts` — FOUND
- `src/core/surface-tuning.ts` — FOUND
- `tests/surface-tuning.test.ts` — FOUND
- Commit `d0504bb` (chore: LF normalization) — FOUND in `git log --oneline`
- Commit `844d389` (refactor: tuning-utils extraction) — FOUND in `git log --oneline`
- Commit `aab6e1a` (test: RED surface-tuning test) — FOUND in `git log --oneline`
- Commit `45f504d` (feat: GREEN surface-types + surface-tuning) — FOUND in `git log --oneline`

`npm run check` exits 0 (typecheck + lint + 361/361 tests). All plan verification and success criteria confirmed passing.
