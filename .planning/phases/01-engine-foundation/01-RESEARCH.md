# Phase 1: Engine Foundation - Research

**Researched:** 2026-09-08
**Domain:** Fixed-timestep game loop, Rapier/Three.js bridge, browser build tooling, geodata licensing
**Confidence:** HIGH (the load-bearing findings were verified empirically in this session, not inferred)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

User deferred all Phase 1 gray areas to Claude's discretion (no meaningful user-facing product decisions in a pure-infrastructure phase). Recorded as locked defaults so research/planning don't re-litigate them.

**Debug Scene Fidelity**
- **D-01:** Debug scene is a bare physics test — one dynamic box (or a few) dropping/rolling onto a static flat plane collider. No vehicle-shaped placeholder yet; the vehicle controller is Phase 2's job and starting it here risks conflating "loop is correct" with "car feels right."
- **D-02:** The debug scene must still exercise render interpolation visibly (e.g., a spinning/falling body) so judder at 30/60/144fps is actually observable, per Success Criterion 2.

**Profiler HUD Depth**
- **D-03:** Minimal-but-real HUD: physics step ms, render ms, draw calls, triangle count, active body count — all four are explicitly required by Success Criterion 4, so "minimal" still means all four, not fewer.
- **D-04:** Written frame budget target: 16.6ms total frame @ 60fps, with physics step budgeted at ≤4ms of that (leaves headroom for render + browser overhead). Record this budget in the HUD or an adjacent doc/comment so it's the thing the HUD is checked against, not an implicit assumption.
- **D-05:** Toggle key: a single dedicated key (e.g. backtick/`~` or F1) gated behind a `?debug` query param convention consistent with the later lil-gui tuning panel (per STACK research doc).

**Repo & Tooling Scaffold**
- **D-06:** Single package (no monorepo) — the project is one deployable browser app with no separate publishable packages; a monorepo adds tooling overhead with no consumer.
- **D-07:** Package manager: npm (default, zero extra install, matches `npm pack`-based research already done in STACK.md). No strong reason to prefer pnpm/yarn for a solo-dev single-package project.
- **D-08:** Biome lint/format wired up in Phase 1, not deferred — cheap to add at project init, and catching style/type drift matters more once physics/render code starts accumulating in Phase 2+.

### Claude's Discretion
- Exact Vite config details (target: esnext, assetsInlineLimit: 0, optimizeDeps.exclude for Rapier) — follow STACK.md research doc directly, no open question.
- Directory layout under `src/` — Claude picks a structure during planning informed by RESEARCH.md.
- Whether the alt-tab resilience fix is a clamped accumulator vs. a max-substep cap — implementation detail, verified by Success Criterion 3 regardless of mechanism.

> **Research resolves two discretion items with evidence — see §Architecture Patterns:**
> - `optimizeDeps.exclude` for Rapier is **not needed** with Vite 8.2.2 (verified empirically). Do not add it.
> - The alt-tab fix is **not** clamp-vs-cap; it is **both a step clamp AND a clock rebaseline**. A clamp alone provably fails Success Criterion 3 (see §Pitfall 2).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Vehicle feel, surfaces, camera, map content, and everything else in ROADMAP.md remain correctly scoped to their own later phases.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VEH-03 | Vehicle physics run on a fixed timestep so lap and medal times are framerate-independent | §Pattern 1 (absolute-clock catch-up loop), §Pattern 2 (tick-derived sim clock), §Pattern 3 (per-tick input latching), §Pitfall 1 (naive accumulator drifts — empirically demonstrated), §Code Examples 1-3, §Validation Architecture (snapshot-hash determinism test) |

**Success-criteria coverage (from ROADMAP.md):**

| SC | Research Support |
|----|------------------|
| SC1 — same input, same time/end-state at 30/60/144fps | §Pitfall 1 + §Pattern 1 + §Code Example 4 (`world.takeSnapshot()` byte-hash comparison, verified converging across 8 refresh rates) |
| SC2 — smooth interpolated render at any refresh rate | §Pattern 4 (previous/current transform cache + alpha slerp), §Pitfall 4 (Rapier has no built-in interpolation) |
| SC3 — 60s alt-tab causes no teleport/explosion/fast-forward | §Pitfall 2 (clamp alone fast-forwards 5× for 12s — empirically demonstrated), §Pattern 5 (visibilitychange rebaseline) |
| SC4 — profiler HUD with physics ms, draw calls, triangles, body count vs. a written budget | §Pattern 6, §Code Example 5, §Frame Budget table |
| SC5 — map-data decision + road-graph schema recorded in repo | §Map Data Decision (ADR content), §Road Graph Schema v1 draft, §Pitfall 6 (design doc contradiction that must be retired) |
</phase_requirements>

## Summary

Every load-bearing claim in this research was verified by running code in this session against the exact pinned versions, not inferred from training data. Three findings materially change how this phase should be planned.

**First: the obvious fixed-timestep accumulator does not satisfy Success Criterion 1.** The textbook `acc += frameDelta; while (acc >= dt) { step(); acc -= dt; }` loop was run against Rapier 0.20.0 at 30/60/144fps for 10 simulated seconds. 30fps and 60fps produced bit-identical world snapshots (600 ticks). 144fps produced **599 ticks and a different snapshot hash**, because `1/144` is not exactly representable in binary floating point and the error accumulates. The fix is to derive the step target from an **absolute** monotonic timestamp (`ticks * DT < now - origin`) rather than an accumulated delta. Re-run across 30/60/75/90/120/144/165/240fps, that variant produced identical tick counts and bit-identical snapshot hashes at every rate. This is not a stylistic preference — it is the difference between passing and failing the phase's headline criterion.

**Second: clamping the accumulator does not satisfy Success Criterion 3.** A 60-second alt-tab backlogs 3600 ticks. With a max-substeps-per-frame clamp alone, the loop then burns its full clamp budget every frame — the simulation runs at **5× real time for roughly 12 seconds** after you return, which is precisely the "fast-forward the simulation" failure the criterion names. The correct fix is a clamp *plus* a clock rebaseline on `visibilitychange`: move the clock origin forward so the sim's tick count is redefined as "now", discarding the backlog. Verified: rebaselining produces zero fast-forward and exactly 1:1 resume. The clamp is still needed, but for a different failure (a single slow frame under load), not this one.

**Third: the stack in CLAUDE.md is correct and its one MEDIUM-confidence claim now verifies HIGH.** `@dimforge/rapier3d@0.20.0` (non-compat) builds and dev-serves under `vite@8.2.2` with **zero plugins and zero `optimizeDeps` configuration** — the production build emits a separate 2.02 MB hashed `.wasm` asset (774 KB gzipped) alongside a 190 KB JS bundle, and the dev server pre-bundles it and rewrites the wasm import correctly. `RAPIER.init()` is not needed (the non-compat `init.js` is literally `export {}`). The one genuine friction point is **Vitest**: with default config it fails with `Failed to resolve entry for package "@dimforge/rapier3d"` because the package ships only a `module` field (no `main`, no `exports`). Adding `ssr.resolve.mainFields: ["module", "main"]` fixes it. Without this, the phase's most valuable automated test cannot run at all.

**Primary recommendation:** Build the loop as an absolute-clock catch-up stepper whose sim time is `ticks × (1/60)` and whose input is latched per-tick, verify it with a `world.takeSnapshot()` byte-hash equality test across simulated refresh rates in Vitest, and handle alt-tab with a `visibilitychange` clock rebaseline in addition to a max-substeps clamp.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fixed-timestep stepping / sim clock | Simulation core (framework-free TS) | — | Must be pure and testable in Node under Vitest with no DOM. This is what makes SC1 automatable. |
| Wall-clock source + rAF driving | Browser / Client | — | `requestAnimationFrame` timestamp is the only correct clock; it is browser-only. Keep it at the edge so the core stays testable. |
| Visibility/stall detection | Browser / Client | Simulation core | `document.visibilitychange` is a browser event; it calls a pure `rebaseline(nowMs)` method on the core. |
| Physics world (Rapier/WASM) | Simulation core | — | Runs identically in Node and browser. Never touched by render code. |
| Render interpolation | Render layer | Simulation core (supplies alpha + prev/cur transforms) | The core owns tick state; the render layer owns the visual lerp. One-way dependency: render reads sim, never writes it. |
| Scene graph / camera / meshes | Render layer (Three.js) | — | Zero physics knowledge beyond a body handle. |
| Profiler HUD | Browser / Client (DOM overlay) | Render layer + Simulation core (data sources) | Absolutely-positioned HTML over the canvas, `pointer-events: none`. Zero draw calls, per CLAUDE.md. |
| Debug gating (`?debug` + hotkey) | Browser / Client | — | Query-param + keydown; must be tree-shakeable-ish and never affect sim timing. |
| Map-data decision + road-graph schema | Repo documentation / build-time contract | — | No runtime component in Phase 1. It is an ADR + a JSON Schema/zod contract + a fixture. |

## Standard Stack

