# Deferred Items — Phase 07 (npc-driving-ai-circuit-racers)

Out-of-scope discoveries logged during execution, per the executor's Scope
Boundary rule (fix only issues directly caused by the current task's
changes; log everything else here instead of fixing it).

## Plan 07-03

- **`npm run check`'s Biome step fails on files this plan never touched.**
  `npx biome check .` reports pre-existing formatting/lint issues in
  `src/input/race-commands.ts`, `src/loop.ts`, `tests/loop.test.ts`,
  `tests/respawn.test.ts`, `tests/restart.test.ts`,
  `tools/map-compiler/author/gltf.test.ts`, and
  `vehicleTuning/heat-street-tuning-better.json` — none of which this plan
  created or modified. This matches the repo-wide CRLF-vs-LF
  working-directory line-ending mismatch already documented in
  `.planning/STATE.md` under "[Phase 2, all plans]" (confirmed pre-existing
  and cosmetic there). `npx biome check` scoped to this plan's own files
  (`src/core/ai-driver.ts`, `src/physics/ai-avoidance.ts`,
  `src/physics/ai-fleet.ts`, `tests/ai-driver.test.ts`,
  `tests/ai-avoidance.test.ts`, `tests/ai-field.test.ts`) is clean — "No
  fixes applied." `npm run typecheck` and the full `npx vitest run` suite
  both pass. Not fixed here (out of scope); the pre-existing fix path is
  already recorded in STATE.md (`.gitattributes` with `* text=lf` +
  renormalize, or `biome.json`'s `formatter.lineEnding: "crlf"`).

- **`npm run check`'s test step also fails on `tests/vehicle-telemetry.test.ts`**
  (3 tests: `accel`, `brake`, `runAllRoutines`), unrelated to this plan.
  This is the pre-existing, already-documented `[Quick 260920-sm2, open]`
  KNOWN-RED state in `.planning/STATE.md` (D-14's locked accel/brake bands
  vs. the shipped hand-tuned defaults) — not a regression introduced here.
  The full suite is otherwise green: 1183 passed, only these 3 pre-existing
  failures. This plan's own five test files (`ai-driver`, `ai-avoidance`,
  `ai-field`, `ai-lap`, `layering`) are all green (133/133).
