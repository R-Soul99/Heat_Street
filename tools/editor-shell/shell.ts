import { confirmDialog, isDialogOpen, openDialog } from "./dialog";
import { createInfoBar } from "./infobar";
import { createMenubar } from "./menubar";
import "./shell.css";
import { createToolRail } from "./tool-rail";
import type { ShellHandle, ShellOptions } from "./types";

function button(label: string, tip: string, run: () => void, cls?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.dataset.tip = tip;
  if (cls) b.className = cls;
  b.addEventListener("click", run);
  return b;
}

/** Builds the shared D-01 editor layout. Knows nothing about map/terrain specifics. */
export function createShell(o: ShellOptions): ShellHandle {
  o.root.classList.add("es-root");
  o.root.replaceChildren();

  const menubar = createMenubar(o.title, o.menus, o.topbarExtras ?? []);

  const canvasHost = document.createElement("div");
  canvasHost.className = "es-canvas-host";

  const rail = createToolRail(o.tools, o.initialTool, o.onToolChange);

  // Undo / Redo / (Clear)
  const history = document.createElement("div");
  history.className = "es-history";
  const undo = button("Undo", "Undo the last change (Ctrl+Z)", o.history.onUndo);
  const redo = button(
    "Redo",
    "Redo the change you just undid (Ctrl+Shift+Z or Ctrl+Y)",
    o.history.onRedo,
  );
  undo.disabled = true;
  redo.disabled = true;
  history.append(undo, redo);
  const onClear = o.history.onClear;
  if (onClear) {
    history.append(
      button(
        o.history.clearLabel ?? "Clear",
        o.history.clearTip ?? "Remove everything (asks to confirm first)",
        onClear,
        "danger",
      ),
    );
  }

  // Zoom / fit / pan pad
  const viewpad = document.createElement("div");
  viewpad.className = "es-viewpad";
  const zoomRow = document.createElement("div");
  zoomRow.className = "es-zoomrow";
  zoomRow.append(
    button("+", "Zoom in (scroll wheel up)", o.view.onZoomIn),
    button("−", "Zoom out (scroll wheel down)", o.view.onZoomOut),
    button("Fit", "Zoom to show the whole area", o.view.onFit),
  );
  for (const x of o.view.extra ?? []) zoomRow.append(button(x.label, x.tip, x.run));
  const pan = document.createElement("div");
  pan.className = "es-pan";
  const dirs: [string, string, -1 | 0 | 1, -1 | 0 | 1][] = [
    ["", "", 0, 0],
    ["↑", "Pan up", 0, -1],
    ["", "", 0, 0],
    ["←", "Pan left", -1, 0],
    ["", "", 0, 0],
    ["→", "Pan right", 1, 0],
    ["", "", 0, 0],
    ["↓", "Pan down", 0, 1],
    ["", "", 0, 0],
  ];
  for (const [label, tip, dx, dy] of dirs) {
    if (!label) {
      pan.append(document.createElement("span"));
      continue;
    }
    pan.append(button(label, tip, () => o.view.onPan(dx, dy)));
  }
  viewpad.append(zoomRow, pan);

  const info = createInfoBar(o.infoFields);

  o.root.append(menubar, canvasHost, rail.rail, rail.flyout, history, viewpad, info.el);

  return {
    canvasHost,
    info: info.bar,
    setTool: (id) => rail.select(id),
    activeTool: () => rail.active(),
    refreshToolOptions: () => rail.refreshOptions(),
    setHistoryState(canUndo, canRedo) {
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
    },
    dialog: openDialog,
    confirm: confirmDialog,
    isDialogOpen,
  };
}
