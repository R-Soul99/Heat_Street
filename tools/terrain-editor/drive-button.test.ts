import { describe, expect, it } from "vitest";
import { DRIVE_FALLBACK_STATUS, driveButtonTip } from "./drive-button.ts";

describe("driveButtonTip", () => {
  it("names the start it will use and the D shortcut", () => {
    const tip = driveButtonTip("Start 2");
    expect(tip).toContain("Start 2");
    expect(tip).toContain("(D)");
  });
  it("says it falls back to the view centre when there is no start point", () => {
    expect(driveButtonTip(undefined)).toContain("centre of the view");
    expect(DRIVE_FALLBACK_STATUS).toContain("No start point");
  });
});
