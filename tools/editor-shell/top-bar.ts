/**
 * Shared slim top bar over the canvas (07.1.2 D-32, D-33, D-36). One row of groups; a group holds
 * tool buttons, stacked pairs, drop-down menus, dividers and editor/shell slots. The spec helpers
 * are pure; the DOM builder writes all text via textContent (T-07.1.2-23).
 */
import { el } from "./controls.ts";
import { type DropdownEvent, dropdownNext } from "./dropdown.ts";
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

export interface TopBar {
  el: HTMLElement;
  button(id: string): HTMLButtonElement | undefined;
  setPressed(id: string, on: boolean): void;
  setEnabled(id: string, on: boolean, disabledTip?: string): void;
  flash(id: string): void;
  openMenu(id: string): void;
  /** Close any open menu; true when one was open (editors call this first on Esc). */
  closeMenus(): boolean;
  isMenuOpen(id: string): boolean;
  setMenuFace(id: string, face: MenuFace): void;
}

export function createTopBar(
  groups: BarGroup[],
  slots: Record<string, HTMLElement>,
  onClick: (id: string) => void,
  onMenu?: (id: string, open: boolean) => void,
): TopBar {
  const root = el("div", "shell-topbar");
  const btns = new Map<string, HTMLButtonElement>();
  const tips = new Map<string, string>();
  const menus = new Map<
    string,
    { wrap: HTMLElement; trigger: HTMLButtonElement; menu: HTMLElement }
  >();
  let openId: string | null = null;

  const render = (): void => {
    for (const [id, m] of menus) {
      const open = id === openId;
      m.menu.hidden = !open;
      m.trigger.setAttribute("aria-expanded", open ? "true" : "false");
    }
  };
  const dispatch = (ev: DropdownEvent): void => {
    const prev = openId;
    openId = dropdownNext(openId, ev);
    render();
    if (prev !== openId) {
      if (prev !== null) onMenu?.(prev, false);
      if (openId !== null) onMenu?.(openId, true);
    }
  };

  const make = (t: ShellTool, cls: string, handler: () => void): HTMLButtonElement => {
    const tip = t.keyLabel ? `${t.tip} (${t.keyLabel})` : t.tip;
    const b = el("button", `tool-btn ${cls}`.trim(), undefined, tip);
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
    b.addEventListener("click", handler);
    btns.set(t.id, b);
    tips.set(t.id, tip);
    return b;
  };
  const addSlot = (parent: HTMLElement, id: string): void => {
    const slot = slots[id];
    if (slot) parent.appendChild(slot);
    else console.warn(`top bar: missing slot "${id}"`);
  };

  for (const g of groups) {
    const ge = el("div", "bar-group");
    ge.setAttribute("role", "toolbar");
    ge.setAttribute("aria-label", g.label);
    ge.addEventListener("pointerdown", (e) => e.stopPropagation());
    for (const item of g.items) {
      if (item.kind === "tool") {
        ge.appendChild(make(item.tool, "", () => onClick(item.tool.id)));
      } else if (item.kind === "stack") {
        const st = el("div", "bar-stack");
        for (const t of item.tools) st.appendChild(make(t, "stacked", () => onClick(t.id)));
        ge.appendChild(st);
      } else if (item.kind === "divider") {
        ge.appendChild(el("div", "bar-divider"));
      } else if (item.kind === "slot") {
        addSlot(ge, item.id);
      } else {
        const wrap = el("div", "bar-menu-wrap");
        const trig = item.tool;
        const trigger = make(trig, "has-menu", () => {
          if (trigger.classList.contains("is-disabled")) {
            onClick(trig.id);
            return;
          }
          dispatch({ type: "trigger", id: trig.id });
        });
        trigger.appendChild(el("span", "tool-caret", "▾"));
        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");
        const menu = el("div", "bar-menu");
        menu.setAttribute("role", "menu");
        menu.hidden = true;
        for (const m of item.items) {
          if (m.kind === "tool") {
            const cb = make(m.tool, "menu-item-btn", () => {
              onClick(m.tool.id);
              dispatch({ type: "pick" });
            });
            cb.setAttribute("role", "menuitem");
            menu.appendChild(cb);
          } else if (m.kind === "divider") {
            menu.appendChild(el("div", "bar-divider"));
          } else {
            addSlot(menu, m.id);
          }
        }
        wrap.append(trigger, menu);
        menus.set(trig.id, { wrap, trigger, menu });
        ge.appendChild(wrap);
      }
    }
    root.appendChild(ge);
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (openId === null) return;
      const target = e.target as Node | null;
      const open = menus.get(openId);
      if (!open || (target && open.wrap.contains(target))) return;
      dispatch({ type: "outside" });
      if (!target || !root.contains(target)) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

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
    openMenu: (id) => {
      if (menus.has(id)) dispatch({ type: "open", id });
    },
    closeMenus() {
      const was = openId !== null;
      if (was) dispatch({ type: "close" });
      return was;
    },
    isMenuOpen: (id) => openId === id,
    setMenuFace(id, face) {
      const m = menus.get(id);
      if (!m) return;
      const glyph = m.trigger.querySelector(".tool-glyph");
      const word = m.trigger.querySelector(".tool-word");
      if (glyph) glyph.textContent = face.icon;
      if (word) word.textContent = face.word;
      m.trigger.querySelector(".bar-swatch")?.remove();
      if (face.swatch && word) {
        const sw = el("span", "bar-swatch");
        sw.style.background = face.swatch;
        word.before(sw);
      }
    },
  };
}
