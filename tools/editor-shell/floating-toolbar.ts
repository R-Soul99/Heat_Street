/**
 * Floating toolbar over the top-left of the canvas (07.1.2 D-18). Rows of chips; each chip holds
 * tool buttons, dividers and editor-supplied slots. The spec/validation is pure; the DOM builder
 * writes all text via textContent (T-07.1.2-11).
 */
import { el } from "./controls.ts";
import { displayLabel, type ShellTool } from "./tool-rail.ts";

export type FloatItem =
  | { kind: "tool"; tool: ShellTool; size?: "big" }
  | { kind: "divider" }
  | { kind: "slot"; id: string };

export interface FloatChip {
  id: string;
  label: string;
  direction: "row" | "column";
  items: FloatItem[];
}

export type FloatRow = FloatChip[];

/** Pure spec check; returns human-readable errors (empty when valid). */
export function validateFloatSpec(rows: FloatRow[]): string[] {
  const errors: string[] = [];
  const chipIds = new Set<string>();
  const toolIds = new Set<string>();
  const slotIds = new Set<string>();
  for (const row of rows) {
    for (const chip of row) {
      if (chipIds.has(chip.id)) errors.push(`duplicate chip id "${chip.id}"`);
      chipIds.add(chip.id);
      if (chip.items.length === 0) errors.push(`chip "${chip.id}" is empty`);
      for (const item of chip.items) {
        if (item.kind === "tool") {
          const id = item.tool.id;
          if (toolIds.has(id)) errors.push(`duplicate tool id "${id}"`);
          toolIds.add(id);
          if (item.tool.tip.trim() === "") errors.push(`tool "${id}" has an empty tip`);
        } else if (item.kind === "slot") {
          if (slotIds.has(item.id)) errors.push(`duplicate slot id "${item.id}"`);
          slotIds.add(item.id);
        }
      }
    }
  }
  return errors;
}

export interface FloatingToolbar {
  el: HTMLElement;
  button(id: string): HTMLButtonElement | undefined;
  setPressed(id: string, on: boolean): void;
  setEnabled(id: string, on: boolean, disabledTip?: string): void;
  flash(id: string): void;
}

export function createFloatingToolbar(
  rows: FloatRow[],
  slots: Record<string, HTMLElement>,
  onClick: (id: string) => void,
): FloatingToolbar {
  const root = el("div", "shell-floatbar");
  const btns = new Map<string, HTMLButtonElement>();
  const tips = new Map<string, string>();

  const make = (t: ShellTool, big: boolean): HTMLButtonElement => {
    const tip = t.keyLabel ? `${t.tip} (${t.keyLabel})` : t.tip;
    const b = el("button", big ? "tool-btn big" : "tool-btn", undefined, tip);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute(
      "aria-label",
      t.keyLabel ? `${displayLabel(t)} (${t.keyLabel})` : displayLabel(t),
    );
    if (t.tipLong) b.dataset.tipLong = t.tipLong;
    b.append(
      el("span", "tool-glyph", t.icon),
      el("span", "tool-word", displayLabel(t)),
      el("span", "tool-key", t.keyLabel ?? ""),
    );
    b.addEventListener("click", () => onClick(t.id));
    btns.set(t.id, b);
    tips.set(t.id, tip);
    return b;
  };

  for (const row of rows) {
    const rowEl = el("div", "float-row");
    for (const chip of row) {
      const chipEl = el("div", chip.direction === "column" ? "float-chip col" : "float-chip");
      chipEl.setAttribute("role", "toolbar");
      chipEl.setAttribute("aria-label", chip.label);
      chipEl.addEventListener("pointerdown", (e) => e.stopPropagation());
      for (const item of chip.items) {
        if (item.kind === "tool") chipEl.appendChild(make(item.tool, item.size === "big"));
        else if (item.kind === "divider") chipEl.appendChild(el("div", "float-divider"));
        else {
          const slot = slots[item.id];
          if (slot) chipEl.appendChild(slot);
        }
      }
      rowEl.appendChild(chipEl);
    }
    root.appendChild(rowEl);
  }

  return {
    el: root,
    button: (id) => btns.get(id),
    setPressed(id, on) {
      btns.get(id)?.setAttribute("aria-pressed", on ? "true" : "false");
    },
    setEnabled(id, on, disabledTip) {
      const b = btns.get(id);
      if (!b) return;
      b.classList.toggle("is-disabled", !on);
      if (on) {
        b.removeAttribute("aria-disabled");
        const orig = tips.get(id);
        if (orig !== undefined) b.dataset.tip = orig;
      } else {
        b.setAttribute("aria-disabled", "true");
        if (disabledTip !== undefined) b.dataset.tip = disabledTip;
      }
    },
    flash(id) {
      const b = btns.get(id);
      if (!b) return;
      b.classList.add("flash");
      setTimeout(() => b.classList.remove("flash"), 150);
    },
  };
}