All versions below were confirmed against the npm registry on **2026-09-08** and match CLAUDE.md exactly. No stack re-derivation was performed — CLAUDE.md is canon; this section is verification, not reconsideration.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `three` | `0.185.1` | Renderer, scene graph, `Timer` | Project canon (CLAUDE.md). Published 2026-07-01. `[VERIFIED: npm registry + tarball inspection]` |
| `@types/three` | `0.185.4` | Types (three ships none) | Must be bumped in lockstep with `three`. `[VERIFIED: npm registry]` |
| `@dimforge/rapier3d` | `0.20.0` | Physics, `World.step()`, snapshots | Non-compat build. No `RAPIER.init()` required — `init.js` is `export {}`. Published 2026-08-08. `[VERIFIED: npm pack + tarball read]` |
| `vite` | `8.2.2` | Dev server + build | Verified in this session to handle Rapier's `.wasm` ESM import with zero plugins. `[VERIFIED: ran `vite build` and `vite dev`]` |
| `typescript` | `7.0.2` | Typecheck (`tsc --noEmit`) | Published 2026-07-08 (two months settled, not bleeding-edge). Verified to typecheck a Rapier import cleanly with `moduleResolution: bundler`. `[VERIFIED: ran tsc]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | `5.0.0` | Unit tests, determinism harness | Phase 1 — this is where SC1 gets automated. Published 2026-09-03. `[VERIFIED: ran tests]` |
| `@biomejs/biome` | `2.5.12` | Lint + format, single binary | Phase 1 per D-08. `[VERIFIED: npm registry]` |
| `stats-gl` | `4.2.3` | **Optional.** Real GPU-time via `EXT_disjoint_timer_query_webgl2` | Only if you want true GPU ms. Not required by D-03/D-04. `[VERIFIED: found the extension string in `stats-gl/dist/core.js`]` |

### Explicitly NOT in Phase 1

| Library | Why deferred |
|---------|--------------|
| `lil-gui@0.21.0` | Phase 2 (vehicle tuning). D-05 only asks Phase 1 to establish the `?debug` *convention* it will later share. |
| `zod@4.5.4` | Phase 6 (save persistence). **Exception:** if the planner chooses to validate the road-graph schema fixture with zod rather than a hand-written checker, pulling it forward is defensible — but a plain JSON Schema doc + a 30-line assertion is lighter and keeps the schema language-agnostic for a future Python/Rust map compiler. Recommend: no zod in Phase 1. |
| `ngraph.path` / `ngraph.graph` | Phase 4+. The Phase 1 schema must be *shaped* so ngraph can consume it, but nothing is installed. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled DOM profiler HUD | `stats-gl@4.2.3` alone | stats-gl gives FPS/CPU/GPU ms but **not** draw calls, triangles, or Rapier body count. D-03 requires all of those. stats-gl is a complement, not a replacement. |
| Hand-rolled clock | `THREE.Timer` (`import { Timer } from 'three'`) | `Timer` correctly implements the visibility reset (`connect(document)` → on `hidden === false` it calls `reset()`; `_delta = 0` while hidden). **But** its `getElapsed()` is an accumulated float sum — the exact Variant-A drift bug. Use `Timer` only as a frame-delta source if you want; never as the sim clock. Recommend hand-rolling ~40 lines so the rebaseline semantics are explicit and unit-testable in Node. |
| Vitest (Node) determinism test | Vitest browser mode / Playwright | Browser mode tests the literal shipped artifact but is far slower and adds a browser dependency to CI. Node is sufficient: Rapier's WASM is the same binary, and the README guarantees local determinism on the same machine. |
| `@dimforge/rapier3d` in tests | `@dimforge/rapier3d-compat` as a test-only dep | Would sidestep the `mainFields` config, but you'd be testing a *different build artifact* than you ship — unacceptable for a determinism test. Fix the resolver instead. |

**Installation:**

```bash
npm install three@0.185.1 @dimforge/rapier3d@0.20.0
npm install -D vite@8.2.2 typescript@7.0.2 @types/three@0.185.4 vitest@5.0.0 @biomejs/biome@2.5.12
# optional, only if real GPU timing is wanted in the HUD:
# npm install -D stats-gl@4.2.3
```

## Package Legitimacy Audit

Run in this session. **Critical tool caveat discovered:** this repo has no `package.json` yet (greenfield), so `slopcheck` auto-detected the ecosystem as **PyPI** and reported four legitimate npm packages as `[SLOP]` — and then attempted `pip install typescript vite three`, which would have pulled three unrelated PyPI packages. **Always pass `-e npm` explicitly when running slopcheck in a repo with no `package.json`.** Re-run with `-e npm` gave clean results. (Verified: nothing was installed — `git status` clean, no `package.json`, `pip list` shows none of the three.)

| Package | Registry | Age | Source Repo | slopcheck (`-e npm`) | Disposition |
|---------|----------|-----|-------------|----------------------|-------------|
| `three` | npm | 0.185.1 pub. 2026-07-01 | github.com/mrdoob/three.js | [OK] | Approved |
| `@types/three` | npm | 0.185.4 pub. 2026-08-04 | github.com/DefinitelyTyped/DefinitelyTyped | [OK] | Approved |
| `@dimforge/rapier3d` | npm | 0.20.0 pub. 2026-08-08 | github.com/dimforge/rapier | [OK] | Approved |
| `vite` | npm | 8.2.2 pub. 2026-08-20 | github.com/vitejs/vite | [OK] | Approved |
| `typescript` | npm | 7.0.2 pub. 2026-07-08 | github.com/microsoft/TypeScript | [OK] | Approved |
| `@biomejs/biome` | npm | 2.5.12 pub. 2026-09-03 | github.com/biomejs/biome | [OK] | Approved |
| `stats-gl` | npm | 4.2.3 pub. 2026-07-10 | github.com/RenaudRohlinger/stats-gl | [OK] | Approved (optional) |
| `vitest` | npm | 5.0.0 pub. 2026-09-03 | github.com/vitest-dev/vitest | **[SUS]** | Approved — false positive |

**`vitest` [SUS] adjudication:** slopcheck flagged it solely as *"Suspiciously close to 'vite'. Could be a typosquat."* This is a false positive. `vitest` is the first-party test runner from the Vite organisation, repository `github.com/vitest-dev/vitest`, MIT, 483 published versions. It is named after Vite *because* it is Vite's test runner. **No `checkpoint:human-verify` needed.**

**Postinstall script audit:** `npm view <pkg> scripts.postinstall` returned empty for all eight packages. No install-time script execution.

**Packages removed due to [SLOP]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                 ┌───────────────────────────────────────────────┐
  browser        │  requestAnimationFrame(timestampMs)           │
  event loop ───►│  (DOMHighResTimeStamp, == document.timeline    │
                 │   .currentTime, same origin as performance.now)│
                 └────────────────────┬──────────────────────────┘
                                      │ nowMs (ABSOLUTE, never accumulated)
                                      ▼
       ┌──────────────────────────────────────────────────────────────┐
       │                      SimClock  (pure TS)                     │
       │  originMs, tick:int, DT = 1/60                               │
       │                                                              │
       │  simTimeSec  := tick * DT           ◄── the ONLY run clock   │
       │  targetTick  := (nowMs - originMs) / 1000 / DT               │
       │  steps       := clamp(targetTick - tick, 0, MAX_STEPS=5)     │
       └───────┬──────────────────────────────────────┬───────────────┘
               │ steps > 0                            │ alpha =
               │                                      │  frac of tick
   ┌───────────▼──────────────────┐                   │
   │  FIXED TICK  (repeat `steps`)│                   │
   │                              │                   │
   │  1. inputTape.sampleForTick  │  ◄── input latched PER TICK,       │
   │     (tick)                   │      never per render frame        │
   │  2. prevXform ← curXform     │  ◄── snapshot BEFORE stepping      │
   │  3. world.step(eventQueue)   │                   │
   │  4. drain events for THIS    │  ◄── must drain inside the loop,   │
   │     tick                     │      not once per frame            │
   │  5. curXform ← body.transl/  │                   │
   │     rotation()               │                   │
   │  6. tick++                   │                   │
   └───────────┬──────────────────┘                   │
               │                                      │
               │ prevXform, curXform                  │ alpha ∈ [0,1)
               ▼                                      ▼
       ┌──────────────────────────────────────────────────────────────┐
       │             RENDER  (once per rAF, never per tick)           │
       │  mesh.position.lerpVectors(prev.p, cur.p, alpha)             │
       │  mesh.quaternion.slerpQuaternions(prev.q, cur.q, alpha)      │
       │  renderer.render(scene, camera)                              │
       └───────────┬─────────────────────────────┬────────────────────┘
                   │ renderer.info.render        │ perf.now() deltas
                   │  .calls / .triangles        │ physicsMs, renderMs
                   ▼                             ▼
       ┌──────────────────────────────────────────────────────────────┐
       │   PROFILER HUD  (DOM overlay, pointer-events:none)           │
       │   gated by ?debug + hotkey.  world.bodies.len()              │
       │   compares each value to the WRITTEN FRAME BUDGET            │
       └──────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────────┐
  │  document 'visibilitychange'  ──► hidden→visible                   │
  │      SimClock.rebaseline(nowMs):                                   │
  │        originMs = nowMs - tick * DT * 1000                         │
  │      (discards the whole backlog; NO catch-up, NO fast-forward)    │
  └────────────────────────────────────────────────────────────────────┘

  Phase 1 build-time artifacts (no runtime component):
     docs/adr/0001-map-data-source.md  ──► freezes OSM + open DEM
     docs/schemas/road-graph.v1.md     ──► consumed by Phase 4 compiler
     fixtures/road-graph.sample.json   ──► validated by a unit test
```

### Recommended Project Structure

```
heat-street/
├── index.html
├── vite.config.ts
├── vitest.config.ts            # MUST set ssr.resolve.mainFields (see Pitfall 3)
├── tsconfig.json
├── biome.json
├── package.json
├── docs/
│   ├── adr/
│   │   └── 0001-map-data-source.md      # SC5 — the frozen legal decision
│   ├── schemas/
│   │   └── road-graph.v1.md             # SC5 — the road-graph schema
│   └── frame-budget.md                  # D-04 — the written budget the HUD is checked against
├── fixtures/
│   └── road-graph.sample.json           # tiny hand-written graph, validated by a test
├── src/
│   ├── main.ts                          # entry: wires runtime + debug scene
│   ├── core/                            # PURE, no DOM, no three — Node-testable
│   │   ├── sim-clock.ts                 # tick, originMs, advance(), rebaseline()
│   │   ├── frame-budget.ts              # the budget constants, imported by HUD + docs test
│   │   └── input-tape.ts                # per-tick input record/replay
│   ├── physics/
│   │   ├── world.ts                     # Rapier world factory, DT constant, step()
│   │   └── transform-cache.ts           # prev/cur transforms per body handle
│   ├── render/
│   │   ├── renderer.ts                  # WebGLRenderer setup
│   │   ├── interpolator.ts              # applies alpha to meshes
│   │   └── debug-scene.ts               # D-01/D-02: plane + falling/spinning boxes
│   ├── debug/
│   │   ├── profiler-hud.ts              # DOM overlay
│   │   └── debug-gate.ts                # ?debug query param + hotkey
│   └── loop.ts                          # rAF driver: the only place rAF is called
└── tests/
    ├── determinism.test.ts              # SC1 — snapshot hash across simulated rates
    ├── sim-clock.test.ts                # SC3 — rebaseline + clamp, pure, no browser
    ├── interpolation.test.ts            # SC2 — alpha bounds, alpha=1 ≡ cur, alpha=0 ≡ prev
    └── road-graph-schema.test.ts        # SC5 — fixture validates against schema
```

