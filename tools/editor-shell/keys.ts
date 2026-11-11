/**
 * Keyboard shortcut resolution for the editor shell. DOM-free and testable.
 * Alt is never bound (D-08). Never bind Ctrl+N/O/W/T (browser-reserved).
 */

interface TextEntryLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

const TEXT_TYPES = new Set(["", "text", "search", "number", "email", "url", "password", "tel"]);

/**
 * Copied from src/debug/debug-gate.ts (which has import-time side effects, so it
 * cannot be imported). Differs: INPUTs only count when they accept typed text
 * (not range/checkbox/radio/button), so sliders do not swallow shortcuts.
 */
export function isTextEntryFocused(el: unknown): boolean {
  if (el === null || el === undefined) return false;
  const e = el as TextEntryLike;
  if (e.isContentEditable === true) return true;
  if (e.tagName === "TEXTAREA") return true;
  if (e.tagName === "INPUT") return TEXT_TYPES.has((e.type ?? "").toLowerCase());
  return false;
}

export interface KeyLike {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export interface Binding {
  id: string;
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  noRepeat?: boolean;
  /** Human text, e.g. "Ctrl+Shift+Z" (tooltips, Help menu). */
  label: string;
}

export const STANDARD_BINDINGS: Binding[] = [
  { id: "undo", code: "KeyZ", ctrl: true, label: "Ctrl+Z" },
  { id: "redo", code: "KeyZ", ctrl: true, shift: true, label: "Ctrl+Shift+Z" },
  { id: "redo", code: "KeyY", ctrl: true, label: "Ctrl+Y" },
  { id: "save", code: "KeyS", ctrl: true, label: "Ctrl+S" },
  { id: "escape", code: "Escape", label: "Esc" },
];

export function resolveShortcut(
  e: KeyLike,
  bindings: readonly Binding[],
  ctx: { textFocused: boolean; dialogOpen: boolean },
): string | undefined {
  if (e.altKey || e.isComposing) return undefined;
  const ctrl = Boolean(e.ctrlKey || e.metaKey);
  const shift = Boolean(e.shiftKey);
  for (const b of bindings) {
    if (b.code !== e.code) continue;
    if (Boolean(b.ctrl) !== ctrl || Boolean(b.shift) !== shift) continue;
    if (b.code !== "Escape" && (ctx.textFocused || ctx.dialogOpen)) return undefined;
    if (b.noRepeat && e.repeat) return undefined;
    return b.id;
  }
  return undefined;
}

/** Brackets and arrows adjust the active value; Shift = coarse (D-05, D-09). */
export function adjustDirection(e: KeyLike): { dir: 1 | -1; coarse: boolean } | undefined {
  if (e.altKey) return undefined;
  const coarse = Boolean(e.shiftKey);
  switch (e.key) {
    case "]":
      return { dir: 1, coarse };
    case "[":
      return { dir: -1, coarse };
    case "ArrowUp":
    case "ArrowRight":
    case "ArrowDown":
    case "ArrowLeft":
      if (e.ctrlKey || e.metaKey) return undefined; // reserved for map panning
      return { dir: e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1, coarse };
    default:
      return undefined;
  }
}
