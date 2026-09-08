# Phase 1: Engine Foundation - Pattern Map

**Mapped:** 2026-09-08
**Files analyzed:** 32 (29 create, 3 modify)
**Analogs found:** 0 / 32 codebase analogs — **greenfield repo, verified**
**Reference patterns available:** 24 / 32 (from verified RESEARCH.md excerpts)

## Greenfield Verification

Confirmed by direct inspection, not assumed:

```
git ls-files  →  20 files, ALL markdown/planning:
  .planning/**  (9 md + config.json)
  CLAUDE.md, PROJECT.md, heat-street-design-doc.md
git ls-files "*.ts" "*.js" "*.json" "*.html"  →  .planning/config.json ONLY
ls -d .claude .agents .cursor .github .codex  →  none exist
```

Repo root contains: `.git/`, `.planning/`, `CLAUDE.md`, `heat-street-design-doc.md`,
`PROJECT.md`, `screenshots/` (untracked). **No `package.json`, no `src/`, no
`node_modules/`, no `index.html`, no test dir, no skills dir.**

**Consequence for the planner:** there are no codebase analogs to copy. Every
"Reference" below is either (a) a verified code excerpt from `01-RESEARCH.md`
(these were *executed* in the research session against pinned versions — treat
them as working code, not sketches), or (b) an earlier file *in this same phase*
that establishes the convention. Section §Intra-Phase Pattern Seeding is
therefore the most load-bearing part of this document: it tells the planner
which files must be written **first** because everything else copies from them.

---

## File Classification

### Files to CREATE

| File | Role | Data Flow | Reference Pattern | Match Quality |
|------|------|-----------|-------------------|---------------|
| `package.json` | config | n/a | RESEARCH.md L126-131 (exact install cmds) | verified-excerpt |
| `tsconfig.json` | config | n/a | RESEARCH.md L1010 + L97 (`moduleResolution: bundler`, tsc-verified clean) | partial — options named, no full file |
| `vite.config.ts` | config | n/a | CLAUDE.md "Development Tools" (`build.target:'esnext'`, `assetsInlineLimit:0`); RESEARCH.md L944 (do **not** add `optimizeDeps.exclude`) | partial — constraints only |
| `vitest.config.ts` | config | n/a | RESEARCH.md L500-511 — **complete verified file** | verified-excerpt |
| `biome.json` | config | n/a | none — D-08 only mandates its existence | **no reference** |
| `index.html` | config/entry | n/a | none | **no reference** |
| `src/core/sim-clock.ts` | core-model | transform (time→ticks) | RESEARCH.md L274-331 — **complete verified class** | verified-excerpt |
| `src/core/frame-budget.ts` | config-constants | n/a | RESEARCH.md L784-799 (budget table); consumed at L728, L750-756 | verified-excerpt (values) |
| `src/core/input-tape.ts` | core-model | event-driven → batch | RESEARCH.md L349-355 — **interface shapes only, bodies elided** | partial |
| `src/physics/world.ts` | service/factory | batch (fixed-step) | RESEARCH.md L608-640 — **complete verified fn** | verified-excerpt |
| `src/physics/transform-cache.ts` | store | transform (double-buffer) | RESEARCH.md L646-673 — **complete verified class** | verified-excerpt |
| `src/render/renderer.ts` | render-service | request-response (per-frame) | none — plain `WebGLRenderer` setup | **no reference** |
| `src/render/interpolator.ts` | utility | transform (lerp/slerp) | RESEARCH.md L365-373 + L664-671 | verified-excerpt |
| `src/render/debug-scene.ts` | scene-builder | batch (setup-once) | RESEARCH.md L622-639 (physics half) + L642 (**sleep caveat — unsolved**) | partial |
| `src/debug/profiler-hud.ts` | view/DOM-overlay | pull-polling @ ~7Hz | RESEARCH.md L726-761 — **complete verified fn** | verified-excerpt |
| `src/debug/debug-gate.ts` | middleware/gate | event-driven | RESEARCH.md L765-778 — **complete verified fn** | verified-excerpt |
| `src/loop.ts` | orchestrator/driver | event-driven (rAF) | RESEARCH.md L555-604 — **complete verified fn** | verified-excerpt |
| `src/main.ts` | entry/composition-root | request-response | none — wires the above | **no reference** |
| `tests/determinism.test.ts` | test | batch | RESEARCH.md L678-720 — **complete, was run & passing** | verified-excerpt |
| `tests/sim-clock.test.ts` | test | batch | RESEARCH.md L458-460, L477-479 (measured expectations) | partial — assertions derivable |
| `tests/interpolation.test.ts` | test | batch | RESEARCH.md L1021 (alpha bounds, α=0≡prev, α=1≡cur) | partial |
| `tests/frame-budget.test.ts` | test | batch | RESEARCH.md L1026 (doc↔constants no-drift) | partial |
| `tests/road-graph-schema.test.ts` | test | batch | RESEARCH.md L845-907 (schema) + L931 | partial |
| `tests/docs-present.test.ts` | test | file-I/O | RESEARCH.md L1028 | partial |
| `tests/no-google-pipeline.test.ts` | test | file-I/O (grep) | RESEARCH.md L1030 + L834-837 (supersession list) | partial |
| `docs/frame-budget.md` | documentation | n/a | RESEARCH.md L780-811 — **complete table, copy verbatim** | verified-excerpt |
| `docs/adr/0001-map-data-source.md` | documentation | n/a | RESEARCH.md L813-839 — **complete ADR body w/ citations** | verified-excerpt |
| `docs/schemas/road-graph.v1.md` | documentation | n/a | RESEARCH.md L845-929 — **complete schema + mapping table** | verified-excerpt |
| `fixtures/road-graph.sample.json` | fixture | n/a | RESEARCH.md L845-907 (shape) + L931 (4-node square loop, one gravel edge) | verified-excerpt (spec) |

