---
phase: 02-vehicle-feel-core
plan: 02
subsystem: input
tags: [input, keyboard, gamepad, fixed-timestep, determinism, typescript]

# Dependency graph
requires:
  - phase: 01-engine-foundation
    provides: "SimClock/DT fixed-timestep core, InputSource/InputFrame contract, src/loop.ts's dependency-injection-with-lazy-default shape"
provides:
  - "LiveInputSource: a real InputSource implementation feeding the fixed tick from keyboard/gamepad"
  - "src/input/keyboard.ts: latched keydown/keyup key state, DOM-free-import-safe"
  - "src/input/gamepad.ts: injectable navigator.getGamepads() polling with deadzone"
affects: [02-03, 02-05, 02-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "src/input/** layering tier: touches document/navigator, may import src/core/, never writes simulation state, all smoothing advances by DT per fixed tick"
    - "Lazy-default-inside-constructor dependency injection (mirrors src/loop.ts's LoopScheduler ?? createBrowserScheduler())"
    - "Idempotent sampleForTick via a lastTick + cached-frame-by-reference guard, copied from RecordingInput"

key-files:
  created:
    - src/input/keyboard.ts
    - src/input/gamepad.ts
    - src/input/live-input.ts
    - tests/live-input.test.ts
  modified: []

key-decisions:
  - "createKeyboard() detects a missing DOM (typeof document === \"undefined\") and returns an inert all-neutral handle instead of throwing, so `new LiveInputSource()` with zero injected deps is always safe to construct outside a browser — construction is not deferred"
  - "Node's built-in `navigator` global is a partial object (no getGamepads), not absent — readGamepad() treats a missing getGamepads identically to a missing navigator, both degrading to null"
  - "Steering uses two ramp rates: 2.5/s ramping outward from centre, 4.0/s returning to centre or reversing direction, so counter-steer is responsive without making the outward ramp twitchy"

patterns-established:
  - "src/input/** layering header wording (touches document/navigator; may import src/core/; never writes simulation state; all smoothing advances by DT per fixed tick, never per frame)"

requirements-completed: [VEH-02]

# Metrics
duration: 20min
completed: 2026-09-09
---

# Phase 2 Plan 2: Live Keyboard + Gamepad Input Source Summary

**`LiveInputSource` turns latched keyboard state and polled gamepad axes into per-tick `InputFrame`s: keyboard steering ramps linearly by `DT` (2.5/s out, 4.0/s return), gamepad axes bypass the ramp and pass straight through with a deadzone, and every value is clamped/finite before it can reach physics.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-09
- **Tasks:** 3/3 completed
- **Files modified:** 4 created (0 modified)

## Accomplishments
- `src/input/keyboard.ts` and `src/input/gamepad.ts` give the fixed tick a real hardware source, replacing `src/main.ts`'s `NEUTRAL` stub reservation from Phase 1.
- `LiveInputSource` proves VEH-02: steering reaches full lock in exactly 0.400s (24 ticks at 60Hz), is framerate-independent at 30/60/144/240 fps (VEH-03 non-regression), and returns to centre faster than it ramps out for responsive counter-steer.
- Threat T-02-05 (a `NaN`/out-of-range axis corrupting `world.step()`) is mitigated: hostile pad values are clamped and substituted with 0 before leaving `sampleForTick`.
- The whole `src/input/` layer is proven importable and constructible in a bare Node process with no `document`/`localStorage`, so it can never quietly acquire a module-scope DOM dependency.

## Task Commits

Each task was committed atomically:

1. **Task 1: Latched keyboard adapter and injectable gamepad reader** - `e4ccda6` (feat)
2. **Task 2: LiveInputSource — DT-driven ramp, idempotent per tick** - `09a466d` (feat)
3. **Task 3: Layering-safety review of src/input and a Node-import smoke assertion** - `6924f4b` (test)

**Plan metadata:** (this commit) `docs(02-02): complete live keyboard + gamepad input source plan`

## Files Created/Modified
- `src/input/keyboard.ts` - keydown/keyup latching keyed on `e.code`, `preventDefault` on driving keys, inert Node-safe fallback when `document` is undefined
- `src/input/gamepad.ts` - `navigator.getGamepads()` polling, deadzoned/clamped steer and trigger axes, defensive index reads, injectable `readPad`
- `src/input/live-input.ts` - `LiveInputSource implements InputSource`; DT-driven linear ramp with a faster return/reversal rate; gamepad bypass; idempotent-per-tick caching; hostile-value clamping
- `tests/live-input.test.ts` - 14 cases: ramp timing, idempotence, framerate independence (30/60/144/240 fps), gamepad passthrough/deadzone/hostile-clamp, negative-tick NEUTRAL, and bare-Node importability

## Decisions Made
- **`createKeyboard()` returns an inert handle rather than throwing when `document` is undefined.** The plan left this as an open choice ("construction is deferred... pick one"). Deferred construction was rejected because it would make `LiveInputSource`'s constructor signature conditional on environment; an inert fallback keeps the lazy-default-in-constructor shape identical to `src/loop.ts`'s `LoopScheduler` precedent and makes `new LiveInputSource()` unconditionally safe.
- **Node's global `navigator` is a partial object, not absent.** Discovered empirically (`Object.getOwnPropertyDescriptor(globalThis, "navigator")` returns a configurable getter returning `Navigator {}` with no `getGamepads`) rather than assumed. `readGamepad()` was already written defensively enough to handle this (`typeof navigator.getGamepads !== "function"` check) with no code change needed; only the Task 3 test assertions were corrected to match this reality instead of assuming `typeof navigator === "undefined"`.
- **Steering ramp asymmetry (2.5/s out, 4.0/s return/reversal) implemented as specified** rather than a single rate, per 02-RESEARCH.md Pattern 5 and the plan's explicit rationale that SC1 (catching a slide) depends on responsive counter-steer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 3's Node-environment test assumed `navigator` is entirely absent**
- **Found during:** Task 3
- **Issue:** The plan's own read_first material and my first draft asserted `typeof navigator === "undefined"` in a bare Node environment. Running the suite showed this repo's pinned Node ships a built-in `navigator` global (partial, no Gamepad API), so three assertions failed and one `globalThis.navigator = {...}` direct assignment threw (`navigator` is a getter-only accessor).
- **Fix:** Rewrote the affected assertions to check the behaviour that actually matters — `readGamepad()` degrades to `null` whether `navigator` is absent or merely lacks `getGamepads` — and switched the deadzone-injection test to `Object.defineProperty` (which can override a configurable getter) with a restore in a `finally` block.
- **Files modified:** `tests/live-input.test.ts`
- **Verification:** `npx vitest run tests/live-input.test.ts` — 14/14 passing; `npm run check` green.
- **Committed in:** `6924f4b` (part of Task 3 commit)

## Known Stubs

None. `LiveInputSource` is a complete, wired implementation — not yet connected to `src/main.ts` (that composition-root rewiring is a later plan's job per 02-PATTERNS.md's `src/main.ts` MODIFY entry), but nothing in this plan's own scope is a placeholder.

## Threat Flags

None. The one new trust boundary this plan introduces (browser key/pad events → `InputFrame` → fixed tick) was already identified and mitigated per the plan's own `<threat_model>` (T-02-05, T-02-08, T-02-09), all verified above.

## Self-Check: PASSED

- FOUND: src/input/keyboard.ts
- FOUND: src/input/gamepad.ts
- FOUND: src/input/live-input.ts
- FOUND: tests/live-input.test.ts
- FOUND commit: e4ccda6
- FOUND commit: 09a466d
- FOUND commit: 6924f4b
