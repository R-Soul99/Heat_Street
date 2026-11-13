import { describe, expect, it } from "vitest";
import { resumeMarker, shouldResume, terrainListed, waitUntil } from "./handoff.ts";
import { fitView } from "./world.ts";

describe("shouldResume", () => {
  it("returns the id until the expiry and undefined after", () => {
    expect(shouldResume({ id: "map-1", until: 1000 }, 999)).toBe("map-1");
    expect(shouldResume({ id: "map-1", until: 1000 }, 1000)).toBe("map-1");
    expect(shouldResume({ id: "map-1", until: 1000 }, 1001)).toBeUndefined();
  });
  it("rejects malformed markers and bad ids", () => {
    for (const bad of [
      undefined,
      null,
      "map-1",
      42,
      {},
      { id: "map-1" },
      { until: 5 },
      { id: 7, until: 5 },
      { id: "map-1", until: "5" },
      { id: "map-1", until: Number.NaN },
      { id: "../etc", until: 5 },
      { id: "Map_1", until: 5 },
      { id: "", until: 5 },
      { id: "a".repeat(65), until: 5 },
    ]) {
      expect(shouldResume(bad, 0)).toBeUndefined();
    }
  });
  it("accepts what resumeMarker produces", () => {
    expect(shouldResume(resumeMarker("map-2", 100, 50), 149)).toBe("map-2");
    expect(shouldResume(resumeMarker("map-2", 100, 50), 151)).toBeUndefined();
  });
});

describe("waitUntil", () => {
  it("resolves true as soon as the check passes, sleeping between tries", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const ok = await waitUntil(() => ++calls === 3, {
      tries: 5,
      delayMs: 10,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(ok).toBe(true);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([10, 10]);
  });
  it("resolves false after the last try", async () => {
    let calls = 0;
    const ok = await waitUntil(
      () => {
        calls++;
        return false;
      },
      { tries: 3, delayMs: 10, sleep: async () => {} },
    );
    expect(ok).toBe(false);
    expect(calls).toBe(3);
  });
  it("treats a throwing check as false for that try", async () => {
    let calls = 0;
    const ok = await waitUntil(
      () => {
        calls++;
        if (calls < 2) throw new Error("server restarting");
        return true;
      },
      { tries: 3, delayMs: 1, sleep: async () => {} },
    );
    expect(ok).toBe(true);
  });
});

describe("terrainListed", () => {
  it("matches the exact id only", () => {
    expect(terrainListed(["a", "popp-roads"], "popp-roads")).toBe(true);
    expect(terrainListed(["a", "popp-roads"], "popp")).toBe(false);
    expect(terrainListed([], "a")).toBe(false);
  });
});

describe("fitView on a 0.5 km map", () => {
  it("fills a good part of a normal canvas", () => {
    expect(fitView(500, 500, 1280, 720, 40).scale * 500).toBeGreaterThanOrEqual(300);
  });
});
