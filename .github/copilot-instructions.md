# Heat Street – Copilot instructions

Browser chase/racing game (Three.js + Rapier + TypeScript + Vite, no UI framework). Core value: weighty, cinematic driving feel and medal-time replayability. See `PROJECT.md`, `CLAUDE.md` (stack rationale and "what not to use"), and `.planning/` (GSD phase plans/summaries; `.planning/STATE.md` has current status). `CLAUDE.md` asks that file changes start through a GSD workflow (`/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase`) unless the user explicitly bypasses it.

## Commands

Node >= 24 (`.nvmrc`).

- `npm run dev` – Vite dev server on :5173
- `npm run build` – production build (`target: esnext`, `assetsInlineLimit: 0`)
- `npm run typecheck` – `tsc --noEmit` (TS 7)
- `npm run lint` / `npm run lint:fix` – Biome (`biome check .`)
- `npm test` – Vitest (whole suite); single file: `npx vitest run tests/ai-driver.test.ts`; single test: `npx vitest run tests/ai-driver.test.ts -t "name"`
- `npm run check` – typecheck + lint + test (run before finishing)
- `npm run feel-dossier` – headless handling report (`scripts/feel-dossier.run.ts`, separate vitest config)
- Map tooling: `npm run compile-map`, `convert-terrain`, `generate-*`, `import-*`, `author-*-routes` (all `node tools/map-compiler/...ts`)

Tests live in `tests/` (plus a few colocated, e.g. `tools/map-compiler/authored-registry.test.ts`). Both Vite and Vitest configs have Rapier-specific workarounds (`@dimforge/rapier3d` has no `main`/`exports`; excluded from `optimizeDeps`) — don't remove them. Use the non-compat `@dimforge/rapier3d`, never `three/addons/physics/RapierPhysics.js`.

## Architecture

- `src/main.ts` wires everything; `src/loop.ts` is the rAF driver with a **fixed-timestep accumulator** (`core/sim-clock.ts`, 1/60 s) and render interpolation (`render/interpolator.ts`, `physics/transform-cache.ts`). Physics must never use variable dt — medal times depend on it.
- `src/core/` – pure, engine-free logic (tuning, drivetrain, feel sliders, race state, medals, navigation, AI drivers, road graph, terrain grid/format, checkpoints). Most unit tests target this layer.
- `src/physics/` – Rapier wrappers (vehicle via `createVehicleController`, surfaces, map/terrain colliders, AI fleet). Per-wheel surface grip is driven from the ground collider under each wheel.
- `src/render/` (+ `render/camera/` helicopter camera and occlusion), `src/hud/` (DOM/CSS HUD, 2D-canvas minimap), `src/input/` (keyboard/gamepad → race commands), `src/audio/`, `src/gameplay/` (race/circuit/free-drive coordinators), `src/debug/` (`?debug` / `?feel` panels, loggers).
- `tools/` – offline pipeline: `map-compiler` (OSM-derived road graph + terrain → compiled maps; schemas in `docs/schemas/`), plus `map-editor` and `terrain-editor` Vite plugins (loaded in `vite.config.ts`). Map-data decisions are in `docs/adr/`.
- `src/core/authored-maps.generated.ts` is **generated** by `tools/map-compiler/authored-registry.ts` from `tools/map-compiler/authored-maps.json` — don't hand-edit; change the JSON via the editors.
- Vehicle tuning guidance: `docs/vehicle-tuning-guide.md`, `vehicleTuning/`.

## Conventions (enforced by `tests/layering.test.ts`)

- `src/core` imports no `three`/`@dimforge/rapier3d` and touches no `document`/`window`/`performance`/`requestAnimationFrame`.
- `src/physics` never imports `three`; `src/hud` and `src/input` import no engine and write no sim state; `src/audio` never imports Rapier.
- `src/render` (and `src/hud`, `src/input`, `src/audio`) must not call `world.step`/`applyImpulse`/`setTranslation`/`setRotation`/`setNextKinematic*`.
- `src/render/camera` never imports `src/physics`, never uses ticks/`DT`/`sim-clock` (smoothing is time-based), and `camera-math.ts`/`occlusion.ts` never import `three`.
- `requestAnimationFrame` only in `src/loop.ts`; `performance.now(`/`Date.now(` only in `src/loop.ts` and `src/debug/**`.
- No `innerHTML` anywhere in `src/`.
- Debug tooling is gated on URL **presence** only (`parseDebugFlag`: `URLSearchParams.has("debug")`) — never read or render the param value. `src/debug/**` must not affect simulation timing.
- Persisted localStorage data (tuning, feel, medals) is untrusted: parse/validate on read (e.g. `parseSavedFeel`, `medal-persistence.ts`).
- Tests that need file contents read them via Vite `import.meta.glob(..., { query: "?raw" })` (no `@types/node` assumption in tests); `tests/docs-present.test.ts` and `tests/no-google-pipeline.test.ts` have glob/required-entry lists that must be widened together when adding docs/fixtures or scanned trees.
- Don't reference the retired Google-Maps extraction pipeline without pointing to the superseding ADR (`tests/no-google-pipeline.test.ts`).
- Trimesh colliders must use `TriMeshFlags.FIX_INTERNAL_EDGES`.
- No real manufacturer names/logos in shipped assets; models are low-poly glTF with Meshopt (no Draco).
- Biome handles lint + format (no ESLint/Prettier).