### Files to MODIFY

| File | Role | Change | Exact Target |
|------|------|--------|--------------|
| `heat-street-design-doc.md` | documentation | Supersede §5 Google Maps pipeline | **Lines 50-55**, specifically L53-55 |
| `CLAUDE.md` | documentation | Supersede minimap Google Maps reference | **Line 112** |
| `.planning/research/STACK.md` | documentation | Same stale line — see §Discovered Risk | **Line 190** (and L84, L204, L292) |

---

## Intra-Phase Pattern Seeding

Because there is no prior code, **this phase writes its own analogs.** These four
files establish conventions every other file in Phase 1 (and Phases 2-8) copies.
The planner should sequence them first within their wave and treat them as the
"analog" reference in later plans' action steps.

| Seed file | Establishes | Copied by |
|-----------|-------------|-----------|
| `vitest.config.ts` | That Rapier imports at all under Node | **Every** test file. Must land in wave 0 before any other test (RESEARCH.md L1052). |
| `src/core/sim-clock.ts` | The purity rule (no `three`, no `document` in `src/core/`), `DT` as the single exported timestep constant, named-export-class style | `src/core/frame-budget.ts`, `src/core/input-tape.ts`, `src/physics/world.ts` (imports `DT`), `src/loop.ts` |
| `src/physics/transform-cache.ts` | Flat `Float64Array` stride-7 layout keyed by dense body index (RESEARCH.md L377 — commit to this shape *now*, Phase 7/8 depends on it) | `src/render/interpolator.ts`, any later multi-body system |
| `src/debug/debug-gate.ts` | The `?debug` query-param + single-hotkey convention Phase 2's lil-gui reuses (D-05) | `src/debug/profiler-hud.ts`, Phase 2 tuning panel |

**Import-path convention:** RESEARCH.md's excerpts consistently use **relative
paths with no extension** (`"./core/sim-clock"`, `"../core/frame-budget"`) — see
L557, L614, L681, L728. No path aliases are configured anywhere. The planner
should either adopt relative-no-extension uniformly, or decide aliases up front —
mixing them is the drift D-08 (Biome) exists to catch.

---

## Pattern Assignments

### `src/core/sim-clock.ts` (core-model, time→tick transform)

**Reference:** `01-RESEARCH.md` L274-331 — verified by execution across 8 refresh rates.

This is the highest-fidelity reference in the phase: a complete class body that was
run and measured. Copy it structurally, do not paraphrase. Load-bearing details the
planner must not let an implementer "improve":

- **`stepsFor()` recomputes from `nowMs` absolutely** (`this.tick * DT < elapsedSec`).
  An `acc += delta` rewrite fails SC1 at 144fps — measured: 599 ticks / hash
  `e91b9ed3` vs 600 ticks / `e68ecce6` (RESEARCH.md L459-460).
- **No epsilon in the `while` condition.** RESEARCH.md L333 explicitly tested
  `- DT * 0.5` and found it made no difference at any of 8 rates. An unexplained
  epsilon is a code-review smell here, not a safety margin.
