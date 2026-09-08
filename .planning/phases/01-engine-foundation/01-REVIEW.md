---
phase: 01-engine-foundation
reviewed: 2026-09-08T20:15:00Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - .gitignore
  - .nvmrc
  - biome.json
  - CLAUDE.md
  - docs/adr/0001-map-data-source.md
  - docs/frame-budget.md
  - docs/schemas/road-graph.v1.md
  - fixtures/road-graph.sample.json
  - heat-street-design-doc.md
  - index.html
  - LICENSE-MAPDATA
  - package.json
  - src/core/frame-budget.ts
  - src/core/frame-stats.ts
  - src/core/input-tape.ts
  - src/core/sim-clock.ts
  - src/debug/debug-gate.ts
  - src/debug/profiler-hud.ts
  - src/loop.ts
  - src/main.ts
  - src/physics/debug-scene.ts
  - src/physics/transform-cache.ts
  - src/physics/world.ts
  - src/render/debug-scene.ts
  - src/render/interpolator.ts
  - src/render/renderer.ts
  - tests/debug-gate.test.ts
  - tests/determinism.test.ts
  - tests/docs-present.test.ts
  - tests/frame-budget.test.ts
  - tests/google-pipeline-matcher.ts
  - tests/input-tape.test.ts
  - tests/interpolation.test.ts
  - tests/layering.test.ts
  - tests/loop.test.ts
  - tests/no-google-pipeline.test.ts
  - tests/profiler-hud.test.ts
  - tests/rapier-smoke.test.ts
  - tests/road-graph-schema.test.ts
  - tests/sim-clock.test.ts
  - tests/transform-cache.test.ts
  - tsconfig.json
  - vite.config.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-08T20:15:00Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Summary

This phase's core engine-timing logic (`SimClock`, `input-tape`, `TransformCache`,
`loop.ts`) is unusually well specified and unusually well tested: the determinism
suite exercises eight refresh rates with byte-exact Rapier snapshot hashes, the
stall/rebaseline paths have dedicated fake-scheduler tests, and the interpolation
maths is verified against hand-computed slerp/lerp expected values. `npm run
typecheck`, `npm run lint` and `npm run test` all pass cleanly (201/201 tests, zero
lint findings, zero type errors) as of this review. I traced the tick-index
arithmetic in `src/loop.ts` by hand against `SimClock.tick` looking for an
off-by-one; the indices passed to `onTickBegin`/`onTickEnd`/`sampleForTick` are
deliberately one behind `SimClock.tick` (0-based step count vs. a 1-based running
counter) — this is intentional and is locked in by
`tests/loop.test.ts` ("tick indices" describe block), not a defect.

I did not find any correctness, security, or data-loss-risk defect that rises to
Critical/Blocker. The findings below are quality/robustness gaps: two places where
this codebase's own stated risk model (T-01-16, the render/physics index contract)
is not backed by a runtime guard, one place where a resource with an explicit
`stop()`/teardown API is constructed and then immediately dropped on the floor,
and two lower-severity robustness/dead-code notes.

## Warnings

### WR-01: Render/physics index contract has no runtime guard where it matters most

**File:** `src/render/interpolator.ts:90-98`
**Issue:** `applyAllInterpolated` iterates `targets.length` and reads
`cache.prev`/`cache.cur` at `i * XFORM_STRIDE` with no check that the buffers are
actually long enough for that index. The project's own comments call this exact
mismatch "the single most likely way the index contract gets broken" (T-01-16) and
`src/render/debug-scene.ts` adds a one-time assertion at scene-construction time
(`meshes.length !== bodyCount`), but that only checks mesh count against body
count — it never checks that the `TransformCache` buffer handed to
`applyAllInterpolated` each frame is actually sized for the `targets` array being
interpolated. If a future wiring change (Phase 2+ adding a vehicle, Phase 7/8
pursuers) passes a `meshes` array and a `TransformCache` that have drifted out of
sync, this fails silently: reading past a `Float64Array`'s length returns
`undefined`, and `Vector3.set(undefined, ...)` produces `NaN`, which then
propagates through `lerp`/`slerp` into `position`/`quaternion` — the failure mode
is invisible bodies or `NaN` transforms with no thrown error and no test that would
catch it outside the specific unit tests already covering the current 1:1 wiring.
**Fix:**
```ts
export function applyAllInterpolated(
  targets: readonly THREE.Object3D[],
  cache: { prev: Float64Array; cur: Float64Array },
  alpha: number,
): void {
  const required = targets.length * XFORM_STRIDE;
  if (cache.prev.length < required || cache.cur.length < required) {
    throw new RangeError(
      `applyAllInterpolated: cache buffers (${cache.prev.length}/${cache.cur.length}) ` +
        `too short for ${targets.length} targets at stride ${XFORM_STRIDE}`,
    );
  }
  for (let i = 0; i < targets.length; i++) {
    applyInterpolated(targets[i], cache.prev, cache.cur, i, alpha);
  }
}
```

