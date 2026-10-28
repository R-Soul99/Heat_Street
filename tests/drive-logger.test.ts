import { describe, expect, it } from "vitest";
import {
  type DriveLogRow,
  driveLogHeader,
  driveLogRow,
  toDriveLogCsv,
} from "../src/debug/drive-logger";

const row: DriveLogRow = {
  t: 1.5,
  mark: 2,
  keySteer: -1,
  steer: -0.5,
  throttle: 1,
  brake: 0,
  handbrake: 0,
  wheelSteerDeg: -3.25,
  speedMph: 61.234,
  forwardMph: 60,
  slipDeg: 4.5,
  yawRate: 0.5,
  rollDeg: 2,
  contacts: 4,
  rearSideFriction: 0.184,
  rearTerm: "lift",
  rearGripScale: 1,
  frontSideImpulse: 10,
  rearSideImpulse: 20,
  suspFL: 0.4,
  suspFR: 0.4,
  suspRL: 0.4,
  suspRR: 0.4,
};

describe("drive logger CSV", () => {
  it("emits one value per header column", () => {
    const cols = driveLogHeader().split(",").length;
    expect(driveLogRow(row).split(",")).toHaveLength(cols);
  });

  it("formats numbers and keeps text terms", () => {
    const line = driveLogRow(row);
    expect(line.startsWith("1.500,2,-1,-0.500,")).toBe(true);
    expect(line).toContain(",lift,");
  });

  it("writes a header plus one line per row", () => {
    const csv = toDriveLogCsv([row, row]);
    expect(csv.trim().split("\n")).toHaveLength(3);
  });
});