- **`rebaseline()` moves `originMs` forward, never rewinds `tick`,** and increments
  `droppedTicks`. Clamp-only fails SC3: 300 ticks in the first post-resume second
  instead of 60 (RESEARCH.md L477-479).
- **`get simTimeSec()` returns `tick * DT`** — this is the ONLY run clock (Pattern 2,
  L335-341).

**Purity constraint (RESEARCH.md L262, L428):** zero imports of `three`, zero
references to `document`/`window`/`performance`. `nowMs` arrives as a parameter.
This is what makes SC1 and SC3 Node-testable; violating it collapses the phase's
entire verification strategy into manual checking.

**Enforcement hook (RESEARCH.md L341):** a Biome rule or grep test forbidding
`performance.now()` / `Date.now()` outside `src/loop.ts` and `src/debug/`.

---

### `src/loop.ts` (orchestrator, rAF-driven)

**Reference:** `01-RESEARCH.md` L555-604 — complete `startLoop()` with a deps object.

Structural conventions this establishes:
- **Dependency-injection via a single `deps` object literal** (`{ world, input,
  transforms, render, hud? }`) rather than constructor params or module singletons.
  Later phases add fields here; keep it an object.
- **`requestAnimationFrame(frame)` is re-scheduled at the TOP of `frame`,** before
  any work — so a throw doesn't kill the loop.
- **First frame only calls `clock.start(nowMs)` and returns** (`if (!started)`).
  No steps on frame 1.
- **Tick index is computed as `clock.tick - steps + s`** inside the step loop —
  because `stepsFor()` has already advanced `clock.tick` past all of them.
- **Order inside the step is fixed:** `captureAsPrevious()` → `applyInput()` →
  `world.step()` → `captureAsCurrent()`. Swapping the captures inverts interpolation.
- **`deps.render(alpha)` is called exactly once per rAF, outside the step loop**
  (anti-pattern L425).
- **Saturation fallback:** `if (steps === MAX_STEPS_PER_FRAME) { if (++saturated > 30)
  { rebaseline; saturated = 0 } } else saturated = 0` (L591). Catches stalls that
  never fire `visibilitychange` (debugger pause, long GC, OS sleep).

**Per-tick event draining (L427):** Phase 1 has no `EventQueue`, but the tick
callback signature must *permit* per-tick draining or Phase 5 checkpoint detection
silently misses crossings on multi-step frames. Design the signature now.

---

### `src/physics/world.ts` (service/factory)

**Reference:** `01-RESEARCH.md` L608-640.

- `import * as RAPIER from "@dimforge/rapier3d"` — **no `await RAPIER.init()`.**
  The non-compat `init.js` is literally `export {}` (L610, L437). Calling `init()`
  is the single most likely copy-paste error from `-compat` tutorials.
- `world.timestep = DT` imported from `../core/sim-clock` — **must** match the
  loop's DT exactly. Do not re-declare `1/60` here.
- This module becomes an **async module** (Vite's `.wasm` ESM integration uses
  top-level await), which is why `build.target: 'esnext'` is mandatory (L611-612).
- `createDebugScene()` lives here in the reference — physics bodies only, no Three
  meshes. Keeps the render/physics split clean.

---

### `src/physics/transform-cache.ts` (store, double-buffered)

**Reference:** `01-RESEARCH.md` L646-673.

- **Stride-7 `Float64Array`** (`px py pz qx qy qz qw`), two buffers, keyed by dense
  index. Not objects. RESEARCH.md L377: commit to this shape now even though Phase 1
  has six boxes — Phase 7/8 pursuer counts are the reason.
- `captureAsPrevious()` is `this.prev.set(this.cur)` — a buffer copy, not a re-read
  from Rapier.
- Constructor primes both buffers (`captureAsCurrent(); this.prev.set(this.cur)`)
  so frame 1 doesn't lerp from zeros.
- `b.translation()` returns `Vector {x,y,z}`, `b.rotation()` returns
  `Rotation {x,y,z,w}` — structurally compatible with Three but **use `.set(...)`
  not `.copy(...)`** (L363) to avoid depending on `@types/three` structural typing.
- Module-level scratch `TMP_V` / `TMP_Q` reused across calls — no per-frame allocation.

---

### `src/render/interpolator.ts` (utility, transform)

**Reference:** `01-RESEARCH.md` L365-373 (standalone fn) and L664-671 (batch method
on `TransformCache`).