### WR-02: `main.ts` discards the `LoopHandle` returned by `startLoop`

**File:** `src/main.ts:66-80`
**Issue:** `startLoop({...})` is called as a bare statement; its return value
(`LoopHandle`, which exposes `clock` and `stop()`) is thrown away. `stop()` is
fully implemented and tested (`tests/loop.test.ts` "startLoop — stop()"), and
`LoopHandle.clock` is the only handle on `SimClock.tick`/`droppedTicks` for
anything outside the loop — but nothing in the actual running application can ever
call `stop()` or read `clock` from the composition root today. This is fine for a
page that never tears down, but it means the capability this class was explicitly
built with (clean shutdown, e.g. for a future pause/mode-transition/HMR path) is
currently unreachable outside test code, and it is the kind of gap that tends to
get copy-pasted forward into later phases' composition roots rather than fixed
once here.
**Fix:**
```ts
const loop = startLoop({
  world,
  input,
  transforms,
  applyInput: scene.applyInput,
  onTickBegin: scene.preTick,
  render(alpha: number): void {
    applyAllInterpolated(meshes, transforms, alpha);
    renderer.render(threeScene, camera);
  },
  hud: hud ? (stats, dtMs) => hud.update(stats, dtMs) : undefined,
});
// Retain `loop` (e.g. on a module-level or window-scoped handle) so a future
// pause/unload/HMR path has something to call `.stop()` on.
```

### WR-03: `fixtures/road-graph.sample.json` mismarks every node as a junction

**File:** `fixtures/road-graph.sample.json:29-32`
**Issue:** All four nodes in the sample are declared `"junction": true`. Per
`docs/schemas/road-graph.v1.md` ("`junction` | boolean | True where three or more
edges meet"), and per the fixture's own topology — a single 4-edge loop
(0→1→2→3→0) where every node has degree exactly 2 — none of these four nodes are
junctions. `tests/road-graph-schema.test.ts` even has a dedicated "closes the
loop: every node has degree 2" assertion, but nothing cross-checks the `junction`
flag against computed degree, so this contradiction between the fixture's data and
the schema's own normative definition ships unnoticed. Since this file is
documented as "a conforming sample" (`docs/schemas/road-graph.v1.md`'s "Companion
files" list) that Phase 4's compiler and any future fixture author may reasonably
copy from, shipping it with an incorrect junction flag on every node risks that
error propagating into the first real compiler test fixtures.
**Fix:** Set `"junction": false` on all four nodes (degree 2, per the schema's own
definition), or add a fifth node with three converging edges if the fixture is
meant to also demonstrate the `true` case. Additionally, add an assertion to
`tests/road-graph-schema.test.ts` that `node.junction === (degree(node) >= 3)` for
every node, so this class of drift fails the suite going forward.

## Info

### IN-01: `RecordingInput.frames()` is only a shallow copy

**File:** `src/core/input-tape.ts:74-77`
**Issue:** `frames()` returns `this.tape.slice()`, which protects the recorder's
internal array from `push`/`splice` by a caller, but the individual `InputFrame`
objects inside it (everything except the frozen `NEUTRAL` sentinel) are not
defensively copied or frozen. `InputSource.sampleForTick`'s own docstring requires
results to be "stable for a given tick index" — a caller that mutates a frame
object obtained from `frames()` (or from a prior `sampleForTick` call, since the
same reference is cached and returned on repeat calls) would silently corrupt an
already-recorded tick with no error and no test coverage, because nothing in this
module or its tests exercises in-place mutation of a returned frame.
**Fix:** Freeze each frame as it enters the tape, mirroring the `NEUTRAL` pattern:
```ts
const frame = Object.freeze(this.live.sampleForTick(tick));
this.tape.push(frame);
return frame;
```

### IN-02: `RenderContext.dispose()` is unreachable in the running application

**File:** `src/render/renderer.ts:102-109`
**Issue:** `createRenderer` returns a `dispose()` that removes the resize listener
and disposes the `WebGLRenderer`, but `src/main.ts` never captures the `dispose`
half of `createRenderer`'s return value (only `{ renderer, camera }` is
destructured) and there is no other call site. The function is exercised only
implicitly (it typechecks and is unit-testable in isolation) but is dead code from
the actual application's perspective — the resize listener registered in
`createRenderer` lives for the page's entire lifetime with no way to remove it
short of a full page reload.
**Fix:** Either destructure and retain `dispose` alongside a retained `LoopHandle`
(see WR-02) for a future teardown path, or, if no teardown is planned before a
later phase needs one, add a short comment at the `dispose` definition noting it
is currently unused by the composition root, so a future reader does not assume
it is already wired up.

---

_Reviewed: 2026-09-08T20:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
