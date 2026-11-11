import { el } from "./controls.ts";

export interface InfoField {
  key: string;
  label: string;
  tip: string;
}

export interface Infobar {
  el: HTMLElement;
  set(key: string, text: string): void;
  status(text: string, kind?: "info" | "ok" | "error"): void;
  setDirty(dirty: boolean): void;
}

export function createInfobar(fields: InfoField[]): Infobar {
  const bar = el("div", "shell-infobar");
  const values = new Map<string, HTMLElement>();
  for (const f of fields) {
    const span = el("span", "info-field", undefined, f.tip);
    span.append(el("span", "info-label", `${f.label} `));
    const v = el("span", "info-value", "");
    span.appendChild(v);
    values.set(f.key, v);
    bar.appendChild(span);
  }
  const dirty = el("span", "dirty", "● unsaved", "You have changes that are not saved yet");
  dirty.style.display = "none";
  const status = el("span", "status", "");
  bar.append(dirty, status);
  return {
    el: bar,
    set(key, text) {
      const v = values.get(key);
      if (v) v.textContent = text;
    },
    status(text, kind = "info") {
      status.className = kind === "info" ? "status" : `status ${kind}`;
      status.textContent = text;
      if (kind === "error") console.error(`[editor-shell] ${text}`);
    },
    setDirty(d) {
      dirty.style.display = d ? "" : "none";
    },
  };
}