Note the reference gives **two placements** for the same logic. The planner should
pick one and state it: either `TransformCache.apply(meshes, alpha)` (L664) or a free
`applyInterpolated(mesh, prev, cur, alpha)` (L368). The free-function form keeps
`src/physics/` free of `three` imports, which is more consistent with the
`src/core/` purity rule — recommend that, and have `TransformCache` expose the raw
buffers instead.

Use `THREE.Quaternion.slerp` — never hand-rolled (L439: shortest-arc/sign-flip bugs
show up as a body spinning the long way once per revolution).

---

### `src/debug/profiler-hud.ts` (view, DOM overlay)

**Reference:** `01-RESEARCH.md` L726-761 — complete `createHud()`.

- **`textContent`, never `innerHTML`** (security note L1075).
- **`el.style.cssText = "position:fixed;...;pointer-events:none;...;display:none"`** —
  inline style string, `display:none` default, toggled by `debug-gate`.
- **Throttled to ~7Hz** via `if (acc < 150) return` (L745) — DOM writes at 144Hz are
  themselves a frame-budget cost.
- **Averages accumulated between DOM writes** (`pSum`, `rSum`, `samples`), reset after.
- **`renderer.info` read AFTER `renderer.render()`** — `autoReset` defaults `true`
  and resets at the *start* of `render()` (Pitfall 5, L527-533).
- **`over(v, budget)` helper appends `" !"`** — this is how "checked against a written
  budget" (SC4/D-04) is actually satisfied.
- Fields required by D-03 + recommended extras: physics ms, render ms (**label it
  "cpu submit"** — three@0.185.1's classic WebGLRenderer has no timer query, L410),
  draw calls, triangles, `active / total` bodies, `droppedTicks`, `steps`.

---

### `src/debug/debug-gate.ts` (middleware/gate)

**Reference:** `01-RESEARCH.md` L765-778.

- `export const DEBUG_ENABLED = new URLSearchParams(location.search).has("debug")` —
  **presence check only.** Never read the value, never render it (V5 note, L1065).
- `onDebugToggle(fn)` early-returns when `!DEBUG_ENABLED`.
- Keydown guard: `e.code === "Backquote" && !e.repeat && !e.metaKey && !e.ctrlKey`.

This file *is* the convention Phase 2's lil-gui panel reuses (D-05). Export shape
matters more than the implementation.

---

### `tests/determinism.test.ts` (test, batch)

**Reference:** `01-RESEARCH.md` L678-720 — this test was **run and passing** in the
research session.

- FNV-1a helper over `world.takeSnapshot(): Uint8Array` — byte-exact, no epsilons
  (L435). A float-position comparison passes while internal solver state has diverged.
- `simulate(fps, seconds)` drives the **real `SimClock`** with synthetic timestamps
  `(f / fps) * 1000` — absolute ms, never accumulated (L696).
- `it.each([30, 60, 75, 90, 120, 144, 165, 240])` — all eight rates.
- **The third test is mandatory** (L715-722): `runTicks(600).hash !== runTicks(601).hash`.
  Without it, a `takeSnapshot()` returning a constant would make the suite green.
- FNV-1a is a **non-cryptographic test fingerprint** — do not describe it as a
  checksum (L1066).

---

### `vitest.config.ts` (config)

**Reference:** `01-RESEARCH.md` L500-511 — **verified working, copy verbatim.**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { mainFields: ["module", "main"] },
  ssr: { resolve: { mainFields: ["module", "main"] } },
  test: {
    environment: "node",
    server: { deps: { inline: ["@dimforge/rapier3d"] } },
  },
});
```

Without this, **every** Rapier test fails at import with `Failed to resolve entry for
package "@dimforge/rapier3d"` — the 0.20.0 package.json has `module` but no `main`
and no `exports` map. Sequence this into wave 0 with a trivial `RAPIER.version()`
smoke test (L1052): ten minutes that de-risks the entire phase's verification.

---

### `vite.config.ts` (config)

**Reference:** constraints from CLAUDE.md + RESEARCH.md; no full file exists.

Required: `build.target: 'esnext'` (top-level-await for the wasm ESM import),
`build.assetsInlineLimit: 0` (Vite's default base64-inlines `.wasm` under the
threshold, L429).

**Explicitly do NOT add:** `optimizeDeps.exclude: ['@dimforge/rapier3d']`,
`vite-plugin-wasm`, `vite-plugin-top-level-await`. CLAUDE.md lists the first as a
conditional fallback; RESEARCH.md L944 verified Vite 8.2.2 pre-bundles Rapier
correctly and serves the rewritten wasm import 200. Adding it is cargo-culting.

---

### `heat-street-design-doc.md` (MODIFY — documentation)

**Exact target — lines 50-55:**

```
## 5. Maps & Locations

