import type { InfoBar, InfoFieldSpec, StatusKind } from "./types";

/** Bottom info bar. All text goes in via textContent, never markup strings. */
export function createInfoBar(fields: InfoFieldSpec[]): { el: HTMLElement; bar: InfoBar } {
  const el = document.createElement("div");
  el.className = "es-infobar";
  const values = new Map<string, HTMLSpanElement>();

  for (const f of fields) {
    const wrap = document.createElement("span");
    wrap.className = "es-field";
    wrap.dataset.tip = f.tip;
    const label = document.createElement("span");
    label.className = "es-label";
    label.textContent = f.label;
    const value = document.createElement("span");
    value.className = "es-value";
    value.textContent = "-";
    wrap.append(label, value);
    el.append(wrap);
    values.set(f.key, value);
  }

  const dirty = document.createElement("span");
  dirty.className = "es-dirty";
  dirty.dataset.tip = "You have changes that are not saved yet";
  dirty.textContent = "● Unsaved";
  dirty.hidden = true;

  const statusEl = document.createElement("span");
  statusEl.className = "es-status";
  statusEl.dataset.tip = "The last message from the editor. Errors show here with the reason.";
  el.append(dirty, statusEl);

  const bar: InfoBar = {
    set(key, text) {
      const v = values.get(key);
      if (v) v.textContent = text;
    },
    status(text, kind: StatusKind = "info") {
      statusEl.textContent = text;
      statusEl.className = `es-status ${kind}`;
      if (kind === "error") console.error(text);
    },
    setDirty(d) {
      dirty.hidden = !d;
    },
  };
  return { el, bar };
}
