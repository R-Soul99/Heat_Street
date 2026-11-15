import { describe, expect, it } from "vitest";
import { resolveRaceLaps } from "../src/core/race-laps";
import mainSource from "../src/main.ts?raw";

describe("resolveRaceLaps (?laps=N practice override, 07-07)", () => {
  it("keeps the course lap count, saved, with no note when absent", () => {
    expect(resolveRaceLaps("?mode=circuit-race", 3)).toEqual({
      laps: 3,
      practice: false,
      note: null,
    });
  });

  it("overrides to N (1-9) as a practice run that is not saved", () => {
    expect(resolveRaceLaps("?mode=circuit-race&laps=1", 3)).toEqual({
      laps: 1,
      practice: true,
      note: "1-LAP PRACTICE - NOT SAVED",
    });
    expect(resolveRaceLaps("?laps=9", 3)).toMatchObject({ laps: 9, practice: true });
    expect(resolveRaceLaps("?laps=5", 3).note).toBe("5-LAP PRACTICE - NOT SAVED");
  });

  it("an override equal to the course's own count is a normal, saved race", () => {
    expect(resolveRaceLaps("?laps=3", 3)).toEqual({ laps: 3, practice: false, note: null });
  });

  it.each(["0", "10", "-1", "2.5", "x", "", " 2", "1e0", "01"])(
    "ignores an invalid value %j",
    (value) => {
      expect(resolveRaceLaps(`?laps=${encodeURIComponent(value)}`, 3)).toEqual({
        laps: 3,
        practice: false,
        note: null,
      });
    },
  );
});

describe("main.ts wiring for ?laps=N", () => {
  it("resolves the override and never saves a practice run", () => {
    expect(mainSource).toContain("resolveRaceLaps(");
    const saveAt = mainSource.indexOf("saveRaceResult(\n");
    expect(saveAt).toBeGreaterThan(0);
    const guard = mainSource.lastIndexOf("raceLaps?.practice !== true &&", saveAt);
    expect(guard).toBeGreaterThan(0);
    expect(saveAt - guard).toBeLessThan(120);
    expect(mainSource).toContain("laps: raceLaps.laps");
    expect(mainSource).toContain("raceHud.showNote(");
  });
});