- **No procedurally generated maps** — ruled out from the start.
- Leroy has already built a separate tool that takes an area of Google
  Maps and exports it into files usable for game map creation. This is
  the preferred pipeline for recreating real-world locations.
```

L53-55 is the sentence RESEARCH.md L537 names. The ADR must **supersede** it, not
merely coexist (Pitfall 6, L535-543). Add an inline supersession pointer to
`docs/adr/0001-map-data-source.md`.

### `CLAUDE.md` (MODIFY — documentation)

**Exact target — line 112:**

> `- **Minimap** → a separate <canvas> 2D context, drawing the **road polylines you already have from the Google Maps extraction tool**, plus dots for the player, checkpoints, and pursuers.`

Replace the Google Maps clause with the OSM-derived road graph; add the ADR pointer.
Note CLAUDE.md is agent-facing canon — a stale line here is read by *every* future
agent, which is why RESEARCH.md L541 calls this "the highest-value five minutes in
the phase."

---

## Shared Patterns

### Layering / import direction (RESEARCH.md L71-83, L262, L428)

**Apply to:** every `src/` file.

```
src/core/**      →  pure TS. NO `three`, NO `document`, NO `performance.now()`.
src/physics/**   →  may import `@dimforge/rapier3d` + `src/core`. NO `three`.
src/render/**    →  may import `three` + read from physics/core. NEVER writes sim state.
src/debug/**     →  may import anything. Must never affect sim timing.
src/loop.ts      →  the ONLY place `requestAnimationFrame` is called.
src/main.ts      →  composition root; wires everything.
```

One-way dependency: render reads sim, never writes it.

### Version pinning (RESEARCH.md L1074, L1079)

**Apply to:** `package.json`.

Pin `three` and `@dimforge/rapier3d` to **exact** versions (`"0.185.1"`, `"0.20.0"`)
with no `^`/`~`. A patch bump to either can alter solver behaviour and silently
invalidate every recorded medal time. Commit `package-lock.json`. Worth a line in
the ADR or a `docs/` note.

### Budget-constant mirroring (D-04, RESEARCH.md L782)

**Apply to:** `docs/frame-budget.md` + `src/core/frame-budget.ts` + `tests/frame-budget.test.ts`.

The doc and the TS constants must be mirrored, and a test must assert they haven't
drifted. Locked values: total frame **16.6ms**, physics **≤4.0ms**. Recommended
split: render CPU ≤6.0, game logic ≤2.0, headroom ≥4.6.

### Named exports, no default exports

Every RESEARCH.md excerpt uses named exports (`export class SimClock`,
`export function startLoop`, `export const DEBUG_ENABLED`). Only the Vite/Vitest
configs use `export default` (framework requirement). Adopt this uniformly.

### Anti-patterns to encode as review gates (RESEARCH.md L419-429)

Apply to all plans touching `src/`:
1. No `acc += dt` frame-delta accumulation.
2. No elapsed run time from `performance.now()` — always `tick * DT`.
3. No input sampled per rAF frame and reused across ticks.
4. No `renderer.render()` inside the fixed-tick loop.
5. No `renderer.info` read before `render()`.
6. No `three`/`document` imports in `src/core/`.

---

## No Reference Pattern Found

Files with neither a codebase analog nor a RESEARCH.md excerpt. The planner must
specify these from first principles or from CLAUDE.md's stack guidance.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `biome.json` | config | n/a | D-08 mandates Biome is wired up; no config shape is specified anywhere. Recommend `biome init` output plus the `performance.now()`/`Date.now()` restriction from RESEARCH.md L341 if expressible. |
| `index.html` | entry | n/a | Trivial, but nothing specifies canvas element id, viewport meta, or where the HUD div mounts (the HUD `appendChild`s to `document.body` per L736). |
| `src/render/renderer.ts` | render-service | request-response | No excerpt. CLAUDE.md mandates `WebGLRenderer` (not WebGPU) and `PCFSoftShadowMap` availability. Resize handling, pixel ratio and colour space are unspecified. |
| `src/main.ts` | composition root | request-response | Pure wiring of the other modules; shape follows from `startLoop`'s `deps` object (L559-565). |
| `tsconfig.json` | config | n/a | Only `moduleResolution: "bundler"` is verified (L1010, L97). `strict`, `target`, `lib`, `noEmit`, `types` all unspecified. Note `typescript@7.0.2` is the native Go compiler — verify editor plugin behaviour. |
| `src/render/debug-scene.ts` (Three half) | scene-builder | batch | The Rapier half is given (L622-639); the Three mesh/light/camera half is not. Must produce meshes in the **same dense index order** as `TransformCache`'s body array. |

---

## Discovered Risks (found during mapping, not in RESEARCH.md)

### R1 — The supersession list is incomplete; the grep test will trip on files it doesn't name

RESEARCH.md L834-837 names two files to amend (`heat-street-design-doc.md` §5,
`CLAUDE.md` L112) and says `PROJECT.md` §5 needs no change. A repo-wide grep found
Google-Maps-pipeline language in **more** places:

| File | Line(s) | Nature |
|------|---------|--------|
| `.planning/research/STACK.md` | 190 | **Verbatim duplicate** of the CLAUDE.md L112 minimap line |
| `.planning/research/STACK.md` | 84, 204, 292 | Further "map from the Google Maps tool" references |
| `.planning/research/ARCHITECTURE.md` | 367 | `extractor output (Google Maps area)` in a diagram |
| `.planning/research/FEATURES.md` | 73, 247 | "the existing extraction tool" as the map source |
| `.planning/PROJECT.md` | 75 | "the player's own Google Maps extraction tool can produce either" |
| `.planning/STATE.md` | 80 | "whether the existing extraction tool already emits usable road-graph topology" — ambiguous, may be fine |

`.planning/research/PITFALLS.md` L16-25 and `SUMMARY.md` L76 also mention Google Maps
but *as the prohibition*, so they must not be flagged.

**Planner action required:** `tests/no-google-pipeline.test.ts` needs an explicit,
stated scope. Two viable options — pick one in the plan, don't leave it to the
implementer:
- **(a)** Scope the grep to non-`.planning/` files only (`CLAUDE.md`,
  `heat-street-design-doc.md`, `PROJECT.md`, `docs/`, `src/`) and treat `.planning/research/`
  as a frozen historical record. Cheapest; matches RESEARCH.md's named list.
- **(b)** Scope repo-wide with an allowlist of files that mention Google *in order to
  prohibit it*. Stronger, but requires amending 4-6 more `.planning/` files and
  maintaining the allowlist.

Note `.planning/PROJECT.md` L75 contradicts RESEARCH.md L837's claim that "PROJECT.md
§5 does not mention Google" — RESEARCH.md checked root `PROJECT.md`, but there are
**two** PROJECT.md files (root and `.planning/`). The `.planning/` one does mention it.

### R2 — SC2's "always moving" requirement has no reference implementation

RESEARCH.md L642 flags that Rapier bodies **sleep** once settled, and a sleeping body
stops moving, so interpolation judder becomes unobservable after ~10 seconds — SC2
then cannot be checked. It proposes three options (kinematic body rotated `DT`/tick,
a dynamic body kept awake by torque, or a `?debug` re-drop key) but provides code for
none. The planner must **choose one explicitly** and put it in an action step; leaving
it implicit is how SC2 silently becomes unverifiable.

A kinematic body rotated exactly `DT` per tick is the cleanest — it is deterministic
(so it doesn't perturb the SC1 snapshot test unpredictably), never sleeps, and its
constant angular velocity makes judder maximally visible.

### R3 — `src/core/input-tape.ts` is the least-specified file with the most SC1 leverage

RESEARCH.md L349-355 gives interfaces with bodies elided (`/* wraps a live source,
appends to frames[] */`). But Pattern 3 (L343-347) states input latching is "the
subtle half of SC1 that a stepping fix alone does not cover," and the validation
table (L1018) requires a test named `"input tape"` proving a recorded tape replayed
at different rates yields the same end snapshot. The gap between "interface sketch"
and "tested SC1 mechanism" is real work the planner should size accordingly.

---

## Metadata

**Analog search scope:** entire repo (`git ls-files`, root `ls -la`, glob for
`*.ts`/`*.js`/`*.json`/`*.html`, skills-dir probe). Zero source files exist.
**Files scanned:** 20 tracked (all markdown/planning) + 6 root entries.
**Reference sources used:** `.planning/phases/01-engine-foundation/01-RESEARCH.md`
(verified-by-execution excerpts), `.planning/phases/01-engine-foundation/01-CONTEXT.md`
(D-01…D-08), `CLAUDE.md` (stack canon), `heat-street-design-doc.md` (modification target).
**Pattern extraction date:** 2026-09-08
