// Pure toolbar state and click/hotkey routing for the selection-based terrain editor (07.1.2).
// No DOM: the editor renders what this returns.
import type {
  Mode,
  Operation,
  RoadAction,
  RoadBrush,
  ToolbarId,
  ViewToggle,
} from "./rail-tools.ts";

export const NO_SELECTION_STATUS = "Select an area first (drag on the map)";
export const SWITCH_TO_SELECT_STATUS = "Switch to Select mode (S) to use this";
const NEED_SELECTION_TIP = "Select an area first (S)";

export interface ToolbarInput {
  mode: Mode;
  selectionCells: number;
  cellSizeM: number;
  armed: Operation | RoadBrush | null;
}

export interface ToolbarState {
  enabled: Record<ToolbarId, boolean>;
  pressed: Record<ToolbarId, boolean>;
  disabledTip: Partial<Record<ToolbarId, string>>;
  title: string;
  subtitle: string;
  brushControlsEnabled: boolean;
  roadsSectionVisible: boolean;
}

export type ToolbarAction =
  | { kind: "mode"; mode: Mode }
  | { kind: "arm"; op: Operation | RoadBrush; mode: "brush" }
  | { kind: "apply"; op: Operation }
  | { kind: "roadAction"; action: RoadAction }
  | { kind: "toggle"; which: ViewToggle }
  | { kind: "blocked"; status: string };

const OPERATION_IDS: readonly ToolbarId[] = ["raise", "lower", "smooth", "flatten", "terrain"];
const BRUSH_IDS: readonly ToolbarId[] = ["roadPaint", "roadErase"];
const ROAD_ACTION_IDS: readonly ToolbarId[] = ["lock", "unlock", "deleteRoad"];
const ALL_IDS: readonly ToolbarId[] = [
  "select",
  "brush",
  ...OPERATION_IDS,
  ...BRUSH_IDS,
  ...ROAD_ACTION_IDS,
  "grid",
  "contours",
];

const OP_LABEL: Record<Operation | RoadBrush, string> = {
  raise: "Raise",
  lower: "Lower",
  smooth: "Smooth",
  flatten: "Flatten",
  terrain: "Terrain",
  roadPaint: "Paint",
  roadErase: "Erase",
};

// Non-finite or negative input is treated as 0 (T-07.1.2-06).
function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function selectionSubtitle(cells: number, cellSizeM: number): string {
  const c = Math.floor(safe(cells));
  if (c === 0) return "No selection";
  const cell = safe(cellSizeM);
  const area = Math.round(c * cell * cell);
  return `${c} ${c === 1 ? "cell" : "cells"}, ${area} m2`;
}

export function toolbarState(i: ToolbarInput): ToolbarState {
  const hasSel = safe(i.selectionCells) > 0;
  const isSelect = i.mode === "select";
  const enabled = {} as Record<ToolbarId, boolean>;
  const pressed = {} as Record<ToolbarId, boolean>;
  const disabledTip: Partial<Record<ToolbarId, string>> = {};
  for (const id of ALL_IDS) {
    enabled[id] = true;
    pressed[id] = false;
  }
  pressed[i.mode] = true;
  if (!isSelect && i.armed) pressed[i.armed] = true;
  if (isSelect && !hasSel) {
    for (const id of OPERATION_IDS) {
      enabled[id] = false;
      disabledTip[id] = NEED_SELECTION_TIP;
    }
  }
  for (const id of ROAD_ACTION_IDS) {
    if (!isSelect) {
      enabled[id] = false;
      disabledTip[id] = SWITCH_TO_SELECT_STATUS;
    } else if (!hasSel) {
      enabled[id] = false;
      disabledTip[id] = NEED_SELECTION_TIP;
    }
  }
  let subtitle: string;
  if (isSelect) subtitle = selectionSubtitle(i.selectionCells, i.cellSizeM);
  else subtitle = i.armed ? OP_LABEL[i.armed] : "Pick an operation";
  return {
    enabled,
    pressed,
    disabledTip,
    title: isSelect ? "Select" : "Brush",
    subtitle,
    brushControlsEnabled: !isSelect,
    roadsSectionVisible: isSelect,
  };
}

export function resolveToolbarAction(i: ToolbarInput, id: ToolbarId): ToolbarAction {
  const hasSel = safe(i.selectionCells) > 0;
  const isSelect = i.mode === "select";
  if (id === "select" || id === "brush") return { kind: "mode", mode: id };
  if (id === "grid" || id === "contours") return { kind: "toggle", which: id };
  if (id === "roadPaint" || id === "roadErase") return { kind: "arm", op: id, mode: "brush" };
  if (id === "lock" || id === "unlock" || id === "deleteRoad") {
    if (!isSelect) return { kind: "blocked", status: SWITCH_TO_SELECT_STATUS };
    if (!hasSel) return { kind: "blocked", status: NO_SELECTION_STATUS };
    return { kind: "roadAction", action: id };
  }
  // Operation: mode-sensitive.
  if (!isSelect) return { kind: "arm", op: id, mode: "brush" };
  if (!hasSel) return { kind: "blocked", status: NO_SELECTION_STATUS };
  return { kind: "apply", op: id };
}
