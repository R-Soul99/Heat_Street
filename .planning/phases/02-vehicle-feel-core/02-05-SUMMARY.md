---
phase: 02-vehicle-feel-core
plan: 05
subsystem: infra
tags: [debug, layering, testing, typescript, dx]

# Dependency graph
requires:
  - phase: 02-vehicle-feel-core
    provides: "02-02's src/input/** and 02-03's src/hud/** source tiers, which this plan's layering rules police"
provides:
  - "onDebugKey(code, fn): the general keyed hotkey form the 02-09 tuning panel and telemetry panel will use for KeyG/KeyT"
  - "isTextEntryFocused(el): a pure, Node-testable focus guard closing the standing debug-gate.ts NOTE"
  - "Automated tests/layering.test.ts enforcement of src/input/** and src/hud/** (T-02-14, T-02-15)"
affects: [02-09 (tuning panel), 02-10 (browser checkpoint)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onDebugKey(code, fn) general form; onDebugToggle is a thin alias for onDebugKey(\"Backquote\", fn) — closes 02-UI-SPEC.md Architecture Call 1"
    - "isTextEntryFocused is parameterised on the element, never reads document.activeElement itself, mirroring parseDebugFlag's pure-and-Node-testable shape"
    - "layering rule three-part shape (filter by prefix, scanned-at-least-one guard, per-file it()) now applied to four source tiers: src/core/, src/render/, src/hud/, src/input/"

key-files:
  created: []
  modified:
    - src/debug/debug-gate.ts
    - tests/debug-gate.test.ts
    - tests/layering.test.ts

key-decisions:
  - "isTextEntryFocused falls back to a duck-typed tagName/isContentEditable check when HTMLInputElement/HTMLTextAreaElement/HTMLElement are undefined (Node), rather than only working in a browser — this is what lets tests/debug-gate.test.ts hammer it with hand-built fakes under Vitest's node environment"
  - "The focus guard bail sits inside onDebugKey's addEventListener callback, after preventDefault but before invoking fn — so held-key/OS-shortcut guards still apply uniformly and only the callback itself is suppressed while typing"
  - "src/hud/** layering rule deliberately omits \\bdocument\\. (HUD legitimately calls document.createElementNS) and does not duplicate the repo-wide performance. ban — both omissions are commented in place so a future 'tightening' does not break the gauge"

patterns-established:
  - "Two new layering describe blocks (T-02-14 src/hud, T-02-15 src/input) copying the src/render/ three-part shape verbatim"

requirements-completed: [VEH-02, NAV-01]

# Metrics
duration: 15min
completed: 2026-09-09
---

# Phase 2 Plan 5: Debug Hotkey Generalisation and Input/HUD Layering Rules Summary

**Extended `src/debug/debug-gate.ts` with a keyed `onDebugKey(code, fn)` variant plus a Node-testable `isTextEntryFocused` focus guard (closing the file's own standing NOTE), and added automated `tests/layering.test.ts` rule blocks that police `src/input/**` and `src/hud/**` against engine imports and simulation writes.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-09-09
- **Tasks:** 2/2 completed
- **Files modified:** 3 (0 created)

## Accomplishments
- `onDebugKey(code, fn)` is the general form both the vehicle tuning panel (`KeyG`) and telemetry panel (`KeyT`) will use in plan 02-09; `onDebugToggle` is now a one-line alias, so `src/main.ts:63` compiles unchanged.
- `isTextEntryFocused` closes threat T-02-07: a lil-gui numeric `<input>` can no longer fire a debug hotkey mid-edit. It is pure and parameterised on the element, so it is fully covered in Node with hand-built fakes (real `<input>`/`<textarea>`, contenteditable `<div>`, and a plain `<canvas>`).
- `tests/layering.test.ts` now automatically enforces the two new Phase 2 source tiers: `src/hud/**` (no `three`/Rapier imports, no simulation writes) and `src/input/**` (no `three` import, no simulation writes), each with a scanned-at-least-one-file guard so an empty/broken glob cannot make either block trivially green.
- The file-count floor was raised from 10 to 20 (currently 21 files), and the anti-trivially-green property was proven by hand: temporarily adding `import * as THREE from "three";` to `src/hud/speedometer.ts` turned the suite red with `src/hud/speedometer.ts:1: import * as THREE from "three";`, then the import was reverted (`git diff src/hud/speedometer.ts` is empty).

## Task Commits

Each task was committed atomically:

1. **Task 1: onDebugKey with an activeElement focus guard (closes the standing NOTE)** - `446ae9d` (feat)
2. **Task 2: Layering rules for src/input/** and src/hud/**** - `f2c941e` (test)

**Plan metadata:** (this commit) `docs(02-05): complete debug hotkey generalisation and layering rules plan`

## Files Created/Modified
- `src/debug/debug-gate.ts` - Added `isTextEntryFocused` (pure, Node-safe duck-typed fallback), `onDebugKey(code, fn)` (general hotkey form with the focus guard), rewrote `onDebugToggle` as a thin `onDebugKey("Backquote", fn)` alias, and replaced the stale standing NOTE with a comment stating the guard is now handled and naming `KeyG`/`KeyT` as the panel toggles it protects
- `tests/debug-gate.test.ts` - Added 7 cases: `isTextEntryFocused` null/INPUT/TEXTAREA/contenteditable-DIV/non-contenteditable-DIV/CANVAS, plus a case proving `onDebugKey`/`onDebugToggle` register zero listeners and never throw when `DEBUG_ENABLED` is false
- `tests/layering.test.ts` - Raised the file-count floor from 10 to 20; added `T-02-14` (`src/hud/**`) and `T-02-15` (`src/input/**`) describe blocks following the existing `src/render/` three-part shape

## Decisions Made
- Kept `onDebugKey`'s new focus-guard bail as the *last* check before invoking `fn`, after `preventDefault()` — so a keypress while typing still gets its default browser action suppressed consistently with every other guarded key, and only the toggle callback itself is skipped.
- Chose to duck-type on `tagName`/`isContentEditable` in the Node fallback rather than requiring a jsdom dependency, keeping `src/debug/debug-gate.ts` importable with zero new packages (matches the existing `typeof location !== "undefined"` precedent already in the file).
- Followed 02-PATTERNS.md's explicit instruction to drop `\bdocument\.` from the `src/hud/**` layering rule (the HUD legitimately calls `document.createElementNS`) and to not duplicate the repo-wide `performance.` ban — both omissions are commented in the test file itself so a future edit doesn't "tighten" the rule and break the gauge.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria were verified literally (grep counts, diff scope, negative-proof failure line) with no adjustments needed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None. Both changes are complete, wired implementations — `onDebugKey` is not yet called with `KeyG`/`KeyT` anywhere (that composition-root wiring belongs to plan 02-09 when the tuning/telemetry panels exist), but nothing in this plan's own scope is a placeholder.

## Threat Flags

None. This plan's only new trust-boundary-relevant change (T-02-07, the focus guard) was already identified and mitigated per the plan's own `<threat_model>`, verified above by the 7 new `tests/debug-gate.test.ts` cases.

## Next Phase Readiness
- `onDebugKey("KeyG", …)` / `onDebugKey("KeyT", …)` are ready for plan 02-09 to wire the vehicle tuning panel and telemetry panel toggles.
- `tests/layering.test.ts` will now go red automatically if a future edit to `src/input/**` or `src/hud/**` introduces a `three`/Rapier import or a simulation write — no manual review required.
- `npm run check` is green (typecheck + Biome + full 284-test suite across 19 files).
- No blockers for 02-06 through 02-10.

---
*Phase: 02-vehicle-feel-core*
*Completed: 2026-09-09*

## Self-Check: PASSED

- FOUND: src/debug/debug-gate.ts
- FOUND: tests/debug-gate.test.ts
- FOUND: tests/layering.test.ts
- FOUND commit: 446ae9d
- FOUND commit: f2c941e
