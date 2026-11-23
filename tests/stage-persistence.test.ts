import { describe, expect, it } from "vitest";
import type { MedalStorage } from "../src/core/medal-persistence";
import {
  emptyStageBests,
  loadStageBests,
  mergeStageBest,
  parseStageBests,
  STAGE_BESTS_KEY,
  STAGE_BESTS_KIND,
  STAGE_BESTS_VERSION,
  saveStageBest,
  serializeStageBests,
  stageBestKey,
} from "../src/core/stage-persistence";

function fakeStorage(initial?: string): MedalStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STAGE_BESTS_KEY, initial);
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => {
      data.set(k, v);
    },
  };
}

const good = { bestTimeSec: 70, medal: "none" as const, splitsSec: [30, 50] };
const key = "demo-hills:dust-run:rwd";

function blob(bests: unknown, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: STAGE_BESTS_KIND,
    version: STAGE_BESTS_VERSION,
    bests,
    ...over,
  });
}

describe("stageBestKey", () => {
  it("joins area, stage and class", () => {
    expect(stageBestKey("demo-hills", "dust-run", "rwd")).toBe(key);
  });
});

describe("parseStageBests", () => {
  it("returns empty for bad input", () => {
    for (const raw of [null, "not json", "[]", blob({}, { kind: "x" }), blob({}, { version: 2 })]) {
      expect(parseStageBests(raw)).toEqual(emptyStageBests());
    }
  });

  it("drops invalid entries and keeps valid ones", () => {
    const raw = blob({
      [key]: good,
      "BAD KEY:x:rwd": good,
      "demo-hills:dust-run:hovercraft": good,
      "demo-hills:a:fwd": { ...good, bestTimeSec: 0 },
      "demo-hills:b:fwd": { ...good, bestTimeSec: Number.NaN },
      "demo-hills:c:fwd": { ...good, bestTimeSec: "5" },
      "demo-hills:d:fwd": { ...good, medal: "ace" },
      "demo-hills:e:fwd": { ...good, splitsSec: "nope" },
      "demo-hills:f:fwd": { ...good, splitsSec: [1, null] },
      "demo-hills:g:fwd": { ...good, splitsSec: new Array(42).fill(1) },
    });
    expect(Object.keys(parseStageBests(raw).bests)).toEqual([key]);
  });

  it("drops a __proto__ key", () => {
    const raw = `{"kind":"${STAGE_BESTS_KIND}","version":1,"bests":{"__proto__":${JSON.stringify(good)}}}`;
    const parsed = parseStageBests(raw);
    expect(Object.keys(parsed.bests)).toEqual([]);
    expect(Object.getPrototypeOf(parsed.bests)).toBe(Object.prototype);
  });
});

describe("mergeStageBest", () => {
  it("inserts, keeps on slower, replaces on faster", () => {
    const empty = emptyStageBests();
    const first = mergeStageBest(empty, key, good);
    expect(first.bests[key]).toEqual(good);
    expect(mergeStageBest(first, key, { ...good, bestTimeSec: 80 })).toBe(first);
    expect(mergeStageBest(first, key, { ...good, bestTimeSec: 70 })).toBe(first);
    const faster = mergeStageBest(first, key, {
      bestTimeSec: 60,
      medal: "gold",
      splitsSec: [20, 40],
    });
    expect(faster.bests[key]).toEqual({ bestTimeSec: 60, medal: "gold", splitsSec: [20, 40] });
  });

  it("rejects invalid key or result", () => {
    const empty = emptyStageBests();
    expect(mergeStageBest(empty, "nope", good)).toBe(empty);
    expect(mergeStageBest(empty, key, { ...good, bestTimeSec: -1 })).toBe(empty);
  });

  it("keeps classes independent", () => {
    const rwdKey = "demo-hills:dust-run:rwd";
    const buggyKey = "demo-hills:dust-run:buggy";
    const a = mergeStageBest(emptyStageBests(), rwdKey, { ...good, bestTimeSec: 50 });
    const b = mergeStageBest(a, buggyKey, { ...good, bestTimeSec: 90 });
    expect(b.bests[rwdKey]?.bestTimeSec).toBe(50);
    expect(b.bests[buggyKey]?.bestTimeSec).toBe(90);
  });
});

describe("save/load", () => {
  it("writes when improved, false when not", () => {
    const storage = fakeStorage();
    expect(saveStageBest(storage, key, good)).toBe(true);
    expect(saveStageBest(storage, key, { ...good, bestTimeSec: 99 })).toBe(false);
    expect(loadStageBests(storage).bests[key]).toEqual(good);
  });

  it("does not throw when set throws or get throws", () => {
    const failing: MedalStorage = {
      get: () => null,
      set: () => {
        throw new Error("quota");
      },
    };
    expect(saveStageBest(failing, key, good)).toBe(false);
    const broken: MedalStorage = {
      get: () => {
        throw new Error("denied");
      },
      set: () => {},
    };
    expect(loadStageBests(broken)).toEqual(emptyStageBests());
  });

  it("round-trips", () => {
    const bests = mergeStageBest(emptyStageBests(), key, good);
    expect(parseStageBests(serializeStageBests(bests))).toEqual(bests);
  });
});
