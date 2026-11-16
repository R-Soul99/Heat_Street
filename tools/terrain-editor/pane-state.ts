// Pure choice of what the left pane shows (quick 261116-a53). No DOM: the editor renders it.
// The pane follows the context: an armed Place kind shows only that kind's options, a selected
// placed item shows only that item's panel, otherwise the general Select or Brush controls.
import type { PlaceKind } from "./rail-tools.ts";

export type SelectedItemKind = "building" | "ramp" | "tree" | "bush" | "hedge" | "fence";

export type PaneKind = "place" | "item" | "select" | "brush";

export interface PaneInput {
  mode: "select" | "brush";
  placing: PlaceKind | null;
  /** Kind of the single selected placed item, or null when nothing is selected. */
  selectedItem: SelectedItemKind | null;
}

export interface PaneChoice {
  panel: PaneKind;
  /** Changes when the pane must be rebuilt for a different context. */
  key: string;
  /** The general Select sections (Step, Slope limit, box actions, Start points list...). */
  showGeneralSelect: boolean;
  /** The selected-item panel (only item controls, triangle count, hint). */
  showItemPanel: boolean;
  /** Rotation field is offered for these item kinds. */
  rotatable: boolean;
  /** Pane header to show instead of the toolbar title (the item kind), or null to keep the toolbar's. */
  headerTitle: string | null;
  /** Whether the shared View section (grid spacing, contour interval) is shown. */
  showView: boolean;
}

const ROTATABLE: readonly SelectedItemKind[] = ["building", "ramp", "tree", "bush"];

export function isRotatableKind(kind: SelectedItemKind | null): boolean {
  return kind !== null && ROTATABLE.includes(kind);
}

export function paneChoice(i: PaneInput): PaneChoice {
  if (i.placing) {
    return {
      panel: "place",
      key: `place:${i.placing}`,
      showGeneralSelect: false,
      showItemPanel: false,
      rotatable: false,
      headerTitle: null,
      showView: true,
    };
  }
  if (i.mode === "brush") {
    return {
      panel: "brush",
      key: "brush",
      showGeneralSelect: false,
      showItemPanel: false,
      rotatable: false,
      headerTitle: null,
      showView: true,
    };
  }
  if (i.selectedItem) {
    return {
      panel: "item",
      key: `item:${i.selectedItem}`,
      showGeneralSelect: false,
      showItemPanel: true,
      rotatable: isRotatableKind(i.selectedItem),
      headerTitle: itemPanelTitle(i.selectedItem),
      showView: false,
    };
  }
  return {
    panel: "select",
    key: "select",
    showGeneralSelect: true,
    showItemPanel: false,
    rotatable: false,
    headerTitle: null,
    showView: true,
  };
}

/** Title for the selected-item panel. */
export function itemPanelTitle(kind: SelectedItemKind): string {
  switch (kind) {
    case "building":
      return "Building";
    case "ramp":
      return "Ramp";
    case "tree":
      return "Tree";
    case "bush":
      return "Bush";
    case "hedge":
      return "Hedge";
    case "fence":
      return "Fence";
  }
}

/** Short hint line under an item panel's controls. */
export function itemPanelHint(_kind: SelectedItemKind): string {
  return "Drag to move, Delete removes it.";
}

/** Normalises any degree value to a whole number 0..359 (typed or computed). */
export function wrapDegrees(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = Math.round(deg) % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed shortest turn from `from` to `to` in degrees, in (-180, 180]. */
export function shortestTurnDeg(from: number, to: number): number {
  let d = wrapDegrees(to) - wrapDegrees(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
