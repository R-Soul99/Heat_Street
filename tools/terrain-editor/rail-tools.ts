// Terrain editor toolbar data (07.1.2). Node-importable so the grouping is unit-tested.
import type { ShellTool } from "../editor-shell/tool-rail.ts";

// ---------------------------------------------------------------------------
// 07.1.2 selection-based toolbar: modes, operations, road column, view toggles.
// ---------------------------------------------------------------------------

export type Mode = "select" | "brush";
export type Operation = "raise" | "lower" | "smooth" | "flatten" | "terrain";
export type RoadBrush = "roadPaint" | "roadErase";
export type RoadAction = "lock" | "unlock" | "deleteRoad";
export type ViewToggle = "grid" | "contours";
export type ToolbarId = Mode | Operation | RoadBrush | RoadAction | ViewToggle;
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
  },
];

export const ROAD_BUTTONS: ToolbarTool[] = [
  {
    id: "roadPaint",
    label: "Paint",
    icon: "═",
    keyLabel: "R",
    code: "KeyR",
    tip: "Paint: drag to draw road",
  },
  {
    id: "roadErase",
    label: "Erase",
    icon: "✕",
    keyLabel: "E",
    code: "KeyE",
    tip: "Erase: drag to remove road under the cursor",
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

// Codes owned elsewhere (top-down, drive, undo/redo, escape). X and C are now owned by the
// toolbar toggles (plan 10 removes them from editor BINDINGS).
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