**Why `src/core` is framework-free:** it is what makes SC1 and SC3 automatable in Node. If the clock imports `three` or touches `document`, the tests need a browser and the phase's verification collapses into manual checking.

---

### Pattern 1: Absolute-clock catch-up stepper (NOT a delta accumulator)

**What:** Compute the target tick from an absolute monotonic timestamp each frame. Never accumulate frame deltas into a float.

**When to use:** Always. This is the phase's core deliverable.

**Why:** Verified in this session — the accumulator variant diverges at 144fps (599 ticks vs 600, different snapshot hash). The absolute variant produced identical tick counts and bit-identical Rapier snapshots at 30, 60, 75, 90, 120, 144, 165 and 240fps.

```ts
// src/core/sim-clock.ts
export const DT = 1 / 60;           // seconds
export const MAX_STEPS_PER_FRAME = 5;

export class SimClock {
  /** Monotonically increasing simulation tick index. */
  tick = 0;
  /** Wall-clock ms that corresponds to tick 0. Moves forward on rebaseline. */
  private originMs = 0;
  /** Ticks discarded by rebaseline — surfaced in the HUD so stalls are visible. */
  droppedTicks = 0;

  start(nowMs: number) {
    this.originMs = nowMs;
    this.tick = 0;
  }

  /**
   * How many fixed steps to run this frame. ABSOLUTE clock — the target is
   * recomputed from `nowMs` every frame, so float error never accumulates.
   */
  stepsFor(nowMs: number): number {
    const elapsedSec = (nowMs - this.originMs) / 1000;
    let steps = 0;
    while (this.tick * DT < elapsedSec && steps < MAX_STEPS_PER_FRAME) {
      this.tick++;
      steps++;
    }
    return steps;
  }

  /** Interpolation alpha in [0, 1) between tick-1 and tick. */
  alpha(nowMs: number): number {
    const elapsedSec = (nowMs - this.originMs) / 1000;
    const a = (elapsedSec - (this.tick - 1) * DT) / DT;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /**
   * Called when the tab becomes visible again, and as a safety net whenever
   * the backlog exceeds MAX_STEPS_PER_FRAME for a sustained period.
   * Redefines "now" as the current tick — the backlog is discarded, not replayed.
   */
  rebaseline(nowMs: number) {
    const behindSec = (nowMs - this.originMs) / 1000 - this.tick * DT;
    if (behindSec > 0) {
      this.droppedTicks += Math.floor(behindSec / DT);
      this.originMs = nowMs - this.tick * DT * 1000;
    }
  }

  /** THE run clock. Never `performance.now()`, never an accumulated sum. */
  get simTimeSec(): number {
    return this.tick * DT;
  }
}
```

> **Verified in session:** an epsilon term (`- DT * 0.5`) in the `while` condition made no difference at any of the eight tested rates. The absolute clock is what does the work; do not add unexplained epsilons.

### Pattern 2: The run clock is `tick × DT`, never wall time

**What:** Medal times, lap times, split deltas and the heat timer must all be computed from the integer tick count.

**Why:** This is what makes SC1's "same elapsed time" *definitionally* true rather than approximately true. A checkpoint crossed on tick 4382 is at 73.033…s on every machine at every refresh rate. If elapsed time is read from `performance.now()`, a 144Hz player and a 30Hz player get different numbers for the same drive, and every downstream medal comparison (Phase 6) inherits the error.

**Enforcement suggestion for the planner:** add a Biome lint rule or a grep-based test forbidding `performance.now()` and `Date.now()` outside `src/loop.ts` and `src/debug/`.

### Pattern 3: Input is latched per tick, not per frame

**What:** Raw keyboard/gamepad events are collected into a "pending" buffer as they arrive; at the top of each fixed tick that buffer is resolved into an immutable `InputFrame` for that tick index and consumed by the sim.

**Why:** This is the subtle half of SC1 that a stepping fix alone does not cover. If input is sampled once per rAF frame, a 144fps run feeds 144 distinct input samples per second into 60 ticks, while a 30fps run feeds 30 samples into the same 60 ticks — the tick sequence is identical but the *inputs to* that sequence are not, so the end states diverge for reasons that have nothing to do with the clock. The `InputTape` also becomes the recorded-input mechanism SC1 explicitly names ("the same recorded input"), so record/replay is a natural byproduct rather than test-only scaffolding.

```ts
// src/core/input-tape.ts — shape only; Phase 2 fills in the actual axes
export interface InputFrame { readonly steer: number; readonly throttle: number; readonly brake: number; readonly handbrake: boolean; }
export interface InputSource { /** Resolve accumulated events into this tick's immutable frame. */ sampleForTick(tick: number): InputFrame; }
export class RecordingInput implements InputSource { /* wraps a live source, appends to frames[] */ }
export class ReplayInput implements InputSource { constructor(private frames: readonly InputFrame[]) {} sampleForTick(t: number) { return this.frames[t] ?? NEUTRAL; } }
```

### Pattern 4: Interpolation via an explicit previous/current transform cache

**What:** Before each `world.step()`, copy the current transform into `prev`. After the step, read the new transform into `cur`. At render time, lerp/slerp between them by `alpha`.

**Why:** Rapier exposes no interpolated or predicted transform for dynamic bodies. `RigidBody.translation()` / `.rotation()` return the post-step state only. (`nextTranslation()` / `nextRotation()` exist but are the *kinematic* target set via `setNextKinematicTranslation` — not applicable to dynamic bodies.) You must cache both ends yourself.

Rapier's `Rotation` is `{x, y, z, w}` and `Vector` is `{x, y, z}` — structurally compatible with `THREE.Quaternion` / `THREE.Vector3`. Use `.set(...)` rather than `.copy(...)` to avoid depending on structural-typing details of `@types/three`.

```ts
// src/render/interpolator.ts
const p = new THREE.Vector3(), q = new THREE.Quaternion();
export function applyInterpolated(mesh: THREE.Object3D, prev: Xform, cur: Xform, alpha: number) {
  mesh.position.set(prev.px, prev.py, prev.pz).lerp(p.set(cur.px, cur.py, cur.pz), alpha);
  mesh.quaternion.set(prev.qx, prev.qy, prev.qz, prev.qw)
      .slerp(q.set(cur.qx, cur.qy, cur.qz, cur.qw), alpha);
}
```

**On frames where zero steps ran** (common at 144fps — most frames run 0 or 1 steps), `prev` and `cur` are unchanged and `alpha` advances, so the mesh keeps moving smoothly. That is the whole point, and it is what SC2 observes.

**Store transforms as flat `Float32Array`/`Float64Array` keyed by a dense body index**, not as objects. It matters little for Phase 1's handful of boxes, but Phase 7/8 will have dozens of pursuer bodies and this is the shape you want to have already committed to.

### Pattern 5: Alt-tab handling is clamp **AND** rebaseline

**What:**
- `MAX_STEPS_PER_FRAME` (5) protects against the spiral of death on a single slow frame.
- `rebaseline()` on `visibilitychange` (hidden → visible) protects against a long stall.

**Why both:** they solve different failures and neither substitutes for the other. See §Pitfall 2 for the measured evidence that the clamp alone fails SC3.

```ts
// src/loop.ts
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) clock.rebaseline(performance.now());
});
// Belt-and-braces: some stalls (debugger pause, long GC, OS sleep with the tab
// still "visible") never fire visibilitychange. Rebaseline if we saturate the
// clamp for several consecutive frames.
if (steps === MAX_STEPS_PER_FRAME) { if (++saturated > 30) { clock.rebaseline(nowMs); saturated = 0; } }
else saturated = 0;
```

`requestAnimationFrame` is documented as **paused** (not throttled) in background tabs, so no ticks run while hidden — the state is frozen, not integrated with a giant `dt`. There is therefore no "explode" risk from the physics itself; the risk is entirely in what the loop does on the *first frame back*.

### Pattern 6: Profiler HUD as a DOM overlay reading `renderer.info`

**What:** Absolutely-positioned `<div>` over the canvas with `pointer-events: none`, updated at ~5–10 Hz (not every frame — DOM writes at 144 Hz are themselves a frame-budget cost).

**Data sources (all verified against `three@0.185.1` / `@dimforge/rapier3d@0.20.0`):**

| HUD field | Source | Notes |
|-----------|--------|-------|
| Physics ms | `performance.now()` around the whole tick loop, divided by `steps` (and also reported as total-per-frame) | Report **both**: per-step ms is the tuning number, per-frame ms is the budget number. |
| Render ms | `performance.now()` around `renderer.render()` | **This is CPU submit time, not GPU time.** Label it honestly. `three@0.185.1`'s classic `WebGLRenderer` has no timer query — `EXT_disjoint_timer_query_webgl2` appears only in `src/renderers/webgl-fallback/` (the WebGPU-family backend). Add `stats-gl` if you want real GPU ms. |
| Draw calls | `renderer.info.render.calls` | `info.autoReset` defaults to `true` → info is reset at the *start* of each `render()`. Read it **after** `render()`, before the next frame. |
| Triangles | `renderer.info.render.triangles` | Same read-ordering rule. |
| Body count | `world.bodies.len()` | Total. For *active* bodies: `world.forEachActiveRigidBody(...)` with a counter, or `world.bodies.forEach(b => !b.isSleeping())`. D-03 says "active body count" — report both `active/total`. |
| Dropped ticks | `clock.droppedTicks` | Not in D-03 but nearly free and it makes SC3 directly observable in the HUD. Strongly recommended. |
| Steps this frame | `steps` | Makes clamp saturation visible. |

Also available if wanted: `renderer.info.memory.geometries`, `renderer.info.memory.textures`, `renderer.info.programs.length`.

### Anti-Patterns to Avoid

