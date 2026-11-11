import { describe, expect, it } from "vitest";
import {
  planImportWorld,
  suggestMapId,
  validateNewMapInput,
  validateNewWorldBody,
} from "./new-map.ts";

describe("suggestMapId", () => {
  it("numbers blank maps", () => {
    expect(suggestMapId([])).toBe("map-1");
    expect(suggestMapId(["map-1", "map-2"])).toBe("map-3");
  });
  it("uses a sanitised base and avoids clashes", () => {
    expect(suggestMapId(["my-map"], "poppmap")).toBe("poppmap");
    expect(suggestMapId(["poppmap"], "poppmap")).toBe("poppmap-2");
    expect(suggestMapId([], "Popp Map.png")).toBe("popp-map");
    expect(suggestMapId([], "!!!.png")).toBe("map");
  });
});

describe("validateNewMapInput", () => {
  it("rejects bad names", () => {
    expect(validateNewMapInput({ id: "", widthKm: 6, heightKm: 6 }, [])).toBe(
      "Give the map a name: a-z, 0-9 and - only (for example my-map).",
    );
    expect(validateNewMapInput({ id: "My Map", widthKm: 6, heightKm: 6 }, [])).toContain(
      "a-z, 0-9 and -",
    );
  });
  it("rejects bad sizes", () => {
    expect(validateNewMapInput({ id: "ok", widthKm: 0.2, heightKm: 6 }, [])).toBe(
      "Width must be between 0.5 and 10 km (you entered 0.200).",
    );
    expect(validateNewMapInput({ id: "ok", widthKm: 6, heightKm: Number.NaN }, [])).toBe(
      "Height must be a number between 0.5 and 10 km.",
    );
  });
  it("rejects existing names", () => {
    expect(validateNewMapInput({ id: "my-map", widthKm: 6, heightKm: 6 }, ["my-map"])).toBe(
      'A map called "my-map" already exists. Pick another name.',
    );
  });
  it("accepts valid input", () => {
    expect(validateNewMapInput({ id: "my-map", widthKm: 6, heightKm: 6 }, [])).toBeNull();
  });
});

describe("validateNewWorldBody", () => {
  it("validates the request body", () => {
    expect(validateNewWorldBody({ id: "x", widthKm: "6", heightKm: 6 })).toBe(
      "Width must be a number between 0.5 and 10 km.",
    );
    expect(validateNewWorldBody(null)).toBe(
      "Request body must be JSON with id, widthKm and heightKm.",
    );
    expect(validateNewWorldBody({ id: "x", widthKm: 6, heightKm: 6 })).toBeNull();
    expect(validateNewWorldBody({ id: "../x", widthKm: 6, heightKm: 6 })).toContain("a-z, 0-9");
  });
});

describe("planImportWorld", () => {
  it("derives height from the aspect ratio", () => {
    expect(planImportWorld({ imageW: 1000, imageH: 500, widthKm: 2 })).toEqual({
      ok: true,
      widthKm: 2,
      heightKm: 1,
      mPerPx: 2,
      warnings: [],
    });
  });
  it("explains a too-short result", () => {
    expect(planImportWorld({ imageW: 1000, imageH: 200, widthKm: 2 })).toEqual({
      ok: false,
      error:
        "This image would make a map 0.400 km tall; maps must be 0.5 to 10 km. Set Width to at least 2.500 km.",
    });
  });
  it("explains a too-tall result", () => {
    const r = planImportWorld({ imageW: 500, imageH: 2000, widthKm: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("12.000 km tall");
      expect(r.error).toContain("at most 2.500 km");
    }
  });
  it("rejects a bad width", () => {
    expect(planImportWorld({ imageW: 1000, imageH: 1000, widthKm: 12 })).toEqual({
      ok: false,
      error: "Width must be between 0.5 and 10 km (you entered 12.000).",
    });
  });
  it("lets m/px drive", () => {
    const r = planImportWorld({ imageW: 4000, imageH: 4000, mPerPx: 1 });
    expect(r).toMatchObject({ ok: true, widthKm: 4, heightKm: 4 });
  });
  it("passes on the coarse warning", () => {
    const r = planImportWorld({ imageW: 1000, imageH: 1000, mPerPx: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBe(1);
  });
});
