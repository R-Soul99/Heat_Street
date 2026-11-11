import type { ToolSpec } from "./types";

export interface ToolRail {
  rail: HTMLElement;
  flyout: HTMLElement;
  select(id: string): void;
  active(): string;
  refreshOptions(): void;
}

/** Left tool rail plus the options flyout for the active tool. */
export function createToolRail(
  tools: ToolSpec[],
  initial: string,
  onSelect: (id: string) => void,
): ToolRail {
  const rail = document.createElement("div");
  rail.className = "es-rail";
  const flyout = document.createElement("div");
  flyout.className = "es-flyout";
  flyout.hidden = true;

  let current = initial;
  const buttons = new Map<string, HTMLButtonElement>();

  for (const t of tools) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = t.icon;
    btn.dataset.tip = t.shortcut ? `${t.tip} (${t.shortcut})` : t.tip;
    btn.setAttribute("aria-label", t.label);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => select(t.id, true));
    buttons.set(t.id, btn);
    rail.append(btn);
  }

  function refreshOptions(): void {
    const spec = tools.find((t) => t.id === current);
    flyout.replaceChildren();
    if (!spec?.renderOptions) {
      flyout.hidden = true;
      return;
    }
    const h = document.createElement("h3");
    h.textContent = spec.label;
    const body = document.createElement("div");
    flyout.append(h, body);
    flyout.hidden = false;
    spec.renderOptions(body);
  }

  function select(id: string, notify: boolean): void {
    if (!buttons.has(id)) return;
    const changed = id !== current;
    current = id;
    for (const [tid, b] of buttons) {
      const on = tid === id;
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("active", on);
    }
    refreshOptions();
    if (notify && changed) onSelect(id);
  }

  select(initial, false);
  return {
    rail,
    flyout,
    select: (id) => select(id, true),
    active: () => current,
    refreshOptions,
  };
}