- **`acc += dt` frame-delta accumulation.** Demonstrably fails SC1 at 144fps. Use the absolute clock.
- **Reading elapsed run time from `performance.now()`.** Makes medal times framerate-dependent — the exact thing VEH-03 exists to prevent.
- **Sampling input in the rAF callback and using it for all ticks that frame.** Breaks SC1 even with a correct clock.
- **Clamping the accumulator and calling alt-tab "handled".** Produces a 5× fast-forward — see Pitfall 2.
- **Calling `renderer.render()` inside the fixed-tick loop.** Render exactly once per rAF frame. If you render per tick, the whole architecture collapses back into variable-rate rendering.
- **Reading `renderer.info` before `renderer.render()`.** With `autoReset: true` you read the previous frame's values minus whatever was already reset. Read after.
- **Draining the Rapier `EventQueue` once per frame rather than once per tick.** Not needed in Phase 1, but the loop's API must permit per-tick draining or Phase 5's checkpoint detection will silently miss crossings on multi-step frames. Design the tick callback signature for this now.
- **Putting `three` or `document` imports inside `src/core/`.** Kills Node testability, which is the phase's whole verification strategy.
- **`assetsInlineLimit` left at the Vite default.** Vite's docs are explicit: *".wasm files smaller than assetsInlineLimit will be inlined as base64."* Set it to `0` (already in CLAUDE.md).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Comparing two physics end-states for equality | A per-body float comparison with epsilons | `world.takeSnapshot(): Uint8Array` + a hash | Verified present in 0.20.0. Byte-exact, covers *every* piece of solver state (islands, sleeping flags, contact caches), and there is no epsilon to argue about. A float-position comparison would pass while the internal state has already diverged. |
| WASM loading / instantiation | A manual `WebAssembly.instantiateStreaming` wrapper, `vite-plugin-wasm`, `vite-plugin-top-level-await` | Nothing — Vite 8 handles it | Verified: zero plugins, zero `optimizeDeps` config, clean `vite build` and `vite dev`. |
| Rapier initialisation | `await RAPIER.init()` | Nothing | Non-compat `init.js` is literally `export {}`. Calling a non-existent `init()` is a common copy-paste error from `-compat` tutorials. |
| Page-visibility delta suppression | Hand-rolled `document.hidden` polling | `THREE.Timer` (`connect(document)`) *if* you want a ready-made frame-delta source | Its `handleVisibilityChange` calls `reset()` on becoming visible and zeroes `_delta` while hidden. Caveat: its `_elapsed` is an accumulated sum — never use it as the sim clock. |
| Quaternion interpolation | A hand-rolled slerp | `THREE.Quaternion.slerp` / `.slerpQuaternions` | Sign-flip / shortest-arc handling is where hand-rolled slerps break, and it shows up as a body visibly spinning the long way around once per revolution. |
| Draw call / triangle counting | Manual traversal of the scene graph | `renderer.info.render` | It counts what the renderer actually submitted, including instancing and culling — a scene-graph traversal counts what you *hoped* it would submit. |
| Geographic → world coordinate projection (Phase 4, but the schema must anticipate it) | Ad-hoc lat/lon → metres maths | A recorded ENU origin + a real projection library at compile time | Naive equirectangular scaling is fine for one small area and silently wrong for the next one. The Phase 1 schema must therefore *record the origin*, which is the thing that makes the choice fixable later. |

**Key insight:** almost everything this phase needs already exists in the two dependencies. The genuinely novel code is ~120 lines: the clock, the transform cache, the interpolator, and the HUD. The risk in this phase is not "can we build it" — it is "will the 120 lines be subtly wrong in a way that only shows up as inconsistent medal times in Phase 6." Every one of those 120 lines should have a Node-runnable test.

## Runtime State Inventory

Not applicable — this is a greenfield phase with no rename, refactor, or migration component. No prior code, no databases, no live services, no OS registrations, no secrets, no build artifacts exist. Verified: `git status` shows only an untracked `screenshots/` directory; no `package.json`, no `src/`, no `node_modules/` in the repo.

## Common Pitfalls

### Pitfall 1: The textbook accumulator diverges at non-60 refresh rates — SC1 FAILURE

**What goes wrong:** `acc += frameDelta; while (acc >= DT) { step(); acc -= DT; }` produces a different number of ticks — and therefore a different end state — at 144fps than at 60fps.

**Measured in this session** (`@dimforge/rapier3d@0.20.0`, 8 dynamic boxes on a static plane, 10 simulated seconds, FNV-1a hash of `world.takeSnapshot()`):

| Loop variant | 30fps | 60fps | 144fps |
|---|---|---|---|
| Delta accumulation | 600 ticks, `e68ecce6` | 600 ticks, `e68ecce6` | **599 ticks, `e91b9ed3`** |
| Absolute-clock catch-up | 600 ticks, `e68ecce6` | 600 ticks, `e68ecce6` | **600 ticks, `e68ecce6`** |

The absolute variant was additionally verified identical at 75, 90, 120, 165 and 240fps.

**Why it happens:** `1/144` has no exact binary representation. Summing it 1440 times lands slightly below 10.0, so the final tick never fires. The error is proportional to frame count, so it gets *worse* over a long run — a 10-minute Getaway at 144fps would drift by tens of ticks.

**How to avoid:** derive the target tick from an absolute timestamp (Pattern 1). Do not accumulate.

**Warning signs:** a determinism test that compares only final *positions* with an epsilon will happily pass while this bug is present. Compare snapshot bytes.

### Pitfall 2: A clamped accumulator alone fast-forwards after alt-tab — SC3 FAILURE

**What goes wrong:** after a 60-second alt-tab, the loop has a 3600-tick backlog. With `MAX_STEPS_PER_FRAME = 5` and no rebaseline, it runs 5 steps every frame until the backlog clears.

**Measured in this session** (pure clock model, 1s of play → 60s hidden → 1s of play at 60fps):

| Strategy | Ticks in the 1s after resume | Behaviour |
|---|---|---|
| Clamp only | **300** | 5× fast-forward. Takes ~12 real seconds to catch up. Ticks dropped: 0 (all replayed). |
| Clamp + rebaseline | **60** | Exact 1:1. Ticks dropped: 3600 (discarded cleanly). |

**Why it happens:** the clamp bounds *per-frame* work but not *total* work. It converts a single catastrophic frame into a sustained fast-forward — arguably worse for a driving game, because the player is now watching their car drive itself at 5× for twelve seconds.

**How to avoid:** `rebaseline()` on `visibilitychange` (hidden → visible), *plus* a saturation fallback for stalls that never fire the event (debugger pause, long GC, OS sleep). Keep the clamp — it still handles the genuine single-slow-frame case.

**Warning signs:** if SC3 is verified only by "did it explode," this bug passes. The acceptance check must be "did exactly one real second of simulation elapse in the first real second after returning."

### Pitfall 3: Vitest cannot resolve `@dimforge/rapier3d` with default config

**What goes wrong:** the determinism test — the single most valuable artifact in this phase — fails to even import.

```
Error: Failed to resolve entry for package "@dimforge/rapier3d".
The package may have incorrect main/module/exports specified in its package.json.
```

**Why it happens:** verified by reading the 0.20.0 tarball — the package.json has `"module": "rapier.js"` and `"types": "rapier.d.ts"` but **no `main` and no `exports` map**. Vite's client-side `resolve.mainFields` includes `module` by default, so the browser build works; the SSR/Node resolution path Vitest uses does not.

**How to avoid** — verified working:

```ts
// vitest.config.ts
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

With this, `import * as RAPIER from "@dimforge/rapier3d"` works in Node, `RAPIER.version()` returns `"0.20.0"`, and `World`/`RigidBodyDesc`/`ColliderDesc`/`takeSnapshot` all function.

**Warning signs:** if the planner sequences "write the loop" before "prove Rapier imports under Vitest," this blocks late and looks like a test-framework problem rather than a resolver problem.

### Pitfall 4: Assuming Rapier interpolates for you

**What goes wrong:** you render `body.translation()` directly and get judder at any refresh rate that isn't exactly 60.

**Why it happens:** Rapier's JS bindings expose only the post-step transform. There is no `interpolatedTranslation()`. `nextTranslation()` / `nextRotation()` exist but are the *kinematic target* set by `setNextKinematicTranslation` / `setNextKinematicRotation` — they are meaningless for dynamic bodies.

**How to avoid:** Pattern 4 — cache `prev` before stepping, `cur` after.

**Warning signs:** at 144fps, ~60% of frames run zero steps. Without interpolation those frames render an identical image, producing a distinctive 60Hz stutter inside a 144Hz presentation. This is exactly what SC2 is looking for.

### Pitfall 5: `renderer.info` read at the wrong time

**What goes wrong:** draw call / triangle counts read as 0 or as stale values.

**Why it happens:** `WebGLInfo.autoReset` defaults to `true` and the reset happens at the *start* of `renderer.render()`.

**How to avoid:** read `renderer.info.render.*` immediately after `renderer.render()` returns. If a later phase adds multiple render passes per frame (post-processing, minimap render target, occlusion pre-pass for CAM-04), set `renderer.info.autoReset = false` and call `renderer.info.reset()` yourself at the top of the frame — otherwise you will silently report only the last pass.

### Pitfall 6: The design doc still specifies the retired Google Maps pipeline

**What goes wrong:** a future agent reads `heat-street-design-doc.md` §5 ("Leroy has already built a separate tool that takes an area of Google Maps and exports it into files usable for game map creation. **This is the preferred pipeline**") or `CLAUDE.md` ("the road polylines you already have from the Google Maps extraction tool") and builds Phase 4 against Google-sourced data — violating the P0 legal decision in STATE.md and failing Phase 4 SC4.

**Why it happens:** the OSM decision was made at roadmap time and recorded in STATE.md, but the two older documents were never updated. There are currently **three** documents in the repo giving two contradictory answers.

**How to avoid:** SC5 is not satisfied by *adding* an ADR. It requires that the ADR **supersedes** the contradicting text. The plan must include an explicit task to amend `heat-street-design-doc.md` §5 and the CLAUDE.md minimap line with a pointer to the ADR. This is the highest-value five minutes in the phase.

**Warning signs:** an ADR that says "we chose OSM" without saying "this supersedes design-doc §5 and CLAUDE.md's Google Maps references" leaves the contradiction live.

### Pitfall 7: `slopcheck` auto-detects the wrong ecosystem in a greenfield repo

**What goes wrong:** with no `package.json`, `slopcheck install <npm packages>` defaults to PyPI, reports `@dimforge/rapier3d`, `@types/three`, `@biomejs/biome` and `stats-gl` as `[SLOP] — does not exist, your AI made it up`, and then runs `pip install typescript vite three`, pulling three unrelated PyPI packages.

**How to avoid:** always pass `-e npm`. Observed and confirmed in this session (see §Package Legitimacy Audit).

## Code Examples

### Example 1: The complete loop

```ts
// src/loop.ts
import { DT, MAX_STEPS_PER_FRAME, SimClock } from "./core/sim-clock";

