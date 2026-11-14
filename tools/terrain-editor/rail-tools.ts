// Terrain editor tool list, data only (07.1.1). Node-importable so the grouping is unit-tested.
import type { ShellTool } from "../editor-shell/tool-rail.ts";
import type { Tool } from "./tool-dispatch.ts";

export const RAIL_TOOLS: (ShellTool & { id: Tool })[] = [
  {
    id: "raise",
    label: "Raise",
    icon: "▲",
    group: "sculpt",
    dock: "top",
    keyLabel: "H",
    tip: "Raise: lift terrain under the brush",
    tipLong:
      "Click or drag to raise terrain by up to Strength metres per dab at the centre. Zoom in to see small changes; the info bar shows the change.",
  },
  {
    id: "lower",
    label: "Lower",
    icon: "▼",
    group: "sculpt",
    dock: "top",
    keyLabel: "J",
    tip: "Lower: dig terrain under the brush",
    tipLong:
      "Click or drag to lower terrain by up to Strength metres per dab at the centre. Zoom in to see small changes; the info bar shows the change.",
  },
  {
    id: "smooth",
    label: "Smooth",
    icon: "≈",
    group: "sculpt",
    keyLabel: "G",
    tip: "Smooth: ease bumps under the brush",
  },
  {
    id: "flatten",
    label: "Flatten",
    icon: "▬",
    group: "sculpt",
    keyLabel: "F",
    tip: "Flatten: level to the height where you start",
  },
  {
    id: "gridSelect",
    label: "Grid select",
    icon: "▦",
    group: "select",
    keyLabel: "S",
    tip: "Grid select: drag a rectangle of cells to edit",
    tipLong:
      "Drag a rectangle of cells. Then use Raise selection / Lower selection in the sidebar, or Ctrl+drag up/down to push or pull it by hand.",
  },
  {
    id: "block",
    label: "Block",
    icon: "▣",
    group: "select",
    keyLabel: "B",
    tip: "Block: raise or lower a square block of cells",
    tipLong: "Click steps it; drag paints blocks.",
  },
  {
    id: "smoothBox",
    label: "Smooth area",
    shortLabel: "Smooth box",
    icon: "▒",
    group: "select",
    keyLabel: "M",
    tip: "Smooth box: drag a box to smooth that area",
    tipLong: "Roads never move.",
  },
  {
    id: "paint",
    label: "Surface paint",
    shortLabel: "Paint",
    icon: "◐",
    group: "surface",
    keyLabel: "P",
    tip: "Paint: paint a surface type onto the terrain",
    tipLong: "Surface types include tarmac, gravel and grass.",
  },
  {
    id: "road",
    label: "Road brush",
    shortLabel: "Road",
    icon: "═",
    group: "roads",
    keyLabel: "R",
    tip: "Road: drag a road; the ground grades flat under it",
  },
  {
    id: "erase",
    label: "Erase road",
    shortLabel: "Erase",
    icon: "✕",
    group: "roads",
    keyLabel: "E",
    tip: "Erase: remove road segments under the brush",
  },
  {
    id: "lock",
    label: "Lock/unlock road",
    shortLabel: "Lock",
    icon: "⚿",
    group: "roads",
    keyLabel: "L",
    tip: "Lock: click a road to lock or unlock it",
    tipLong: "Shift+click selects a road without toggling it.",
  },
  {
    id: "stamp",
    label: "Stamp",
    icon: "◭",
    group: "roads",
    keyLabel: "W",
    tip: "Stamp: stamp a ramp or mound; drag to set length",
    tipLong: "Shapes are a wedge (ramp) or a mound.",
  },
];

export const RAIL_TOOL_IDS = new Set<string>(RAIL_TOOLS.map((t) => t.id));

// ---------------------------------------------------------------------------
// 07.1.2 selection-based toolbar: modes, operations, road column, view toggles.
// RAIL_TOOLS above stays until its last consumer is removed (plan 11).
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
