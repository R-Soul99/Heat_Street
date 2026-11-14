import { el } from "./controls.ts";
import { splitDockTools } from "./dock.ts";
import { displayLabel, groupTools } from "./tool-groups.ts";

export interface ShellTool {
  id: string;
  label: string;
  icon: string;
  keyLabel?: string;
  tip: string;
  disabled?: boolean;
  /** Pinned to the sidebar header as a glyph-only pair (07.1.1 D-04). */
  dock?: "top";
  /** By-job group; consecutive tools with the same group sit together, divider between groups (07.1.1 D-02). */
  group?: string;
  /** Visible button word when label is over 12 characters (D-01); label stays for the shortcuts list; aria-label uses the visible word. */
  shortLabel?: string;
  /** Long how-to text shown on the long-hover tooltip tier (D-08). */
  tipLong?: string;
}

export interface ToolRail {
  /** Bottom toolbar: grouped glyph + word + key-hint buttons. */
  rail: HTMLElement;
  /** Pinned glyph-only pair (Raise/Lower) that sits at the top of the sidebar. */
  pair: HTMLElement;
  setActive(id: string): void;
  setEnabled(id: string, on: boolean): void;
}

export function createToolRail(tools: ShellTool[], onSelect: (id: string) => void): ToolRail {
  const rail = el("div", "shell-toolbar-bottom");
  const pair = el("div", "sidebar-pair");
  const { top, bottom } = splitDockTools(tools);
  const btns = new Map<string, HTMLButtonElement>();

  const make = (t: ShellTool, cls: string): HTMLButtonElement => {
    const b = el("button", cls, undefined, t.keyLabel ? `${t.tip} (${t.keyLabel})` : t.tip);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    // Announce the visible word (WCAG label-in-name); the long label stays in the tooltip/shortcuts.
    b.setAttribute("aria-label", t.keyLabel ? `${displayLabel(t)} (${t.keyLabel})` : displayLabel(t));
    if (t.tipLong) b.dataset.tipLong = t.tipLong;
    b.disabled = Boolean(t.disabled);
    b.addEventListener("click", () => onSelect(t.id));
    btns.set(t.id, b);
    return b;
  };

  for (const t of top) {
    const b = make(t, "rail-btn pair-btn");
    b.append(el("span", "rail-icon", t.icon));
    pair.appendChild(b);
  }

  groupTools(bottom).forEach((run, i) => {
    if (i > 0) {
      const sep = el("div", "tool-sep");
      sep.setAttribute("role", "separator");
      sep.setAttribute("aria-orientation", "vertical");
      rail.appendChild(sep);
    }
    const g = el("div", "tool-group");
    g.dataset.group = run.group ?? "";
    for (const t of run.tools) {
      const b = make(t, "rail-btn");
      b.append(
        el("span", "rail-icon", t.icon),
        el("span", "rail-label", displayLabel(t)),
        el("span", "rail-key", t.keyLabel ?? ""),
      );
      g.appendChild(b);
    }
    rail.appendChild(g);
  });

  return {
    rail,
    pair,
    setActive(id) {
      for (const [k, b] of btns) b.setAttribute("aria-pressed", k === id ? "true" : "false");
    },
    setEnabled(id, on) {
      const b = btns.get(id);
      if (b) b.disabled = !on;
    },
  };
}