export function startLoop(deps: {
  world: RAPIER.World;
  input: InputSource;
  transforms: TransformCache;
  render: (alpha: number) => void;
  hud?: (s: FrameStats) => void;
}) {
  const clock = new SimClock();
  let started = false;
  let saturated = 0;

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) clock.rebaseline(performance.now());
  });

  // rAF's timestamp is a DOMHighResTimeStamp on the same time origin as
  // performance.now(), and is identical for every callback in a frame.
  function frame(nowMs: number) {
    requestAnimationFrame(frame);
    if (!started) { clock.start(nowMs); started = true; return; }

    const tBefore = performance.now();
    const steps = clock.stepsFor(nowMs);
    for (let s = 0; s < steps; s++) {
      const tickIndex = clock.tick - steps + s;
      deps.transforms.captureAsPrevious();        // BEFORE the step
      applyInput(deps.world, deps.input.sampleForTick(tickIndex));
      deps.world.step();                          // eventQueue drained here in later phases
      deps.transforms.captureAsCurrent();         // AFTER the step
    }
    const physicsMs = performance.now() - tBefore;

    if (steps === MAX_STEPS_PER_FRAME) { if (++saturated > 30) { clock.rebaseline(nowMs); saturated = 0; } }
    else saturated = 0;

    const tRender = performance.now();
    deps.render(clock.alpha(nowMs));              // ONE render per frame, never per tick
    const renderMs = performance.now() - tRender;

    deps.hud?.({ physicsMs, renderMs, steps, tick: clock.tick,
                 simTimeSec: clock.simTimeSec, droppedTicks: clock.droppedTicks });
  }
  requestAnimationFrame(frame);
  return clock;
}
```

### Example 2: Rapier world setup (no `init()` needed)

```ts
// src/physics/world.ts
// Source: @dimforge/rapier3d@0.20.0 tarball — init.js is `export {}`.
// Importing this module makes it an ASYNC module (Vite's .wasm ESM integration
// requires top-level await), which is why build.target must be 'esnext'.
import * as RAPIER from "@dimforge/rapier3d";
import { DT } from "../core/sim-clock";

export function createWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;                    // MUST match the loop's DT exactly
  return world;
}

export function createDebugScene(world: RAPIER.World) {   // D-01 / D-02
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50), ground);

  const bodies: RAPIER.RigidBody[] = [];
  for (let i = 0; i < 6; i++) {
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(i * 1.3 - 3, 4 + i * 0.9, 0)
        // D-02: give it spin so interpolation is visibly exercised.
        .setAngvel({ x: 0.6, y: 2.4, z: 0.3 })
        .setLinearDamping(0.02),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.45), b);
    bodies.push(b);
  }
  return bodies;
}
```

> **D-02 note:** bodies that come to rest will **sleep**, and a sleeping body stops moving, so judder becomes unobservable. Either give one body a permanently-driven motion (a kinematic body rotated `DT` per tick, or a dynamic body kept awake with a small torque), or expose a `?debug` key that re-drops the boxes. The plan must include something that is *always* moving, or SC2 cannot be checked after the first ten seconds.

### Example 3: Transform cache

```ts
// src/physics/transform-cache.ts
export class TransformCache {
  private prev: Float64Array; private cur: Float64Array;   // 7 floats per body: px py pz qx qy qz qw
  constructor(private bodies: RAPIER.RigidBody[]) {
    this.prev = new Float64Array(bodies.length * 7);
    this.cur  = new Float64Array(bodies.length * 7);
    this.captureAsCurrent(); this.prev.set(this.cur);
  }
  captureAsPrevious() { this.prev.set(this.cur); }
  captureAsCurrent() {
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i], o = i * 7;
      const t = b.translation(), r = b.rotation();   // Vector {x,y,z}, Rotation {x,y,z,w}
      this.cur[o] = t.x; this.cur[o+1] = t.y; this.cur[o+2] = t.z;
      this.cur[o+3] = r.x; this.cur[o+4] = r.y; this.cur[o+5] = r.z; this.cur[o+6] = r.w;
    }
  }
  apply(meshes: THREE.Object3D[], alpha: number) {
    for (let i = 0; i < meshes.length; i++) {
      const o = i * 7, p = this.prev, c = this.cur, m = meshes[i];
      m.position.set(p[o], p[o+1], p[o+2]).lerp(TMP_V.set(c[o], c[o+1], c[o+2]), alpha);
      m.quaternion.set(p[o+3], p[o+4], p[o+5], p[o+6])
                  .slerp(TMP_Q.set(c[o+3], c[o+4], c[o+5], c[o+6]), alpha);
    }
  }
}
```

### Example 4: The SC1 determinism test (run and passing in this session)

```ts
// tests/determinism.test.ts
import { describe, expect, it } from "vitest";
import * as RAPIER from "@dimforge/rapier3d";
import { DT, SimClock } from "../src/core/sim-clock";

function fnv1a(bytes: Uint8Array) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}

/** Drive the REAL SimClock with synthetic frame timestamps for a given rate. */
function simulate(fps: number, seconds: number) {
  const world = buildFixture();                      // deterministic scene, no RNG
  const clock = new SimClock();
  clock.start(0);
  const frames = Math.round(seconds * fps);
  for (let f = 1; f <= frames; f++) {
    const steps = clock.stepsFor((f / fps) * 1000);  // absolute ms, not accumulated
    for (let s = 0; s < steps; s++) world.step();
  }
  return { ticks: clock.tick, hash: fnv1a(world.takeSnapshot()) };
}

describe("VEH-03: framerate-independent simulation", () => {
  it.each([30, 60, 75, 90, 120, 144, 165, 240])(
    "produces identical tick count and end state at %ifps", (fps) => {
      const baseline = simulate(60, 10);
      const actual = simulate(fps, 10);
      expect(actual.ticks).toBe(baseline.ticks);
      expect(actual.hash).toBe(baseline.hash);       // byte-exact world snapshot
    });

  it("is reproducible across runs", () => {
    expect(simulate(60, 5).hash).toBe(simulate(60, 5).hash);
  });

  it("snapshot hash is sensitive enough to detect a one-tick difference", () => {
    // guards against a hash that would pass trivially
    expect(runTicks(600).hash).not.toBe(runTicks(601).hash);
  });
});
```

> The third test is not padding. Without it, a bug that made `takeSnapshot()` return a constant would make the whole suite green.

### Example 5: Profiler HUD

```ts
// src/debug/profiler-hud.ts
import { BUDGET } from "../core/frame-budget";

export function createHud(renderer: THREE.WebGLRenderer, world: RAPIER.World) {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:10;pointer-events:none;" +
    "font:11px/1.45 ui-monospace,monospace;color:#e8e8e8;background:rgba(0,0,0,.62);" +
    "padding:6px 9px;border-radius:4px;white-space:pre;display:none";
  document.body.appendChild(el);

  let acc = 0, samples = 0, pSum = 0, rSum = 0;
  const over = (v: number, budget: number) => (v > budget ? " !" : "");

  return {
    toggle: () => { el.style.display = el.style.display === "none" ? "block" : "none"; },
    update(s: FrameStats, dtMs: number) {
      pSum += s.physicsMs; rSum += s.renderMs; samples++; acc += dtMs;
      if (acc < 150) return;                          // ~7 Hz DOM writes, not 144 Hz
      const p = pSum / samples, r = rSum / samples;
      const info = renderer.info;                     // read AFTER render(); autoReset === true
      let active = 0; world.forEachActiveRigidBody(() => active++);
      el.textContent =
        `frame  ${(acc / samples).toFixed(2)}ms / ${BUDGET.frameMs}ms${over(acc / samples, BUDGET.frameMs)}\n` +
        `physics ${p.toFixed(2)}ms / ${BUDGET.physicsMs}ms${over(p, BUDGET.physicsMs)}  (${s.steps} step/f)\n` +
        `render  ${r.toFixed(2)}ms / ${BUDGET.renderCpuMs}ms${over(r, BUDGET.renderCpuMs)}  (cpu submit)\n` +
        `draws   ${info.render.calls} / ${BUDGET.drawCalls}${over(info.render.calls, BUDGET.drawCalls)}\n` +
        `tris    ${info.render.triangles} / ${BUDGET.triangles}${over(info.render.triangles, BUDGET.triangles)}\n` +
        `bodies  ${active} active / ${world.bodies.len()} total\n` +
        `tick    ${s.tick}   sim ${s.simTimeSec.toFixed(3)}s   dropped ${s.droppedTicks}`;
      acc = 0; samples = 0; pSum = 0; rSum = 0;
    },
  };
}
```

### Example 6: Debug gate (D-05)

```ts
// src/debug/debug-gate.ts
// Convention Phase 2's lil-gui panel will reuse: ?debug enables debug tooling,
// a single key toggles visibility.
export const DEBUG_ENABLED = new URLSearchParams(location.search).has("debug");

