# Phase 01 — Deferred Items

Out-of-scope discoveries logged during execution. Not fixed in the plan that found
them, per the executor scope boundary.

| Found in | Item | Why deferred | Suggested owner |
|----------|------|--------------|-----------------|
| 01-04 | `git config core.autocrlf` is `true`, the repo has **no `.gitattributes`**, and `biome.json` does not set `formatter.lineEnding`. Biome defaults to `lf`, so any file restored by `git checkout` (or produced by a fresh clone) comes back CRLF and `npx biome check .` fails on it with `Formatter would have printed the following content`. Reproduced during 01-04's negative checks: `git checkout -- src/core/sim-clock.ts src/physics/debug-scene.ts` turned a clean gate red on two files this plan had not modified. | Fixing it means adding a `.gitattributes` (`* text=auto eol=lf`) and running `git add --renormalize .`, which rewrites the line endings of **every** tracked file. That is a repo-wide commit with nothing to do with VEH-03, and doing it inside a plan whose headline artifact is a byte-exact determinism proof would bury the signal. | Plan 01-07 (composition root / repo hygiene) or phase verification. The symptom to watch for is "`npm run lint` fails immediately after a fresh clone on Windows". |
