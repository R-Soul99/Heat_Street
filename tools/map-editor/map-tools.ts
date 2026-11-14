// Map editor tool list, data only (07.1.1). Node-importable so the key map is unit-tested.
import type { ShellTool } from "../editor-shell/tool-rail.ts";

export type Tool = "select" | "road" | "move" | "building" | "eraser";

export const MAP_TOOLS: (ShellTool & { id: Tool; code: string })[] = [
  {
    id: "select",
    code: "KeyV",
    label: "Select",
    icon: "↖",
    keyLabel: "V",
    tip: "Select: click a road or building to edit it",
    tipLong: "Drag a box to select many roads and buildings, then press Delete.",
  },
  {
    id: "move",
    code: "KeyM",
    label: "Move node",
    icon: "✥",
    keyLabel: "M",
    tip: "Move node: drag a road node; shared roads follow",
  },
  {
    id: "road",
    code: "KeyR",
    label: "Draw road",
    icon: "╱",
    keyLabel: "R",
    tip: "Draw road: click points, double-click to finish",
    tipLong: "Click centre-line points; double-click or Enter to finish; Esc cancels.",
  },
  {
    id: "building",
    code: "KeyB",
    label: "Building",
    icon: "▭",
    keyLabel: "B",
    tip: "Building: drag a rectangle to add a building",
  },
  {
    id: "eraser",
    code: "KeyE",
    label: "Eraser",
    icon: "⌫",
    keyLabel: "E",
    tip: "Eraser: delete roads and buildings you drag over",
    tipLong: "A single click also deletes. One drag = one Undo.",
  },
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  MAP_TOOLS.map((t) => [t.code, t.id]),
);

/** Grid toggle in the floating row; X in both editors (T is the terrain Top-down key). */
export const MAP_GRID_TOGGLE: ShellTool & { id: "grid"; code: "KeyX" } = {
  id: "grid",
  code: "KeyX",
  label: "Grid",
  icon: "▦",
  keyLabel: "X",
  tip: "Grid: show grid lines",
  tipLong: "Toggle the grid; set its spacing in metres beside the button.",
};