export function onDebugToggle(fn: () => void) {
  if (!DEBUG_ENABLED) return;
  addEventListener("keydown", (e) => {
    // Backtick. Guard against repeat and against typing in a future text field.
    if (e.code === "Backquote" && !e.repeat && !e.metaKey && !e.ctrlKey) { e.preventDefault(); fn(); }
  });
}
```

## Frame Budget (D-04)

Write this to `docs/frame-budget.md` **and** mirror it as `src/core/frame-budget.ts` constants so the HUD and the doc cannot drift. D-04 fixes the total (16.6ms) and physics (≤4ms); the remaining split below is a research recommendation.

| Slice | Budget @ 60fps | Basis |
|-------|---------------|-------|
| **Total frame** | **16.6 ms** | D-04 (locked) |
| **Physics step (all steps this frame)** | **≤ 4.0 ms** | D-04 (locked) |
| Render, CPU submit | ≤ 6.0 ms | Recommendation. Leaves room for Phase 4's chunked city colliders and Phase 3's shadow pass. |
| Game logic (input, camera, interpolation, HUD) | ≤ 2.0 ms | Recommendation. |
| Browser / compositor / GC headroom | ≥ 4.6 ms | Recommendation. Never budget to 100%. |

**Phase 1 debug-scene targets** (the numbers the HUD should actually be showing when this phase is verified — a bare box scene must sit far under budget or something is already wrong):

| Metric | Phase 1 target |
|--------|---------------|
| Physics ms/frame | < 0.5 ms |
| Draw calls | < 20 |
| Triangles | < 10,000 |
| Total bodies | < 20 |

**Grounding for the 4 ms physics budget** — measured in this session (Node v24.14.1, Rapier 0.20.0, cuboid stacks on a static plane, 600 steps after a 120-step settle):

| Bodies | ms / step |
|--------|----------|
| 2 | 0.006 |
| 11 | 0.008 |
| 51 | 0.004 |
| 201 | 0.008 |
| 501 | 0.212 |

Caveat, stated honestly: most of these bodies **sleep** after settling, so this is a floor, not a worst case. A fully-awake scene with a vehicle controller and a dozen pursuers will be materially higher. The useful conclusion is one of scale, not precision: 4 ms is a very generous budget for Rapier at this project's entity counts, and physics is unlikely to be the bottleneck before Phase 7.

## Map Data Decision — content for `docs/adr/0001-map-data-source.md` (SC5)

The decision itself is **already locked** by STATE.md ("Map data source is OpenStreetMap + open DEM — no Google-sourced bytes may enter the shipped pipeline (P0 legal decision, must be frozen in Phase 1)"). This section supplies the citations and the supersession list so the ADR is defensible rather than assertive.

**Road network — OpenStreetMap**
- Licence: **Open Database License (ODbL) v1.0**. `[CITED: openstreetmap.org/copyright]`
- Required attribution: *"Attribution must be to 'OpenStreetMap.'"* The historical forms **"© OpenStreetMap contributors"** and "© OpenStreetMap" are explicitly acceptable. `[CITED: osmfoundation.org/wiki/Licence/Attribution_Guidelines]`
- For **games** specifically, the OSMF guidelines state attribution may appear *"on the credits page, in the menu, or in another suitable location."* For media where linking is not possible, *"the URL to openstreetmap.org/copyright must be included."* `[CITED: osmfoundation.org/wiki/Licence/Attribution_Guidelines]`
- Practical extract sources for Phase 4: Geofabrik regional `.osm.pbf` extracts, BBBike custom-area extracts, or the Overpass API for small areas. `[ASSUMED — not verified in this session; confirm before Phase 4]`

**Elevation — pick one, both are compatible with shipping a commercial game**

| Source | Coverage | Licence | Required notice |
|---|---|---|---|
| **USGS 3DEP** (1m / 1/3-arc-second) | US only | **Public domain**, *"available free of charge and without use restrictions"*; USGS *requests* (does not require) acknowledgment `[CITED: usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map]` | Optional courtesy credit |
| **Copernicus DEM GLO-30** (30m) | Global | Free worldwide licence, commercial use permitted, *"worldwide and without limitation in time"* `[CITED: documentation.dataspace.copernicus.eu ... License-COPDEM-30.pdf]` | **Mandatory:** *"© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved."* Modified data: *"produced using Copernicus WorldDEM-30 © DLR e.V. …"* |

**Recommendation:** if the first area is in the US, use **3DEP** — public domain with no mandatory notice is strictly simpler, and 1m resolution is far better than 30m for road surfaces. Use Copernicus GLO-30 as the global fallback. Record whichever is chosen in the ADR *and* in the compiled map's `attribution` block (§Road Graph Schema) so the credits screen can be generated from the data rather than hand-maintained.

**Prohibition to state explicitly in the ADR:** no bytes derived from Google Maps, Google Earth, or Street View may enter the repository, the asset pipeline, or the shipped build — including road geometry traced from Google imagery. Google Maps Platform ToS §3.2.4 ("Restrictions Against Misusing the Services") prohibits scraping, pre-fetching, storing, resharing or rehosting Maps Content outside the Services, bulk-downloading roads/elevation data, and creating content based on Maps Content. `[CITED: cloud.google.com/maps-platform/terms — MEDIUM confidence: the clause could not be retrieved verbatim in this session (the page truncates); section number and substance corroborated by multiple secondary sources. Not legal advice.]`

**Supersession list — the ADR must name these (see Pitfall 6):**
1. `heat-street-design-doc.md` §5 — *"Leroy has already built a separate tool that takes an area of Google Maps and exports it… This is the preferred pipeline."* **Superseded.**
2. `CLAUDE.md` → Game Loop/UI section, minimap bullet — *"the road polylines you already have from the Google Maps extraction tool."* **Superseded** — polylines come from the OSM-derived road graph.
3. `PROJECT.md` §5 does not mention Google and needs no change.

**Open legal question to flag, not to answer:** ODbL distinguishes a *Produced Work* (attribution only) from a *Derivative Database* (must be released under ODbL). The compiled `.glb` mesh is almost certainly a Produced Work. The `.map.json` road graph — a structured, machine-readable extraction of OSM ways and nodes — is plausibly a **Derivative Database**, which would require releasing it under ODbL if distributed. Recommended safe path: license `*.map.json` under ODbL 1.0 in the repo (a `LICENSE-MAPDATA` file next to the artifacts) and note this in the ADR. This costs nothing for a solo v1 and removes the ambiguity. **Flag for the user rather than deciding silently.**

## Road Graph Schema v1 — content for `docs/schemas/road-graph.v1.md` (SC5)

Phase 1 records the contract; Phase 4 implements the compiler that emits it. The schema must serve NAV-03 (minimap polylines), NAV-04/05 (road-aware pathfinding), P2P-01/CIRC-01 (checkpoint placement), CIRC-02/GET-01/03 (AI pathfinding), SURF-01 (surface types carried from source), and Phase 4 SC3 ("collision geometry, nav graph and route/checkpoint placement all derive from the same road graph").

```jsonc
{
  "schemaVersion": 1,
  "areaId": "area-01",
  "name": "Human-readable area name",

  // Provenance — Phase 4 SC3 requires a one-command reproducible rebuild.
  "source": {
    "osmExtract": "geofabrik://<region>/<file>.osm.pbf",
    "osmSnapshot": "2026-09-01T00:00:00Z",
    "demSource": "usgs-3dep-1m",            // or "copernicus-glo30"
    "compilerVersion": "0.1.0"
  },

  // Generated straight into the credits screen — never hand-maintained.
  "attribution": {
    "osm": "© OpenStreetMap contributors",
    "osmLicense": "ODbL-1.0",
    "osmLicenseUrl": "https://www.openstreetmap.org/copyright",
    "dem": "U.S. Geological Survey 3D Elevation Program (public domain)"
  },

  // World origin. ALL coordinates below are local metres, Y-up (three.js convention),
  // X=east, Z=south. Recording the origin is what makes the projection choice fixable later.
  "origin": { "lat": 0.0, "lon": 0.0, "projection": "local-enu-metres" },
  "bounds": { "minX": 0, "minZ": 0, "maxX": 0, "maxZ": 0 },

  // Dense 0..n-1 integer ids assigned by the compiler. NOT OSM node ids —
  // ngraph and typed arrays both want dense ints. OSM id kept for provenance only.
  "nodes": [
    { "id": 0, "x": 0.0, "y": 0.0, "z": 0.0, "junction": true, "osmNodeId": 0 }
  ],

  // Stored UNDIRECTED with a `oneway` flag. The runtime builds a directed
  // ngraph from this; the minimap and collision builder want it undirected.
  "edges": [
    {
      "id": 0,
      "from": 0,
      "to": 1,
      // Centreline polyline INCLUDING both endpoints, local metres.
      // Feeds: collision ribbon generation, minimap draw, AI racing line, arrow heading.
      "points": [[0, 0, 0], [10, 0.2, 0]],
      "lengthM": 10.0,
      // Game surface ENUM — never a raw OSM string. The compiler owns the
      // mapping table so an unknown OSM value fails the BUILD, not the runtime.
      "surface": "tarmac",                  // tarmac|gravel|dirt_road|grass|sand|mud
      "roadClass": "residential",           // from OSM highway=*
      "lanes": 2,
      "widthM": 6.5,
      "oneway": false,
      "speedLimitKph": 50,
      "bridge": false,
      "tunnel": false,
      "layer": 0,                           // OSM layer=* — bridge/tunnel z-ordering
      "osmWayId": 0
    }
  ],

  // Optional in v1; route/checkpoint authoring may move to a sibling file in Phase 5.
  "spawns": [ { "id": "default", "nodeId": 0, "headingRad": 0.0 } ]
}
```

**Design decisions to record alongside the schema (these are the parts that are expensive to change later):**

1. **Coordinates are local ENU metres with a recorded lat/lon origin, Y-up.** Lat/lon never reaches the runtime. Y is authored by the compiler from the DEM (sampled and smoothed along each centreline), not sampled at runtime — SURF-01's per-wheel friction and Phase 4's "no bumpy junctions" both depend on the road surface being a deliberately smoothed artifact.
2. **Node ids are compiler-assigned dense integers.** OSM ids are 64-bit and sparse; keeping them as the primary key forces hash maps where typed arrays would do, and Phase 7's AI will be doing a lot of graph traversal.
3. **Edges are undirected + a `oneway` flag.** One representation serving three consumers (collision, minimap, pathfinding) is what makes Phase 4 SC3 ("all derive from the same road graph") achievable rather than aspirational.
4. **`surface` is a closed game enum; the OSM→game mapping lives in the compiler.** Unknown OSM `surface` values must fail the build loudly. A runtime default silently turns an unmapped dirt track into tarmac, which is exactly the kind of bug that is invisible until a medal time is inexplicable.
5. **`schemaVersion` is mandatory from v1.** Phase 4 rebuilds and Phase 6 persistence both need to detect stale artifacts.
6. **Provenance fields are mandatory, not optional.** Without `osmSnapshot` and `compilerVersion` a map cannot be reproduced or diffed, and Phase 4 SC3's "rebuilds from source with one command" is unverifiable.

**Suggested OSM → game surface mapping table (draft for the ADR/schema doc):**

| Game surface | OSM `surface=*` values | Fallback from `highway=*` when `surface` absent |
|---|---|---|
| `tarmac` | `asphalt`, `concrete`, `concrete:plates`, `paved`, `chipseal`, `paving_stones`, `sett` | `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `residential`, `unclassified`, `service` |
| `gravel` | `gravel`, `fine_gravel`, `pebblestone` | — |
| `dirt_road` | `compacted`, `dirt`, `earth`, `ground`, `unpaved` | `track` |
| `grass` | `grass`, `grass_paver` | — |
| `sand` | `sand` | — |
| `mud` | `mud` | — |

