/**
 * The `?debug` presence gate and the single-hotkey toggle convention. This file
 * IS the convention Phase 2's lil-gui tuning panel reuses (D-05) — the export
 * shape matters more than the implementation.
 *
 * Layering: `src/debug/**` may import anything, but must never affect
 * simulation timing (no `world.step`, no `SimClock` mutation, no impulses, no
 * body writes). This module only reads the URL and listens for a keypress.
 */

/**
 * Pure presence check: does `search` contain a `debug` key at all?
 *
 * This is the ONLY externally-influenced input in the whole of Phase 1
 * (01-RESEARCH.md "Security Domain", ASVS V5). Reading the parameter's VALUE
 * instead of checking presence would be a V5 violation: an attacker-controlled
 * value could be crafted to do something the boolean gate never intends, and
 * once a value is read there is a standing temptation to render it. Presence
 * checked via `URLSearchParams.has("debug")` sidesteps both problems — the
 * return type is `boolean` and the input string past this line is discarded.
 *
 * No side effects, no DOM access: safe to call from Node tests.
 */
export function parseDebugFlag(search: string): boolean {
  return new URLSearchParams(search).has("debug");
}

/**
 * Evaluated once at module load. Guarded with `typeof location !== "undefined"`
 * so importing this module in a Node test (no DOM, no `location`) does not
 * throw — only `parseDebugFlag` itself needs to run there.
 */
export const DEBUG_ENABLED: boolean =
  typeof location !== "undefined" ? parseDebugFlag(location.search) : false;

/**
 * Duck-typed shape covering `HTMLInputElement`/`HTMLTextAreaElement`'s
 * `tagName` plus `isContentEditable`, used as the Node-safe fallback below.
 */
interface TextEntryLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}

/**
 * True when `el` is a live text-entry target: an `<input>`, a `<textarea>`,
 * or any element with `isContentEditable`. Deliberately PURE and
 * parameterised on the element (never reads `document.activeElement`
 * internally) — the same shape `parseDebugFlag` uses above — so
 * `tests/debug-gate.test.ts` can hammer this with hand-built fakes under
 * Vitest's `node` environment with no DOM at all.
 *
 * `HTMLInputElement`/`HTMLTextAreaElement` are not defined in that
 * environment, so when they are `undefined` this falls back to a duck-typed
 * check on `tagName` (`INPUT`/`TEXTAREA`) and `isContentEditable`. Both
 * branches express the identical rule; the fallback exists purely so the
 * function is meaningful (and testable) in both a browser and bare Node.
 */
export function isTextEntryFocused(el: Element | null): boolean {
  if (el === null) return false;
  if (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement) return true;
  if (typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement) return true;
  if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) {
    return el.isContentEditable === true;
  }
  // Node fallback: no HTMLInputElement/HTMLTextAreaElement/HTMLElement
  // constructors exist to `instanceof` against, so duck-type on the same
  // properties a real DOM element would carry.
  const fake = el as unknown as TextEntryLike;
  return fake.tagName === "INPUT" || fake.tagName === "TEXTAREA" || fake.isContentEditable === true;
}

/**
 * Registers a single guarded hotkey on `code` that invokes `fn`. Registers
 * NOTHING when `DEBUG_ENABLED` is false, so a normal (non-`?debug`) build
 * adds zero event listeners and creates zero debug surface — the whole
 * subsystem is inert.
 *
 * `!e.repeat` stops key-hold flicker; `!e.metaKey && !e.ctrlKey` keeps
 * OS/browser shortcuts (e.g. Ctrl+`) working. The focus guard below is what
 * closes the standing defect this file used to carry as a NOTE: every
 * lil-gui numeric control the Phase 2 tuning panel adds is a real `<input>`,
 * so typing a `g` or a `t` into a tuning field must not fire `KeyG`/`KeyT`
 * mid-edit. `isTextEntryFocused(document.activeElement)` is checked last,
 * immediately before invoking `fn`, so every existing guard still runs (and
 * still calls `preventDefault`) even for a bail — only the callback itself is
 * suppressed while the developer is typing.
 */
export function onDebugKey(code: string, fn: () => void): void {
  if (!DEBUG_ENABLED) return;
  addEventListener("keydown", (e) => {
    if (e.code === code && !e.repeat && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (isTextEntryFocused(document.activeElement)) return;
      fn();
    }
  });
}

/**
 * Thin alias kept for Phase 1 compatibility: `src/main.ts`'s existing
 * `onDebugToggle(() => hud.toggle())` call site and `tests/debug-gate.test.ts`
 * need no edit. Backquote (the key above Tab, `` ` ``/`~`) is unchanged from
 * Phase 1 (D-05).
 *
 * 02-UI-SPEC.md "Architecture Call 1" adds two more keys alongside this one —
 * `KeyG` (vehicle tuning panel) and `KeyT` (telemetry results panel) — rather
 * than sharing one toggle across all three overlays, because the three
 * surfaces have genuinely different duty cycles: the profiler HUD is
 * glanceable and often left on, the tuning panel is a large opaque rectangle
 * you want gone the instant a feel run starts, and the telemetry panel is
 * transient. Binding them together would force accepting all three or none
 * during exactly the long tuning session this phase exists to enable.
 */
export function onDebugToggle(fn: () => void): void {
  onDebugKey("Backquote", fn);
}
