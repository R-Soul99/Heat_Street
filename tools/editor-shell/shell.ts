/**
 * Editor-agnostic shell layout: menubar, fixed left sidebar (large tool name + options),
 * slim top bar over the canvas (tool groups, drop-downs, Undo/Redo/Clear), view pad, info box.
 * Knows nothing about roads or terrain.
 */
import { createButton, createSection, el } from "./controls.ts";
import { openDialog } from "./dialog.ts";
import { createInfobar, type InfoField } from "./infobar.ts";
import { createMenubar, type MenuItemSpec, type MenuSpec } from "./menubar.ts";
import { displayLabel, type ShellTool } from "./tool-rail.ts";
import { installTooltips, setTooltipsEnabled, tooltipsEnabled } from "./tooltips.ts";
import {
  type BarGroup,
  createTopBar,
  RESERVED_SLOTS,
  type TopBar,
  validateBarSpec,
  withHistoryGroup,
} from "./top-bar.ts";

export { adjustDirection, isTextEntryFocused } from "./keys.ts";
export type { InfoField, MenuItemSpec, MenuSpec, ShellTool };

export interface ShellOptions {
  root: HTMLElement;
  /** Ignored; the sidebar layout is the only layout (07.1.1). Kept so existing call sites compile. */
  layout?: "dock";
  menus: MenuSpec[];
  tools: ShellTool[];
  onToolChange: (id: string) => void;
  /** Top bar groups over the canvas (07.1.2 D-32). Undo/Redo/Clear are added by the shell. */
  bar?: {
    groups: BarGroup[];
    slots?: Record<string, HTMLElement>;
    onMenu?: (id: string, open: boolean) => void;
  };
  /** Persistent sidebar "View" section content, shown below the tool options (D-36). */
  sidebarView?: HTMLElement[];
  /** Bar tool click handler; defaults to setActiveTool(id). */
  onToolbarClick?: (id: string) => void;
  history: {
    undo: () => void;
    redo: () => void;
    clearSelection?: { run: () => void; tip: string };
    clearAll?: { run: () => void; tip: string };
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
  /** The fixed left sidebar (pinned pair, tool title, options body). */
  sidebar: HTMLElement;
  /** Sidebar body for the active tool's options (alias kept from the old flyout). */
  flyout: HTMLElement;
  info: {
    set(key: string, text: string): void;
    status(text: string, kind?: "info" | "ok" | "error"): void;
    setDirty(dirty: boolean): void;
  };
  setHistoryState(canUndo: boolean, canRedo: boolean): void;
  setClearSelectionEnabled(on: boolean): void;
  setSidebarTitle(title: string, subtitle?: string): void;
  bar: TopBar | undefined;
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
  let bar: TopBar | undefined;
  const sidebar = el("aside", "shell-sidebar");
  const title = el("div", "sidebar-title", "No tool selected");
  const subtitle = el("div", "sidebar-subtitle");
  subtitle.hidden = true;
  const divider = el("div", "sidebar-divider");
  const body = el("div", "sidebar-body");
  sidebar.append(title, subtitle, divider, body);
  if (options.sidebarView) {
    sidebar.appendChild(
      createSection(
        "View",
        "Display settings for the grid and overlays, shown for every tool",
        true,
        options.sidebarView,
      ),
    );
  }
  const showEmpty = (): void => {
    body.replaceChildren(el("div", "sidebar-empty", "Pick a tool to see its options."));
  };
  showEmpty();
  const setSidebarTitle = (t: string, sub?: string): void => {
    title.textContent = t;
    subtitle.textContent = sub ?? "";
    subtitle.hidden = !sub;
  };
  const setActiveTool = (id: string): void => {
    for (const x of options.tools) bar?.setPressed(x.id, x.id === id);
    const t = options.tools.find((x) => x.id === id);
    setSidebarTitle(t ? displayLabel(t) : id);
    body.replaceChildren();
    options.onToolChange(id);
  };
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
  const h = options.history;
  const historySlots: Record<string, HTMLElement> = { undo: undoBtn, redo: redoBtn };
  let clearSelectionBtn: HTMLButtonElement | undefined;
  if (h.clearSelection) {
    clearSelectionBtn = createButton({
      label: "Clear selection",
      tip: h.clearSelection.tip,
      onClick: h.clearSelection.run,
    });
    historySlots.clearSelection = clearSelectionBtn;
  }
  if (h.clearAll) {
    historySlots.clearAll = createButton({
      label: "Clear all",
      tip: h.clearAll.tip,
      kind: "danger",
      onClick: h.clearAll.run,
    });
  }
  const editorSlots = options.bar?.slots ?? {};
  for (const id of RESERVED_SLOTS) {
    if (id in editorSlots) console.warn(`top bar: slot id "${id}" is reserved for the shell`);
  }
  const barGroups = options.bar?.groups ?? [];
  for (const err of validateBarSpec(barGroups)) console.warn(`top bar: ${err}`);
  bar = createTopBar(
    withHistoryGroup(barGroups, Object.keys(historySlots)),
    { ...editorSlots, ...historySlots },
    options.onToolbarClick ?? setActiveTool,
    options.bar?.onMenu,
  );

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

  const info = createInfobar(options.infoFields);
  options.root.append(menubar.el, sidebar);
  options.root.append(bar.el, pad, info.el);

  const setHistoryState = (canUndo: boolean, canRedo: boolean): void => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  };
  setHistoryState(false, false);

  return {
    setActiveTool,
    sidebar,
    flyout: body,
    info: { set: info.set, status: info.status, setDirty: info.setDirty },
    setHistoryState,
    setClearSelectionEnabled: (on) => {
      if (clearSelectionBtn) clearSelectionBtn.disabled = !on;
    },
    setSidebarTitle,
    bar,
    setToolEnabled: (id, on) => bar?.setEnabled(id, on),
    refreshMenus: () => {
      menubar.refresh();
      sync();
    },
    isDialogOpen: () => document.querySelector("dialog[open]") !== null,
  };
}