All 15 of the OSM values above were confirmed to be documented values of `surface=*`. `[CITED: wiki.openstreetmap.org/wiki/Key:surface]` Note the wiki flags `cobblestone` as *"an unclear value"* and recommends `sett` / `unhewn_cobblestone` — worth handling explicitly rather than lumping it into `tarmac`.

**Phase 1 deliverable for this section is three files, no code:** the schema doc, a small hand-written `fixtures/road-graph.sample.json` (a 4-node square loop with one gravel edge), and a test that asserts the fixture matches the schema. That makes SC5 automatable instead of "a human confirms a doc exists."

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vite-plugin-wasm` + `vite-plugin-top-level-await` for Rapier | Native `.wasm` ESM integration, zero plugins at `build.target: 'esnext'` | Vite's WASM ESM integration; verified working in 8.2.2 | Two dependencies and a config block that most tutorials still show are now dead weight. Verified this session. |
| `await RAPIER.init()` | Nothing (non-compat build) | Present in 0.20.0 (`init.js` is `export {}`) | Copy-pasting `-compat` tutorials produces a runtime error. |
| `three/examples/jsm/...` | `three/addons/...` | Official alias in three's `exports` map — confirmed present in 0.185.1 | Cosmetic but the `exports` map is the supported surface. |
| `stats.js` | `stats-gl@4.2.3` | — | WebGL/WebGPU-aware, real GPU timer query. Still doesn't give draw calls/triangles/bodies. |
| Comparing physics states by position epsilon | `world.takeSnapshot()` byte hash | Available in 0.20.0 | Strictly stronger and simpler. |

**Deprecated/outdated for this phase:**
- `optimizeDeps.exclude: ['@dimforge/rapier3d']` — CLAUDE.md lists it as a conditional fallback ("*if* the dev server pre-bundler chokes"). Verified: Vite 8.2.2 pre-bundles it correctly and rewrites the wasm import to `/node_modules/@dimforge/rapier3d/rapier_wasm3d_bg.wasm?import`, which serves 200. **Do not add it.**
- The Google Maps extraction pipeline in `heat-street-design-doc.md` §5 — superseded by the OSM decision.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Geofabrik / BBBike / Overpass are the practical OSM extract sources for Phase 4 | Map Data Decision | Low. Phase 4 concern; the ADR only needs to name the licence and the prohibition, not the download mechanism. |
| A2 | Node-measured Rapier step costs are representative of browser V8 within an order of magnitude | Frame Budget | Low. The budget is 4 ms and the measurement is 0.006–0.2 ms; even a 10× browser penalty leaves enormous headroom. Re-measure in-browser once the HUD exists — that is literally what the HUD is for. |
| A3 | The 6.0 / 2.0 / 4.6 ms split of the non-physics frame budget | Frame Budget | Low. D-04 locks only the 16.6 and ≤4 numbers. The split is a starting recommendation to be revised in Phase 3 when the shadow pass lands. |
| A4 | Backtick (`Backquote`) is the right HUD toggle key | Debug Gate | Trivial. D-05 says "e.g. backtick or F1" — either satisfies the criterion. |
| A5 | US-first area selection makes 3DEP the better DEM choice | Map Data Decision | Low. If the first area is non-US, Copernicus GLO-30 is the documented fallback and the only cost is a mandatory credits line. **Worth asking the user which real-world area Phase 4 targets** — it changes the DEM choice and the resolution available. |
| A6 | Google Maps Platform ToS §3.2.4 substance as summarised | Map Data Decision | Low for the decision (already locked by the user as P0), but the ADR should link the ToS rather than paraphrase it as fact. Verbatim clause text was not retrievable this session. |

## Open Questions

1. **Should the compiled `.map.json` be released under ODbL?**
   - What we know: the `.glb` is almost certainly an ODbL "Produced Work" (attribution only). ODbL's Derivative Database provisions are real and the road graph is a structured extraction of OSM data.
   - What's unclear: whether a game's compiled nav graph legally constitutes a Derivative Database. This is a genuine legal grey area, not something research can settle.
   - Recommendation: take the free safe path — add `LICENSE-MAPDATA` (ODbL 1.0) covering `*.map.json`, note it in the ADR, and surface it to the user as an explicit decision rather than burying it.

2. **Which real-world area does Phase 4 target?**
   - What we know: STATE.md locks OSM + open DEM; ROADMAP Phase 4 says "one area."
   - What's unclear: geography. This determines whether 3DEP (US, 1m, public domain) or Copernicus GLO-30 (global, 30m, mandatory notice) is used — and 1m vs 30m is a large difference for road surfaces.
   - Recommendation: the ADR should record *both* as approved sources with a selection rule, rather than blocking on the answer. Flag the question to the user.

3. **Is `MAX_STEPS_PER_FRAME = 5` the right clamp?**
   - What we know: 5 gives a 5× worst-case catch-up rate, and with the rebaseline it only ever applies to short stalls.
   - What's unclear: whether a 30fps player on a weak machine (2 steps/frame steady-state) has enough margin. Not measurable until Phase 2 has a real load.
   - Recommendation: make it a named exported constant, surface "steps this frame" in the HUD, and revisit in Phase 3 profiling. Do not tune it in Phase 1 against a scene of six boxes.

4. **Should the phase also pin a Node version / add an `.nvmrc`?**
   - What we know: verified on Node v24.14.1. Vite 8 and Vitest 5 both have Node engine floors.
   - Recommendation: cheap to add an `engines` field and `.nvmrc`; not required by any success criterion. Planner's call.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite, Vitest, npm | ✓ | v24.14.1 | — |
| npm | D-07 package manager | ✓ | bundled with Node 24 | — |
| Python + pip | slopcheck (research tooling only) | ✓ | Python 3.14 | Mark packages `[ASSUMED]` |
| slopcheck | Package legitimacy gate | ✓ | installed this session | Must pass `-e npm` (see Pitfall 7) |
| Git | Repo, `commit_docs: true` | ✓ | repo on branch `master` | — |
| A browser with WebGL2 | SC2, SC3, SC4 manual verification | ✓ (assumed — dev machine is Windows 11) | — | None. SC2/SC3/SC4 cannot be fully verified headlessly. |

**Missing dependencies with no fallback:** none.

**Notes:**
- The repo currently has **no `package.json`, no `src/`, no `node_modules/`.** Wave 0 of this phase is literal project initialisation.
- Branch is `master`; `config.json` sets `git.branching_strategy: "none"`, so work happens in place.
- `.claude/skills/` and `.agents/skills/` do **not** exist — no project skills to honour.
- `brave_search`, `firecrawl`, `exa_search` are all `false` in `.planning/config.json`; this research used built-in WebSearch/WebFetch plus direct tarball inspection and executable spikes.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@5.0.0` |
| Config file | **none — Wave 0 must create `vitest.config.ts`** (and it MUST include the `mainFields` fix from Pitfall 3) |
| Quick run command | `npx vitest run tests/sim-clock.test.ts` (~0.2 s, no WASM) |
| Full suite command | `npx vitest run` |
| Typecheck | `npx tsc --noEmit` (verified clean with `typescript@7.0.2`, `moduleResolution: bundler`) |
| Lint | `npx biome check .` |

### Phase Requirements → Test Map

