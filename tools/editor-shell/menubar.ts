import type { MenuItem, MenuSpec } from "./types";

interface OpenMenu {
  top: HTMLButtonElement;
  menu: HTMLElement;
}

/** Top menubar: title, dropdown menus, then any extras (e.g. the area picker). */
export function createMenubar(
  title: string,
  specs: MenuSpec[],
  extras: HTMLElement[],
): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "es-menubar";

  const titleEl = document.createElement("span");
  titleEl.className = "es-title";
  titleEl.textContent = title;
  bar.append(titleEl);

  let open: OpenMenu | null = null;
  const entries: { spec: MenuSpec; top: HTMLButtonElement; menu: HTMLElement }[] = [];

  const close = (): void => {
    if (!open) return;
    open.menu.hidden = true;
    open.top.classList.remove("open");
    open.top.setAttribute("aria-expanded", "false");
    open = null;
  };

  const fill = (spec: MenuSpec, menu: HTMLElement): void => {
    menu.replaceChildren();
    for (const item of spec.items) {
      if (item === "separator") {
        menu.append(document.createElement("hr"));
        continue;
      }
      menu.append(buildItem(item, close));
    }
  };

  const openMenu = (entry: { spec: MenuSpec; top: HTMLButtonElement; menu: HTMLElement }): void => {
    close();
    fill(entry.spec, entry.menu); // re-evaluate checked()/disabled() on every open
    entry.menu.hidden = false;
    entry.top.classList.add("open");
    entry.top.setAttribute("aria-expanded", "true");
    open = { top: entry.top, menu: entry.menu };
  };

  for (const spec of specs) {
    const wrap = document.createElement("div");
    wrap.className = "es-menu-wrap";
    const top = document.createElement("button");
    top.type = "button";
    top.className = "es-menu-top";
    top.textContent = spec.label;
    top.dataset.tip = spec.tip;
    top.setAttribute("aria-haspopup", "menu");
    top.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "es-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    wrap.append(top, menu);
    bar.append(wrap);
    const entry = { spec, top, menu };
    entries.push(entry);
    top.addEventListener("click", () => {
      if (open?.top === top) close();
      else openMenu(entry);
    });
    top.addEventListener("pointerenter", () => {
      if (open && open.top !== top) openMenu(entry);
    });
  }

  document.addEventListener("pointerdown", (e) => {
    if (open && !bar.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) close();
  });

  if (extras.length > 0) {
    const holder = document.createElement("div");
    holder.className = "es-topbar-extras";
    holder.append(...extras);
    bar.append(holder);
  }
  return bar;
}

function buildItem(item: MenuItem, close: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "es-menu-item";
  btn.setAttribute("role", "menuitem");
  btn.dataset.tip = item.tip;
  const left = document.createElement("span");
  const check = document.createElement("span");
  check.className = "es-check";
  check.textContent = item.checked?.() ? "✓" : "";
  const label = document.createElement("span");
  label.textContent = item.label;
  left.append(check, label);
  btn.append(left);
  if (item.shortcut) {
    const sc = document.createElement("span");
    sc.className = "es-shortcut";
    sc.textContent = item.shortcut;
    btn.append(sc);
  }
  btn.disabled = item.disabled?.() ?? false;
  btn.addEventListener("click", () => {
    close();
    item.run();
  });
  return btn;
}
