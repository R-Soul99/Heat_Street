// Pure toolbar state and click/hotkey routing for the selection-based terrain editor (07.1.2).
// No DOM: the editor renders what this returns.
import {
  type Mode,
  type Operation,
  PLACE_TOOL_KIND,
  type PlaceKind,
  type RoadAction,
  type RoadBrush,
  type ToolbarId,
  type ViewToggle,
} from "./rail-tools.ts";

export const NO_SELECTION_STATUS = "Select an area first (drag on the map)";
export const SWITCH_TO_SELECT_STATUS = "Switch to Select mode (S) to use this";
const NEED_SELECTION_TIP = "Select an area first (S)";

export interface ToolbarInput {
  mode: Mode;
  selectionCells: number;
  cellSizeM: number;
  armed: Operation | RoadBrush | null;
  /** Armed Place kind (07.1.3). Non-null makes Place the exclusive mode. */
  placing?: PlaceKind | null;
}

export interface ToolbarState {
  enabled: Record<ToolbarId, boolean>;
  pressed: Record<ToolbarId, boolean>;
  disabledTip: Partial<Record<ToolbarId, string>>;
  /** Active road brush in Brush mode (drives the Road trigger face), else null. */
  roadFace: RoadBrush | null;
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
  | { kind: "place"; place: PlaceKind }
  | { kind: "menu"; id: "road" | "terrain" | "place" }
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
  "road",
  "place",
  ...PLACE_TOOL_KIND.map((p) => p.id),
];

const PLACE_LABEL: Record<PlaceKind, string> = {
  start: "Start point",
  building: "Building",
  tree: "Tree",
  bush: "Bush",
  hedge: "Hedge",
  fence: "Fence",
  ramp: "Ramp",
};

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

function placingState(kind: PlaceKind): ToolbarState {
  const enabled = {} as Record<ToolbarId, boolean>;
  const pressed = {} as Record<ToolbarId, boolean>;
  const disabledTip: Partial<Record<ToolbarId, string>> = {};
  for (const id of ALL_IDS) {
    enabled[id] = true;
    pressed[id] = false;
  }
  pressed.place = true;
  const armedId = PLACE_TOOL_KIND.find((p) => p.kind === kind)?.id;
  if (armedId) pressed[armedId] = true;
  for (const id of [...OPERATION_IDS, ...BRUSH_IDS, ...ROAD_ACTION_IDS]) {
    // Terrain stays enabled in Select/Brush so its trigger always opens the surface list;
    // while placing it is a terrain action, so it is disabled like the rest.
    enabled[id] = false;
    disabledTip[id] = SWITCH_TO_SELECT_STATUS;
  }
  return {
    enabled,
    pressed,
    disabledTip,
    roadFace: null,
    title: "Place",
    subtitle: PLACE_LABEL[kind],
    brushControlsEnabled: false,
    roadsSectionVisible: false,
  };
}

export function toolbarState(i: ToolbarInput): ToolbarState {
  const hasSel = safe(i.selectionCells) > 0;
  const isSelect = i.mode === "select";
  if (i.placing) return placingState(i.placing);
  const enabled = {} as Record<ToolbarId, boolean>;
  const pressed = {} as Record<ToolbarId, boolean>;
  const disabledTip: Partial<Record<ToolbarId, string>> = {};
  for (const id of ALL_IDS) {
    enabled[id] = true;
    pressed[id] = false;
  }
  pressed[i.mode] = true;
  if (!isSelect && i.armed) pressed[i.armed] = true;
  const roadFace =
    !isSelect && (i.armed === "roadPaint" || i.armed === "roadErase") ? i.armed : null;
  pressed.road = roadFace !== null;
  if (isSelect && !hasSel) {
    for (const id of OPERATION_IDS) {
      // Terrain stays enabled: its trigger must always open the surface list.
      if (id === "terrain") continue;
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
    roadFace,
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
  if (id === "road") return { kind: "menu", id: "road" };
  if (id === "place") return { kind: "menu", id: "place" };
  const placed = PLACE_TOOL_KIND.find((p) => p.id === id);
  if (placed) return { kind: "place", place: placed.kind };
  if (id === "grid" || id === "contours") return { kind: "toggle", which: id };
  if (id === "roadPaint" || id === "roadErase") return { kind: "arm", op: id, mode: "brush" };
  if (id === "lock" || id === "unlock" || id === "deleteRoad") {
    if (!isSelect) return { kind: "blocked", status: SWITCH_TO_SELECT_STATUS };
    if (!hasSel) return { kind: "blocked", status: NO_SELECTION_STATUS };
    return { kind: "roadAction", action: id };
  }
  // Operation: mode-sensitive.
  const op = id as Operation;
  if (!isSelect) return { kind: "arm", op, mode: "brush" };
  if (!hasSel) return { kind: "blocked", status: NO_SELECTION_STATUS };
  return { kind: "apply", op };
}

/**
 * Hotkey routing. P opens the Terrain drop-down and, in Brush mode, also arms the surface brush;
 * every other key acts directly like its button.
 */
export function resolveHotkey(
  i: ToolbarInput,
  id: ToolbarId,
): { openMenu?: "terrain"; action: ToolbarAction | null } {
  if (id === "terrain") {
    return {
      openMenu: "terrain",
      action: i.mode === "brush" ? { kind: "arm", op: "terrain", mode: "brush" } : null,
    };
  }
  return { action: resolveToolbarAction(i, id) };
}