| Req / SC | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| VEH-03 / SC1 | Identical tick count + byte-identical world snapshot at 30/60/75/90/120/144/165/240fps | unit | `npx vitest run tests/determinism.test.ts` | ❌ Wave 0 |
| VEH-03 / SC1 | A recorded input tape replayed at different rates yields the same end snapshot | unit | `npx vitest run tests/determinism.test.ts -t "input tape"` | ❌ Wave 0 |
| VEH-03 / SC1 | Snapshot hash detects a one-tick difference (guards against a trivially-passing hash) | unit | `npx vitest run tests/determinism.test.ts -t "sensitive"` | ❌ Wave 0 |
| SC1 | Run clock equals `tick × DT` exactly; no `performance.now()` leaks into sim code | unit + grep | `npx vitest run tests/sim-clock.test.ts` | ❌ Wave 0 |
| SC2 | `alpha` stays in `[0,1]`; `alpha=0` ≡ prev transform, `alpha=1` ≡ cur transform | unit | `npx vitest run tests/interpolation.test.ts` | ❌ Wave 0 |
| SC2 | Judder is visually absent at 30/60/144 Hz | **manual** | — | Requires a real display at multiple refresh rates. Genuinely not automatable. |
| SC3 | After a 60 s stall, exactly 1 real second of sim elapses in the next real second (no fast-forward) | unit | `npx vitest run tests/sim-clock.test.ts -t "stall"` | ❌ Wave 0 |
| SC3 | Rebaseline reports the dropped-tick count and does not rewind `tick` | unit | `npx vitest run tests/sim-clock.test.ts -t "rebaseline"` | ❌ Wave 0 |
| SC3 | Real alt-tab for 60 s in a browser: no teleport, explosion, or fast-forward | **manual** | — | The unit test covers the mechanism; the manual check covers the wiring. |
| SC4 | HUD budget constants match `docs/frame-budget.md` (no drift) | unit | `npx vitest run tests/frame-budget.test.ts` | ❌ Wave 0 |
| SC4 | HUD shows all of: physics ms, render ms, draw calls, triangles, body count, vs. budget | **manual** | — | Needs a real WebGL context. |
| SC5 | `docs/adr/0001-map-data-source.md` and `docs/schemas/road-graph.v1.md` exist and are non-empty | unit | `npx vitest run tests/docs-present.test.ts` | ❌ Wave 0 |
| SC5 | `fixtures/road-graph.sample.json` conforms to the v1 schema | unit | `npx vitest run tests/road-graph-schema.test.ts` | ❌ Wave 0 |
| SC5 | No file in the repo recommends the Google Maps pipeline without a supersession pointer | unit (grep) | `npx vitest run tests/no-google-pipeline.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/sim-clock.test.ts && npx tsc --noEmit` (~2 s, no WASM load)
- **Per wave merge:** `npx vitest run && npx tsc --noEmit && npx biome check .`
- **Phase gate:** full suite green, plus the four manual browser checks (SC2 judder at 3 refresh rates, SC3 real alt-tab, SC4 HUD contents, `?debug` gating) before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `package.json` — does not exist; project init
- [ ] `tsconfig.json` — verified-working config given in §Pitfall 3 discussion / spike
- [ ] `vite.config.ts` — `build.target: 'esnext'`, `assetsInlineLimit: 0`
- [ ] `vitest.config.ts` — **must** include `resolve.mainFields` + `ssr.resolve.mainFields` + `server.deps.inline`, or every Rapier test fails to import (covers SC1)
- [ ] `biome.json` — D-08
- [ ] `tests/sim-clock.test.ts` — covers SC1, SC3
- [ ] `tests/determinism.test.ts` — covers VEH-03, SC1
- [ ] `tests/interpolation.test.ts` — covers SC2
- [ ] `tests/frame-budget.test.ts` — covers SC4
- [ ] `tests/road-graph-schema.test.ts`, `tests/docs-present.test.ts`, `tests/no-google-pipeline.test.ts` — cover SC5
- [ ] Framework install: `npm i -D vitest@5.0.0`

> **Sequencing note for the planner:** put "install deps + `vitest.config.ts` + a trivial `RAPIER.version()` smoke test" in the very first wave. It is a ten-minute task that de-risks the entire phase's verification strategy, and it fails loudly and immediately if the resolver config is wrong.

## Security Domain

`security_enforcement` is not present in `.planning/config.json` (absent = enabled), so this section is included. This is a local, offline, single-player browser game with no backend, no accounts, no network I/O and no user-supplied data in Phase 1. Most ASVS categories do not apply.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No accounts, no auth, no backend in v1 |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No multi-user surface |
| V5 Input Validation | **partial** | The only externally-influenced input in Phase 1 is the `?debug` URL query param. It must be treated as a boolean presence check only (`URLSearchParams.has("debug")`) and **never** interpolated into DOM/HTML. Phase 4's `.map.json` and Phase 6's `localStorage` are the real validation surfaces (zod), out of scope here. |
| V6 Cryptography | no | The FNV-1a hash in the determinism test is a **non-cryptographic** fingerprint for test equality only. Do not describe it as a checksum or use it for integrity. |
| V14 Configuration | **yes** | Supply-chain: pinned exact versions, `package-lock.json` committed, slopcheck gate run (see §Package Legitimacy Audit), no packages with postinstall scripts. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquatted / hallucinated npm package | Tampering | slopcheck with explicit `-e npm`; all 8 packages verified with real source repos and no postinstall scripts |
| Dependency drift between install and CI | Tampering | Commit `package-lock.json`; pin exact versions (no `^`) for `three` and `@dimforge/rapier3d`, where a patch bump can change physics behaviour and therefore medal times |
| DOM XSS via debug HUD | Tampering | HUD uses `textContent`, never `innerHTML`. Enforced in Example 5. |
| Query-param injection into the debug gate | Tampering | Presence check only; never read the *value*, never render it |
| Malicious/oversized `.glb` or `.map.json` (later phases) | DoS | Out of scope Phase 1, but the schema's `schemaVersion` field is the hook that makes Phase 4 validation possible |

**Supply-chain note worth acting on in Phase 1:** because a `three` or `@dimforge/rapier3d` patch release could alter solver behaviour and silently invalidate every recorded medal time, pin those two to **exact** versions (`"0.185.1"`, `"0.20.0"`) with no range prefix, and treat bumping them as a change that requires re-recording the Phase 6 designer reference runs. Worth a line in the ADR or a `docs/` note.

## Sources

### Primary (HIGH confidence — verified by execution or direct artifact inspection in this session)
- **Executed spike**: `vitest@5.0.0` + `@dimforge/rapier3d@0.20.0` in Node v24.14.1 — accumulator drift measurements, `takeSnapshot()` hash comparison across 8 refresh rates, stall/rebaseline model, Rapier step-cost benchmark
- **Executed spike**: `vite@8.2.2 build` and `vite dev` with a Rapier import — 2.02 MB separate wasm asset, dev-server import rewriting, zero plugins/`optimizeDeps` needed
- **Executed spike**: `tsc --noEmit` with `typescript@7.0.2`, `moduleResolution: bundler` — clean
- **`@dimforge/rapier3d@0.20.0` tarball** (`npm pack`) — read `package.json` (no `main`/`exports`), `init.js` (`export {}`), `rapier_wasm3d.js` (wasm-bindgen bundler target), `pipeline/world.d.ts` (`step`, `timestep`, `takeSnapshot`, `restoreSnapshot`, `bodies`, `forEachActiveRigidBody`), `dynamics/rigid_body.d.ts`, `dynamics/rigid_body_set.d.ts` (`len()`), `dynamics/integration_parameters.d.ts`, `math.d.ts`, `pipeline/event_queue.d.ts`, `README.md` (local-determinism guarantee, package variants)
- **`three@0.185.1` + `@types/three@0.185.4` installed** — read `src/core/Timer.js` (visibility reset), `src/Three.Core.js` (`Timer` export), `@types/three/src/renderers/webgl/WebGLInfo.d.ts` (`render.calls/.triangles`, `autoReset`), `package.json` exports map; confirmed classic `WebGLRenderer` has **no** timer query (extension appears only under `src/renderers/webgl-fallback/`)
- **`stats-gl@4.2.3` installed** — confirmed `EXT_disjoint_timer_query_webgl2` in `dist/core.js`
- **npm registry** (`npm view`, 2026-09-08) — all versions, publish dates, repository URLs, postinstall scripts
- **slopcheck** — run twice (auto-detect → PyPI false positives; `-e npm` → 7 OK, 1 SUS false positive)

### Secondary (MEDIUM–HIGH confidence — official documentation)
- https://vite.dev/guide/features — WebAssembly ESM integration, `?init`, `assetsInlineLimit` inlining behaviour, top-level-await requirement
- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame — `DOMHighResTimeStamp`, equality with `document.timeline.currentTime`, identical timestamp per frame, **paused** in background tabs
- https://www.openstreetmap.org/copyright — ODbL, share-alike, attribution requirement
- https://osmfoundation.org/wiki/Licence/Attribution_Guidelines — exact attribution forms, games/credits-screen provision, URL requirement
- https://wiki.openstreetmap.org/wiki/Key:surface — all 15 surface values confirmed documented; `cobblestone` flagged unclear
- https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map — 3DEP public domain, no use restrictions
- https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf — Copernicus GLO-30 free worldwide licence + mandatory notice text
- `CLAUDE.md` (project stack canon) — consumed, not re-derived; its one MEDIUM claim (Rapier non-compat under Vite) upgraded to HIGH by this session's spike

### Tertiary (MEDIUM–LOW confidence — flagged in-line)
- https://cloud.google.com/maps-platform/terms — §3.2.4 substance corroborated via search results; **verbatim clause text not retrievable** (page truncates). Cited as directional, not as legal advice.

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Fixed-timestep loop design | **HIGH** | Both the failure mode and the fix were executed and measured against the real Rapier build across 8 refresh rates |
| Alt-tab / stall handling | **HIGH** | Failure mode (5× fast-forward) and fix (rebaseline) both measured; rAF background pausing confirmed against MDN |
| Vite 8 + Rapier non-compat | **HIGH** for build/dev/typecheck; **MEDIUM** for runtime execution | `vite build`, `vite dev` module-graph resolution and `tsc --noEmit` all verified. Actual in-browser *execution* of the wasm was not run headlessly — first `npm run dev` should confirm |
| Vitest resolver config | **HIGH** | Failure reproduced and fix verified end-to-end |
| Profiler HUD data sources | **HIGH** | Every field read from installed `@types/three` / Rapier `.d.ts`; three's lack of a WebGL timer query verified by source search |
| Frame budget numbers | **MEDIUM** | 16.6/4 ms locked by D-04. Step costs measured in Node with mostly-sleeping bodies — a floor, not a worst case. Sub-budget split is a recommendation |
| Map data licensing | **MEDIUM-HIGH** | OSM, 3DEP and Copernicus terms cited from official sources. Google ToS clause could not be retrieved verbatim. The ODbL Produced-Work / Derivative-Database question is genuinely open and flagged, not resolved |
| Road-graph schema v1 | **MEDIUM** | Reasoned from the downstream requirements it must serve (NAV/P2P/CIRC/GET/SURF) and OSM tag conventions verified against the wiki. It is a first draft to be revised in Phase 4 — which is exactly what SC5 asks for |
| Package legitimacy | **HIGH** | slopcheck (`-e npm`) plus independent registry, repository and postinstall verification for all 8 |

**Research date:** 2026-09-08
**Valid until:** 2026-10-08 (30 days). `vite@8.3.0-beta.1` and `typescript@7.1.0-dev` are already publishing; re-verify versions if planning slips past October.
