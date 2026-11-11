/** Editor-agnostic shell layout (D-01/D-02). Knows nothing about roads or terrain. */
import { createButton, el } from "./controls.ts";
import { openDialog } from "./dialog.ts";
import { flyoutAnchor } from "./dock.ts";
import { createInfobar, type InfoField } from "./infobar.ts";
import { createMenubar, type MenuItemSpec, type MenuSpec } from "./menubar.ts";
import { createToolRail, type ShellTool } from "./tool-rail.ts";
import { installTooltips, setTooltipsEnabled, tooltipsEnabled } from "./tooltips.ts";

export { adjustDirection, isTextEntryFocused } from "./keys.ts";
export type { InfoField, MenuItemSpec, MenuSpec, ShellTool };

export interface ShellOptions {
  root: HTMLElement;
  /** "classic" (default) is the D-01 layout; "dock" is the terrain editor variant. */
  layout?: "classic" | "dock";
  menus: MenuSpec[];
  tools: ShellTool[];
  onToolChange: (id: string) => void;
  history: {
    undo: () => void;
    redo: () => void;
    clear: () => void;
    clearLabel: string;
    clearTip: string;
  };
  view: {
    zoomIn: () => void;
    zoomOut: () => void;
    fit: () => void;
    pan: (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void;
    extra?: { id: string; label: string; tip: string; run: () => void; pressed?: () => boolean }[];
  };
  infoFields: InfoField[];
}

export interface Shell {
  setActiveTool(id: string): void;
  flyout: HTMLElement;
  info: {
    set(key: string, text: string): void;
    status(text: string, kind?: "info" | "ok" | "error"): void;
    setDirty(dirty: boolean): void;
  };
  setHistoryState(canUndo: boolean, canRedo: boolean): void;
  setToolEnabled(id: string, enabled: boolean): void;
  refreshMenus(): void;
  isDialogOpen(): boolean;
}

export function createShell(options: ShellOptions): Shell {
  installTooltips(document);

  const shortcutsItem: MenuItemSpec = {
    id: "help-shortcuts",
    label: "Keyboard shortcuts...",
    tip: "List every tool key and menu shortcut",
    run: () => {
      const body = el("div", "shortcut-list");
      const add = (k: string, d: string): void => {
        const row = el("div", "shortcut-row");
        row.append(el("kbd", undefined, k), el("span", undefined, d));
        body.appendChild(row);
      };
      for (const t of options.tools) if (t.keyLabel) add(t.keyLabel, t.label);
      for (const m of options.menus)
        for (const i of m.items) if (!("separator" in i) && i.shortcut) add(i.shortcut, i.label);
      void openDialog({
        title: "Keyboard shortcuts",
        body,
        actions: [{ id: "close", label: "Close", tip: "Close this list", primary: true }],
      });
    },
  };
  const tooltipItem: MenuItemSpec = {
    id: "help-tooltips",
    label: "Tooltips",
    tip: "Show or hide hover tooltips on every control",
    run: () => setTooltipsEnabled(!tooltipsEnabled()),
    checked: () => tooltipsEnabled(),
  };
  const menus: MenuSpec[] = options.menus.map((m) => ({ ...m, items: [...m.items] }));
  let help = menus.find((m) => m.label === "Help");
  if (!help) {
    help = { label: "Help", tip: "Help and preferences", items: [] };
    menus.push(help);
  }
  if (help.items.length > 0) help.items.push({ separator: true });
  help.items.push(tooltipItem, shortcutsItem);

  const menubar = createMenubar(menus);
  const dock = options.layout === "dock";
  const rail = createToolRail(options.tools, (id) => setActiveTool(id), dock ? "dock" : "classic");
  let activeId: string | null = null;
  /** Dock layout: top tools show their options in the top row, others float above their button. */
  const placeFlyout = (): void => {
    if (!dock || !rail.topbar || activeId === null) return;
    const f = rail.flyout;
    if (rail.isTop(activeId)) {
      f.classList.remove("floating");
      f.style.left = "";
      f.style.bottom = "";
      if (f.parentElement !== rail.topbar) rail.topbar.appendChild(f);
      return;
    }
    f.classList.add("floating");
    if (f.parentElement !== options.root) options.root.appendChild(f);
    const btn = rail.buttonFor(activeId);
    if (!btn) return;
    const a = flyoutAnchor(btn.getBoundingClientRect(), options.root.getBoundingClientRect(), {
      width: f.offsetWidth,
      height: f.offsetHeight,
    });
    f.style.left = `${a.left}px`;
    f.style.bottom = `${a.bottom}px`;
  };
  const setActiveTool = (id: string): void => {
    activeId = id;
    rail.setActive(id);
    rail.flyout.replaceChildren();
    placeFlyout();
    options.onToolChange(id);
    if (dock) requestAnimationFrame(placeFlyout);
  };
  if (dock) window.addEventListener("resize", placeFlyout);

  const undoBtn = createButton({
    label: "Undo",
    tip: "Undo the last change (Ctrl+Z)",
    onClick: options.history.undo,
  });
  const redoBtn = createButton({
    label: "Redo",
    tip: "Redo the change you undid (Ctrl+Shift+Z)",
    onClick: options.history.redo,
  });
  const clearBtn = createButton({
    label: options.history.clearLabel,
    tip: options.history.clearTip,
    kind: "danger",
    onClick: options.history.clear,
  });
  const historyPad = el("div", "shell-history");
  historyPad.append(undoBtn, redoBtn, clearBtn);

  const pad = el("div", "shell-viewpad");
  const v = options.view;
  const b = (label: string, tip: string, run: () => void): HTMLButtonElement =>
    createButton({ label, tip, onClick: run });
  const zoomRow = el("div", "pad-row");
  zoomRow.append(
    b("+", "Zoom in", v.zoomIn),
    b("−", "Zoom out", v.zoomOut),
    b("Fit", "Fit the whole map in view", v.fit),
  );
  pad.appendChild(zoomRow);
  const arrows: [string, string, -1 | 0 | 1, -1 | 0 | 1][] = [
    ["↖", "Pan up-left", -1, -1],
    ["↑", "Pan up", 0, -1],
    ["↗", "Pan up-right", 1, -1],
    ["←", "Pan left", -1, 0],
    ["·", "Pan (centre)", 0, 0],
    ["→", "Pan right", 1, 0],
    ["↙", "Pan down-left", -1, 1],
    ["↓", "Pan down", 0, 1],
    ["↘", "Pan down-right", 1, 1],
  ];
  const grid = el("div", "pan-grid");
  for (const [l, tip, dx, dy] of arrows) {
    const btn = b(l, tip, () => v.pan(dx, dy));
    if (dx === 0 && dy === 0) btn.disabled = true;
    grid.appendChild(btn);
  }
  pad.appendChild(grid);
  const extraBtns: { btn: HTMLButtonElement; pressed?: () => boolean }[] = [];
  const sync = (): void => {
    for (const e of extraBtns)
      if (e.pressed) e.btn.setAttribute("aria-pressed", e.pressed() ? "true" : "false");
  };
  for (const x of v.extra ?? []) {
    const btn = b(x.label, x.tip, () => {
      x.run();
      sync();
    });
    extraBtns.push({ btn, pressed: x.pressed });
    pad.appendChild(btn);
  }
  sync();

  const info = createInfobar(options.infoFields, dock ? "box" : "bar");
  if (dock && rail.topbar) {
    options.root.classList.add("shell-dock");
    options.root.append(menubar.el, rail.topbar, rail.rail, historyPad, pad, info.el);
  } else {
    options.root.append(menubar.el, rail.rail, rail.flyout, historyPad, pad, info.el);
  }

  const setHistoryState = (canUndo: boolean, canRedo: boolean): void => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  };
  setHistoryState(false, false);

  return {
    setActiveTool,
    flyout: rail.flyout,
    info: { set: info.set, status: info.status, setDirty: info.setDirty },
    setHistoryState,
    setToolEnabled: rail.setEnabled,
    refreshMenus: () => {
      menubar.refresh();
      sync();
    },
    isDialogOpen: () => document.querySelector("dialog[open]") !== null,
  };
}
