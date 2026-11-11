import { el } from "./controls.ts";

export interface ShellTool {
  id: string;
  label: string;
  icon: string;
  keyLabel?: string;
  tip: string;
  disabled?: boolean;
}

export interface ToolRail {
  rail: HTMLElement;
  flyout: HTMLElement;
  setActive(id: string): void;
  setEnabled(id: string, on: boolean): void;
}

export function createToolRail(tools: ShellTool[], onSelect: (id: string) => void): ToolRail {
  const rail = el("div", "shell-rail");
  const flyout = el("div", "shell-flyout");
  const btns = new Map<string, HTMLButtonElement>();
  for (const t of tools) {
    const b = el("button", "rail-btn", undefined, t.keyLabel ? `${t.tip} (${t.keyLabel})` : t.tip);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", t.label);
    b.append(el("span", "rail-icon", t.icon), el("span", "rail-key", t.keyLabel ?? ""));
    b.disabled = Boolean(t.disabled);
    b.addEventListener("click", () => onSelect(t.id));
    rail.appendChild(b);
    btns.set(t.id, b);
  }
  return {
    rail,
    flyout,
    setActive(id) {
      for (const [k, b] of btns) b.setAttribute("aria-pressed", k === id ? "true" : "false");
    },
    setEnabled(id, on) {
      const b = btns.get(id);
      if (b) b.disabled = !on;
    },
  };
}
