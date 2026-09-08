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
 * Registers a single guarded hotkey that invokes `fn`. Registers NOTHING when
 * `DEBUG_ENABLED` is false, so a normal (non-`?debug`) build adds zero event
 * listeners and creates zero debug surface — the whole subsystem is inert.
 *
 * Backquote (the key above Tab, `` ` ``/`~`) is the chosen key per D-05, which
 * names backtick or F1 as acceptable. `!e.repeat` stops key-hold flicker;
 * `!e.metaKey && !e.ctrlKey` keeps OS/browser shortcuts (e.g. Ctrl+`) working.
 * NOTE: this guard will need extending once a text input exists in a later
 * phase (Backquote while typing in a chat/console field would fire the toggle
 * unless focus is checked there too).
 */
export function onDebugToggle(fn: () => void): void {
  if (!DEBUG_ENABLED) return;
  addEventListener("keydown", (e) => {
    if (e.code === "Backquote" && !e.repeat && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      fn();
    }
  });
}
