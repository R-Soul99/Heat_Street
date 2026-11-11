export interface ElementLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  classList?: { contains(c: string): boolean };
  closest?(sel: string): unknown;
}

const TEXT_TYPES = new Set(["text", "number", "search", "email", "url", "password", ""]);

/** Copy of the debug-gate text-entry rule (not imported: that module has import side effects). */
export function isTextEntry(el: ElementLike | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return TEXT_TYPES.has((el.type ?? "").toLowerCase());
  return el.isContentEditable === true;
}

export function isValueControl(el: ElementLike | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "SELECT") return true;
  if (tag === "INPUT" && (el.type ?? "").toLowerCase() === "range") return true;
  return !!el.closest?.(".es-stepper");
}

export interface KeyEventLike {
  code: string;
  key?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export interface Binding {
  code: string;
  ctrl?: boolean;
  shift?: boolean | "any";
  label: string;
  description: string;
  allowInTextEntry?: boolean;
  enabled?(): boolean;
  run(e: KeyEventLike): void;
}

export function resolveShortcut(
  ev: KeyEventLike,
  bindings: readonly Binding[],
  ctx: { textEntry: boolean; valueControl: boolean; dialogOpen: boolean },
): Binding | null {
  if (ctx.dialogOpen) return null;
  if (ev.isComposing) return null;
  if (ev.altKey) return null;
  const ctrl = ev.ctrlKey || ev.metaKey;
  for (const b of bindings) {
    if (b.code !== ev.code) continue;
    if ((b.ctrl ?? false) !== ctrl) continue;
    if (b.shift !== "any" && (b.shift ?? false) !== ev.shiftKey) continue;
    if (b.enabled && b.enabled() === false) continue;
    if (ctx.textEntry && !b.allowInTextEntry) continue;
    if (ctx.valueControl && b.code.startsWith("Arrow")) continue;
    return b;
  }
  return null;
}

function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code.startsWith("Arrow")) return code.slice(5);
  return code;
}

export function shortcutLabel(b: Pick<Binding, "code" | "ctrl" | "shift">): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.shift === true) parts.push("Shift");
  parts.push(keyName(b.code));
  return parts.join("+");
}

/** Window keydown handler. Returns an uninstall function. */
export function installShortcuts(
  bindings: readonly Binding[],
  isDialogOpen: () => boolean,
): () => void {
  const handler = (e: KeyboardEvent): void => {
    const active = document.activeElement as ElementLike | null;
    const hit = resolveShortcut(e, bindings, {
      textEntry: isTextEntry(active),
      valueControl: isValueControl(active),
      dialogOpen: isDialogOpen(),
    });
    if (!hit) return;
    e.preventDefault();
    hit.run(e);
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

/** Two-column key / description table. textContent only. */
export function shortcutsDialogBody(bindings: readonly Binding[]): HTMLElement {
  const table = document.createElement("table");
  table.className = "es-shortcuts";
  for (const b of bindings) {
    const tr = document.createElement("tr");
    const k = document.createElement("td");
    k.textContent = b.label;
    const d = document.createElement("td");
    d.textContent = b.description;
    tr.append(k, d);
    table.append(tr);
  }
  return table;
}
