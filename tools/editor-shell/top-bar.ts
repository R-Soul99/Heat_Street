/**
 * Shared slim top bar over the canvas (07.1.2 D-32, D-33, D-36). One row of groups; a group holds
 * tool buttons, stacked pairs, drop-down menus, dividers and editor/shell slots. The spec helpers
 * are pure; the DOM builder writes all text via textContent (T-07.1.2-23).
 */
import { displayLabel, type ShellTool } from "./tool-rail.ts";

export type MenuItem =
  | { kind: "tool"; tool: ShellTool }
  | { kind: "divider" }
  | { kind: "slot"; id: string };

export type BarItem =
  | { kind: "tool"; tool: ShellTool }
  | { kind: "stack"; tools: [ShellTool, ShellTool] }
  | { kind: "menu"; tool: ShellTool; items: MenuItem[] }
  | { kind: "slot"; id: string }
  | { kind: "divider" };

export interface BarGroup {
  id: string;
  label: string;
  items: BarItem[];
}

export interface MenuFace {
  icon: string;
  word: string;
  active: boolean;
  swatch?: string;
}

/** Slot ids the shell fills with its history buttons. */
export const RESERVED_SLOTS = ["clearSelection", "clearAll", "undo", "redo"] as const;

function itemTools(item: BarItem): ShellTool[] {
  if (item.kind === "tool") return [item.tool];
  if (item.kind === "stack") return [...item.tools];
  if (item.kind === "menu") {
    const out: ShellTool[] = [item.tool];
    for (const m of item.items) if (m.kind === "tool") out.push(m.tool);
    return out;
  }
  return [];
}

/** Pure spec check; returns human-readable errors (empty when valid). */
export function validateBarSpec(groups: BarGroup[]): string[] {
  const errors: string[] = [];
  const groupIds = new Set<string>();
  const toolIds = new Set<string>();
  const slotIds = new Set<string>();
  const slot = (id: string): void => {
    if (slotIds.has(id)) errors.push(`duplicate slot id "${id}"`);
    slotIds.add(id);
  };
  for (const g of groups) {
    if (groupIds.has(g.id)) errors.push(`duplicate group id "${g.id}"`);
    groupIds.add(g.id);
    if (g.items.length === 0) errors.push(`group "${g.id}" is empty`);
    for (const item of g.items) {
      for (const t of itemTools(item)) {
        if (toolIds.has(t.id)) errors.push(`duplicate tool id "${t.id}"`);
        toolIds.add(t.id);
        if (t.tip.trim() === "") errors.push(`tool "${t.id}" has an empty tip`);
      }
      if (item.kind === "slot") slot(item.id);
      if (item.kind === "menu") {
        if (item.items.length === 0) errors.push(`menu "${item.tool.id}" has no items`);
        for (const m of item.items) if (m.kind === "slot") slot(m.id);
      }
    }
  }
  return errors;
}

export function barToolIds(groups: BarGroup[]): string[] {
  return groups.flatMap((g) => g.items.flatMap((i) => itemTools(i).map((t) => t.id)));
}

export function barSlotIds(groups: BarGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    for (const i of g.items) {
      if (i.kind === "slot") out.push(i.id);
      if (i.kind === "menu") for (const m of i.items) if (m.kind === "slot") out.push(m.id);
    }
  }
  return out;
}

/** Append a "history" group with reserved slots the spec did not place (RESERVED_SLOTS order). */
export function withHistoryGroup(groups: BarGroup[], available: readonly string[]): BarGroup[] {
  const placed = new Set(barSlotIds(groups));
  const missing = RESERVED_SLOTS.filter((id) => available.includes(id) && !placed.has(id));
  if (missing.length === 0) return [...groups];
  return [
    ...groups,
    {
      id: "history",
      label: "History",
      items: missing.map((id) => ({ kind: "slot" as const, id })),
    },
  ];
}

export function menuFace(
  trigger: ShellTool,
  children: readonly ShellTool[],
  activeId: string | null,
): MenuFace {
  const child = activeId === null ? undefined : children.find((c) => c.id === activeId);
  if (child) return { icon: child.icon, word: displayLabel(child), active: true };
  return { icon: trigger.icon, word: displayLabel(trigger), active: false };
}
