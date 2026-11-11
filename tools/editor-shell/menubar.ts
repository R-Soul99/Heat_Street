import { el } from "./controls.ts";

export type MenuItemSpec =
  | {
      id: string;
      label: string;
      tip: string;
      shortcut?: string;
      run: () => void;
      checked?: () => boolean;
      enabled?: () => boolean;
    }
  | { separator: true };

export interface MenuSpec {
  label: string;
  tip: string;
  items: MenuItemSpec[];
}

export function createMenubar(menus: MenuSpec[]): { el: HTMLElement; refresh(): void } {
  const bar = el("div", "shell-menubar");
  bar.setAttribute("role", "menubar");
  let openIdx = -1;
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const updaters: (() => void)[] = [];

  const refreshAll = (): void => {
    for (const u of updaters) u();
  };
  const close = (): void => {
    openIdx = -1;
    buttons.forEach((b, i) => {
      b.setAttribute("aria-expanded", "false");
      panels[i].style.display = "none";
    });
  };
  const open = (i: number): void => {
    close();
    openIdx = i;
    buttons[i].setAttribute("aria-expanded", "true");
    panels[i].style.display = "block";
    updaters[i]();
  };

  menus.forEach((m, i) => {
    const wrap = el("div", "menu-wrap");
    const btn = el("button", "menu-btn", m.label, m.tip);
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    const panel = el("div", "menu-panel");
    panel.setAttribute("role", "menu");
    panel.style.display = "none";
    const rows: {
      item: Exclude<MenuItemSpec, { separator: true }>;
      b: HTMLButtonElement;
      check: HTMLElement;
    }[] = [];
    for (const item of m.items) {
      if ("separator" in item) {
        panel.appendChild(el("div", "menu-sep"));
        continue;
      }
      const b = el("button", "menu-item", undefined, item.tip);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      const check = el("span", "menu-check");
      b.append(
        check,
        el("span", "menu-label", item.label),
        el("span", "menu-shortcut", item.shortcut ?? ""),
      );
      b.addEventListener("click", () => {
        close();
        item.run();
        refreshAll();
      });
      panel.appendChild(b);
      rows.push({ item, b, check });
    }
    updaters.push(() => {
      for (const r of rows) {
        r.check.textContent = r.item.checked?.() ? "✓" : "";
        r.b.disabled = r.item.enabled ? !r.item.enabled() : false;
      }
    });
    btn.addEventListener("click", () => (openIdx === i ? close() : open(i)));
    btn.addEventListener("pointerenter", () => {
      if (openIdx >= 0 && openIdx !== i) open(i);
    });
    wrap.append(btn, panel);
    bar.appendChild(wrap);
    buttons.push(btn);
    panels.push(panel);
  });

  document.addEventListener("pointerdown", (e) => {
    if (openIdx >= 0 && !bar.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openIdx >= 0) close();
  });

  return { el: bar, refresh: refreshAll };
}
