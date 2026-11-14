// Terrain editor toolbar data (07.1.2). Node-importable so the grouping is unit-tested.

import type { ShellTool } from "../editor-shell/tool-rail.ts";
import type { BarGroup } from "../editor-shell/top-bar.ts";

// ---------------------------------------------------------------------------
// 07.1.2 selection-based toolbar: modes, operations, road column, view toggles.
// ---------------------------------------------------------------------------

export type Mode = "select" | "brush";
export type Operation = "raise" | "lower" | "smooth" | "flatten" | "terrain";
export type RoadBrush = "roadPaint" | "roadErase";
export type RoadAction = "lock" | "unlock" | "deleteRoad";
export type ViewToggle = "grid" | "contours";
export type RoadMenu = "road";
export type ToolbarId = Mode | Operation | RoadBrush | RoadAction | ViewToggle | RoadMenu;
/** The dispatcher's existing internal tool names. */
export type BrushToolName = "raise" | "lower" | "smooth" | "flatten" | "paint" | "road" | "erase";

export type ToolbarTool = ShellTool & { id: ToolbarId; code: string };

export const MODES: ToolbarTool[] = [
  {
    id: "select",
    label: "Select",
    icon: "▭",
    keyLabel: "S",
    code: "KeyS",
    tip: "Select: drag a box, then act on it",
    tipLong:
      "Drag replaces the selection. Shift+drag adds a box. Ctrl+drag subtracts. Alt+drag pushes or pulls the selection by hand.",
  },
  {
    id: "brush",
    label: "Brush",
    icon: "◉",
    keyLabel: "B",
    code: "KeyB",
    tip: "Brush: paint an operation under the cursor",
  },
];

export const OPERATIONS: ToolbarTool[] = [
  {
    id: "raise",
    label: "Raise",
    icon: "▲",
    keyLabel: "H",
    code: "KeyH",
    tip: "Raise: lift the selection or brush terrain",
  },
  {
    id: "lower",
    label: "Lower",
    icon: "▼",
    keyLabel: "J",
    code: "KeyJ",
    tip: "Lower: dig the selection or brush terrain",
  },
  {
    id: "smooth",
    label: "Smooth",
    icon: "≈",
    keyLabel: "G",
    code: "KeyG",
    tip: "Smooth: ease bumps in the selection or brush",
  },
  {
    id: "flatten",
    label: "Flatten",
    icon: "▬",
    keyLabel: "F",
    code: "KeyF",
    tip: "Flatten: level to the selection average",
  },
  {
    id: "terrain",
    label: "Terrain",
    icon: "◐",
    keyLabel: "P",
    code: "KeyP",
    tip: "Terrain: fill or brush the chosen surface",
    tipLong:
      "Opens the surface list. Picking one fills the selection, or arms the surface brush in Brush mode.",
  },
];

export const ROAD_BUTTONS: ToolbarTool[] = [
  {
    id: "roadPaint",
    label: "Paint road",
    icon: "═",
    keyLabel: "R",
    code: "KeyR",
    tip: "Paint road: drag to draw road",
  },
  {
    id: "roadErase",
    label: "Erase road",
    icon: "✕",
    keyLabel: "E",
    code: "KeyE",
    tip: "Erase road: drag to remove road",
  },
  {
    id: "lock",
    label: "Lock",
    icon: "⚿",
    keyLabel: "L",
    code: "KeyL",
    tip: "Lock: freeze roads touching the selection",
    tipLong: "Whole roads touching the selection change, not just the selected cells.",
  },
  {
    id: "unlock",
    label: "Unlock",
    icon: "⚷",
    keyLabel: "U",
    code: "KeyU",
    tip: "Unlock: free roads touching the selection",
    tipLong: "Whole roads touching the selection change, not just the selected cells.",
  },
  {
    id: "deleteRoad",
    label: "Delete road",
    icon: "⌫",
    keyLabel: "Del",
    code: "Delete",
    tip: "Delete road: cut roads out of the selection",
    tipLong: "Undoable. Deletes locked roads too.",
  },
];

/** The Road drop-down trigger. No hotkey of its own: R, E, L, U and Delete pick its tools directly. */
export const ROAD_MENU: ShellTool & { id: "road" } = {
  id: "road",
  label: "Road",
  icon: "╬",
  tip: "Road: draw, erase, lock or delete roads",
  tipLong: "Opens the road tools. R, E, L, U and Delete pick them directly.",
};

export const VIEW_TOGGLES: ToolbarTool[] = [
  {
    id: "grid",
    label: "Grid",
    icon: "▦",
    keyLabel: "X",
    code: "KeyX",
    tip: "Grid: show grid lines",
  },
  {
    id: "contours",
    label: "Contours",
    icon: "◠",
    keyLabel: "C",
    code: "KeyC",
    tip: "Contours: show height lines",
  },
];

export const TOOLBAR_TOOLS: ToolbarTool[] = [
  ...MODES,
  ...OPERATIONS,
  ...ROAD_BUTTONS,
  ...VIEW_TOGGLES,
];

export const TERRAIN_HOTKEYS: Readonly<Record<string, ToolbarId>> = Object.fromEntries(
  TOOLBAR_TOOLS.map((t) => [t.code, t.id]),
);

// Codes owned elsewhere (top-down, drive, undo/redo, escape). X and C belong to the bar toggles.
export const TOOLBAR_GLOBAL_CODES = ["KeyT", "KeyD", "KeyZ", "KeyY", "Escape"] as const;

export const BRUSH_TOOL_FOR: Readonly<Record<Operation | RoadBrush, BrushToolName>> = {
  raise: "raise",
  lower: "lower",
  smooth: "smooth",
  flatten: "flatten",
  terrain: "paint",
  roadPaint: "road",
  roadErase: "erase",
};

const byId = (id: ToolbarId): ToolbarTool => {
  const t = TOOLBAR_TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool ${id}`);
  return t;
};
const tool = (id: ToolbarId) => ({ kind: "tool" as const, tool: byId(id) });

/** D-32 top bar: Select | Brush | Raise/Lower | Smooth Flatten | Terrain, Road | Grid Contours | Undo Redo. */
export const TERRAIN_BAR: BarGroup[] = [
  {
    id: "selection",
    label: "Selection",
    items: [tool("select"), { kind: "slot", id: "clearSelection" }],
  },
  { id: "brush", label: "Brush", items: [tool("brush")] },
  {
    id: "raiseLower",
    label: "Raise and lower",
    items: [{ kind: "stack", tools: [byId("raise"), byId("lower")] }],
  },
  { id: "smoothFlatten", label: "Smooth and flatten", items: [tool("smooth"), tool("flatten")] },
  {
    id: "menus",
    label: "Terrain and roads",
    items: [
      { kind: "menu", tool: byId("terrain"), items: [{ kind: "slot", id: "surfaces" }] },
      {
        kind: "menu",
        tool: ROAD_MENU,
        items: [
          tool("roadPaint"),
          tool("roadErase"),
          { kind: "divider" },
          tool("lock"),
          tool("unlock"),
          tool("deleteRoad"),
        ],
      },
    ],
  },
  { id: "view", label: "View", items: [tool("grid"), tool("contours")] },
  {
    id: "history",
    label: "History",
    items: [
      { kind: "slot", id: "undo" },
      { kind: "slot", id: "redo" },
    ],
  },
];
