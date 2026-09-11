# Deferred Items — Phase 02 vehicle-feel-core

Items discovered during execution that are out of scope for the task that found them.

## [Plan 02-07] Pre-existing repo-wide CRLF-vs-LF lint mismatch

**Found during:** Task 3, verifying `npm run check`.

**Issue:** `npx biome check .` reports ~49 formatting errors across the whole repository,
including files never touched in this plan or any prior Phase 2 plan (e.g.
`tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `tests/vehicle-scene.test.ts`,
`tests/vehicle.test.ts`). The cause is this worktree's `core.autocrlf=true` git config
checking every file out with CRLF line endings on disk, while biome's formatter expects
LF and has no repo-level override (no `.gitattributes`, no `formatter.lineEnding` in
`biome.json`). Confirmed the underlying committed git blobs are correctly LF-normalized
(`git cat-file -p HEAD:<path> | file -` reports plain UTF-8 text, not CRLF) — this is a
working-directory-only artifact of the local checkout, not a defect in any committed
content.

**Verified pre-existing:** `npx biome check tests/vehicle-scene.test.ts tests/vehicle.test.ts`
(both untouched by plan 02-07) fails with the identical CRLF complaint.

**Status:** Not fixed — out of scope per the Scope Boundary rule (pre-existing, repo-wide,
not caused by this plan's changes). `npm run typecheck` and `npm run test` (the other two
`npm run check` components) both pass cleanly (322/322 tests, zero typecheck errors); only
the `biome check .` step is affected, and only by line-ending noise, not by any actual
style/lint violation in this plan's added code (verified individually: `npx biome check
src/physics/telemetry/*.ts tests/vehicle-telemetry.test.ts src/core/vehicle-tuning.ts
tests/vehicle-tuning.test.ts` is clean once compared against the LF-normalized git blob
content).

**Fix path if ever addressed:** Add a repo-root `.gitattributes` with `* text=lf` and
renormalize (`git add --renormalize .`), or set `"formatter": { "lineEnding": "crlf" }`
in `biome.json` to match the Windows-checkout convention. Either is a repo-wide policy
decision, not a single-plan change.
