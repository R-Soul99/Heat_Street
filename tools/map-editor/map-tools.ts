// Map editor tool list, data only (07.1.1). Node-importable so the grouping is unit-tested.
import type { ShellTool } from "../editor-shell/tool-rail.ts";

export type Tool = "select" | "road" | "move" | "building" | "eraser";

export const TOOL_KEYS: Record<string, Tool> = {
  KeyV: "select",
  KeyR: "road",
  KeyM: "move",
  KeyB: "building",
  KeyE: "eraser",
};

export const MAP_TOOLS: (ShellTool & { id: Tool })[] = [
  {
    id: "select",
    label: "Select",
    icon: "↖",
    group: "select",
    keyLabel: "V",
    tip: "Select: click a road or building to edit it",
    tipLong: "Drag a box to select many roads and buildings, then press Delete.",
  },
  {
    id: "move",
    label: "Move node",
    icon: "✥",
    group: "select",
    keyLabel: "M",
    tip: "Move node: drag a road node; shared roads follow",
  },
  {
    id: "road",
    label: "Draw road",
    icon: "╱",
    group: "draw",
    keyLabel: "R",
    tip: "Draw road: click points, double-click to finish",
    tipLong: "Click centre-line points; double-click or Enter to finish; Esc cancels.",
  },
  {
    id: "building",
    label: "Building",
    icon: "▭",
    group: "draw",
    keyLabel: "B",
    tip: "Building: drag a rectangle to add a building",
  },
  {
    id: "eraser",
    label: "Eraser",
    icon: "⌫",
    group: "remove",
    keyLabel: "E",
    tip: "Eraser: delete roads and buildings you drag over",
    tipLong: "A single click also deletes. One drag = one Undo.",
  },
];
