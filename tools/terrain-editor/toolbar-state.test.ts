import { describe, expect, it } from "vitest";
import {
  NO_SELECTION_STATUS,
  resolveToolbarAction,
  SWITCH_TO_SELECT_STATUS,
  type ToolbarInput,
  toolbarState,
} from "./toolbar-state.ts";

const sel = (cells: number): ToolbarInput => ({
  mode: "select",
  selectionCells: cells,
  cellSizeM: 3,
  armed: null,
});
const brush = (armed: ToolbarInput["armed"], cells = 0): ToolbarInput => ({
  mode: "brush",
  selectionCells: cells,
  cellSizeM: 3,
  armed,
});

describe("toolbarState", () => {
  it("select mode with no selection disables operations and road actions", () => {
    const s = toolbarState(sel(0));
    for (const id of [
      "raise",
      "lower",
      "smooth",
      "flatten",
      "terrain",
      "lock",
      "unlock",
      "deleteRoad",
    ] as const)
      expect(s.enabled[id]).toBe(false);
    expect(s.pressed.select).toBe(true);
    expect(s.pressed.brush).toBe(false);
    expect(s.enabled.roadPaint).toBe(true);
    expect(s.enabled.roadErase).toBe(true);
    expect(s.title).toBe("Select");
    expect(s.subtitle).toBe("No selection");
  });

  it("select mode with a selection enables operations", () => {
    const s = toolbarState(sel(12));
    expect(s.enabled.raise).toBe(true);
    expect(s.enabled.lock).toBe(true);
    expect(s.pressed.raise).toBe(false);
    expect(s.subtitle).toBe("12 cells, 108 m2");
    expect(s.roadsSectionVisible).toBe(true);
    expect(s.brushControlsEnabled).toBe(false);
  });

  it("uses singular for one cell and guards bad numbers", () => {
    expect(toolbarState(sel(1)).subtitle).toBe("1 cell, 9 m2");
    expect(toolbarState({ ...sel(4), cellSizeM: Number.NaN }).subtitle).toBe("4 cells, 0 m2");
    expect(toolbarState(sel(-3)).subtitle).toBe("No selection");
  });

  it("brush mode armed raise", () => {
    const s = toolbarState(brush("raise", 5));
    expect(s.pressed.brush).toBe(true);
    expect(s.pressed.raise).toBe(true);
    for (const id of ["lock", "unlock", "deleteRoad"] as const) {
      expect(s.enabled[id]).toBe(false);
      expect(s.disabledTip[id]).toBe("Switch to Select mode (S) to use this");
    }
    expect(s.title).toBe("Brush");
    expect(s.subtitle).toBe("Raise");
    expect(s.brushControlsEnabled).toBe(true);
    expect(s.roadsSectionVisible).toBe(false);
  });

  it("brush mode with nothing armed", () => {
    expect(toolbarState(brush(null)).subtitle).toBe("Pick an operation");
  });

  it("brush mode armed roadPaint", () => {
    const s = toolbarState(brush("roadPaint"));
    expect(s.pressed.brush).toBe(true);
    expect(s.pressed.roadPaint).toBe(true);
    expect(s.subtitle).toBe("Paint");
  });
});

describe("resolveToolbarAction", () => {
  it("applies operations to a selection, blocks without one", () => {
    expect(resolveToolbarAction(sel(2), "raise")).toEqual({ kind: "apply", op: "raise" });
    expect(resolveToolbarAction(sel(0), "raise")).toEqual({
      kind: "blocked",
      status: NO_SELECTION_STATUS,
    });
    expect(NO_SELECTION_STATUS).toBe("Select an area first (drag on the map)");
  });

  it("arms operations in brush mode", () => {
    expect(resolveToolbarAction(brush(null), "smooth")).toEqual({
      kind: "arm",
      op: "smooth",
      mode: "brush",
    });
  });

  it("switches to brush when clicking Paint or Erase in select mode", () => {
    expect(resolveToolbarAction(sel(0), "roadPaint")).toEqual({
      kind: "arm",
      op: "roadPaint",
      mode: "brush",
    });
    expect(resolveToolbarAction(sel(3), "roadErase")).toEqual({
      kind: "arm",
      op: "roadErase",
      mode: "brush",
    });
  });

  it("mode clicks only change the mode", () => {
    expect(resolveToolbarAction(brush("raise", 4), "select")).toEqual({
      kind: "mode",
      mode: "select",
    });
    expect(resolveToolbarAction(sel(4), "brush")).toEqual({ kind: "mode", mode: "brush" });
  });

  it("routes road actions", () => {
    for (const a of ["lock", "unlock", "deleteRoad"] as const) {
      expect(resolveToolbarAction(sel(1), a)).toEqual({ kind: "roadAction", action: a });
      expect(resolveToolbarAction(brush(null, 1), a)).toEqual({
        kind: "blocked",
        status: SWITCH_TO_SELECT_STATUS,
      });
    }
  });

  it("routes view toggles in any mode", () => {
    expect(resolveToolbarAction(sel(0), "grid")).toEqual({ kind: "toggle", which: "grid" });
    expect(resolveToolbarAction(brush(null), "contours")).toEqual({
      kind: "toggle",
      which: "contours",
    });
  });
});
