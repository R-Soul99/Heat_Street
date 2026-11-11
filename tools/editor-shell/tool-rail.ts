import { el } from "./controls.ts";
import { splitDockTools } from "./dock.ts";

export interface ShellTool {
  id: string;
  label: string;
  icon: string;
  keyLabel?: string;
  tip: string;
  disabled?: boolean;
  /** Dock layout only: "top" puts the tool in the compact top row. */
  dock?: "top";
}

export interface ToolRail {
  rail: HTMLElement;
  flyout: HTMLElement;
  /** Dock layout only: the compact top row (tools, then the flyout for a top tool). */
  topbar?: HTMLElement;
  /** The tool's button (dock layout positions the flyout from it). */
  buttonFor(id: string): HTMLButtonElement | undefined;
  isTop(id: string): boolean;
  setActive(id: string): void;
  setEnabled(id: string, on: boolean): void;
}

export function createToolRail(
  tools: ShellTool[],
  onSelect: (id: string) => void,
  layout: "classic" | "dock" = "classic",
): ToolRail {
  const dock = layout === "dock";
  const rail = el("div", dock ? "shell-toolbar-bottom" : "shell-rail");
  const topbar = dock ? el("div", "shell-topbar") : undefined;
  const topIds = new Set(splitDockTools(tools).top.map((t) => t.id));
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
    if (topbar && topIds.has(t.id)) topbar.appendChild(b);
    else rail.appendChild(b);
    btns.set(t.id, b);
  }
  return {
    rail,
    flyout,
    topbar,
    buttonFor: (id) => btns.get(id),
    isTop: (id) => topIds.has(id),
    setActive(id) {
      for (const [k, b] of btns) b.setAttribute("aria-pressed", k === id ? "true" : "false");
    },
    setEnabled(id, on) {
      const b = btns.get(id);
      if (b) b.disabled = !on;
    },
  };
}
