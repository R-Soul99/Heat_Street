// Pure helpers for the terrain editor's [ ] value keys, Ctrl push/pull and edit feedback.
import type { Tool, ToolOptions, ToolResult } from "./tool-dispatch";

export const NO_AREA_MESSAGE =
  "Load or create an area first: pick one at the top and press Load, or use File > New...";

export interface PrimaryValue {
  key: keyof ToolOptions;
  label: string;
  unit: string;
  step: number;
  coarse: number;
  min: number;
  max: number;
  decimals: number;
}

const RADIUS: PrimaryValue = {
  key: "radiusM",
  label: "Radius",
  unit: "m",
  step: 0.5,
  coarse: 5,
  min: 0.5,
  max: 200,
  decimals: 1,
};

/** The main adjustable value of a tool, or null (Stamp: brackets rotate instead). */
export function primaryValue(tool: Tool): PrimaryValue | null {
  switch (tool) {
    case "raise":
    case "lower":
    case "smooth":
    case "flatten":
    case "paint":
    case "erase":
    case "lock":
      return RADIUS;
    case "road":
      return {
        key: "widthM",
        label: "Road width",
        unit: "m",
        step: 0.5,
        coarse: 2,
        min: 3,
        max: 20,
        decimals: 1,
      };
    case "block":
      return {
        key: "blockCells",
        label: "Block size",
        unit: "cells",
        step: 1,
        coarse: 8,
        min: 1,
        max: 64,
        decimals: 0,
      };
    case "smoothBox":
      return {
        key: "smoothPasses",
        label: "Smooth passes",
        unit: "",
        step: 1,
        coarse: 3,
        min: 1,
        max: 10,
        decimals: 0,
      };
    case "gridSelect":
      return {
        key: "gridStepM",
        label: "Step",
        unit: "m",
        step: 0.25,
        coarse: 1,
        min: 0.25,
        max: 5,
        decimals: 2,
      };
    default:
      return null;
  }
}

/** Patch that moves the tool's primary value one step (dir +1/-1), clamped; null if none. */
export function adjustPrimary(
  tool: Tool,
  options: Readonly<ToolOptions>,
  dir: 1 | -1,
  coarse: boolean,
): Partial<ToolOptions> | null {
  const p = primaryValue(tool);
  if (!p) return null;
  const cur = options[p.key] as number;
  const raw = cur + dir * (coarse ? p.coarse : p.step);
  const clamped = Math.min(p.max, Math.max(p.min, raw));
  const f = 10 ** p.decimals;
  return { [p.key]: Math.round(clamped * f) / f } as Partial<ToolOptions>;
}

/** Ctrl-drag distance (pixels down positive) to metres moved; dragging up raises. */
export function pushPullDelta(dyPx: number, mPerPx: number, fine: boolean): number {
  const d = -dyPx * mPerPx * (fine ? 0.2 : 1);
  return d === 0 ? 0 : d;
}

const sgn = (v: number): string => (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(2);

/** One-line "how far the ground moved" text for a result, or null if no height info. */
export function editFeedback(res: Pick<ToolResult, "heightChange">, tool: Tool): string | null {
  const hc = res.heightChange;
  if (!hc) return null;
  const up = Math.abs(hc.maxUpM);
  const down = Math.abs(hc.maxDownM);
  if (up === 0 && down === 0) return "Nothing changed.";
  if (tool === "gridSelect") {
    if (down === 0) return `Selection moved ${sgn(up)} m.`;
    if (up === 0) return `Selection moved ${sgn(-down)} m.`;
    return `Selection moved ${sgn(up)} m / ${sgn(-down)} m.`;
  }
  if (down === 0 && tool === "raise") return `Raised up to ${sgn(up)} m.`;
  if (up === 0 && tool === "lower") return `Lowered up to ${sgn(-down)} m.`;
  return `Moved ${sgn(up)} m / ${sgn(-down)} m.`;
}
