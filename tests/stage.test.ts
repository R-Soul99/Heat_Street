import { describe, expect, it } from "vitest";
import {
  classifyStageMedal,
  draftFromStage,
  parseStageData,
  serializeStageData,
  stageFromDraft,
} from "../src/core/stage";

const EXTENT = { minX: -500, minZ: -500, maxX: 500, maxZ: 500 };

function gate(id: string, x = 0, z = 0): Record<string, unknown> {
  return { id, x, z, headingRad: 0.5, widthM: 20 };
}

function stage(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Stage ${id}`,
    start: { x: 0, z: 0, headingRad: 1 },
    gates: [gate("g1", 10, 10), gate("g2", 20, 20)],
    finish: { x: 30, z: 30, headingRad: 0.2, widthM: 25 },
    ...extra,
  };
}

function source(
  stages: unknown[] = [
    stage("a"),
    stage("b", { medals: { goldSec: 60, silverSec: 70, bronzeSec: 80, vehicle: "rwd" } }),
  ],
): Record<string, unknown> {
  return { schemaVersion: 1, areaId: "demo-hills", stages };
}

function parse(obj: unknown) {
  return parseStageData(typeof obj === "string" ? obj : JSON.stringify(obj), "t", EXTENT);
}

function mutate(fn: (s: Record<string, any>) => void): Record<string, unknown> {
  const s = source() as Record<string, any>;
  fn(s);
  return s;
}

describe("parseStageData accepts", () => {
  it("a valid file with two stages", () => {
    const data = parse(source());
    expect(data.areaId).toBe("demo-hills");
    expect(data.stages).toHaveLength(2);
    expect(data.stages[0]?.gates[1]?.x).toBe(20);
    expect(data.stages[0]?.medals).toBeUndefined();
    expect(data.stages[1]?.medals).toEqual({
      goldSec: 60,
      silverSec: 70,
      bronzeSec: 80,
      vehicle: "rwd",
    });
  });
  it("zero stages", () => {
    expect(parse(source([])).stages).toHaveLength(0);
  });
  it.each([8, 60])("width %d", (w) => {
    const s = mutate((o) => {
      o.stages[0].gates[0].widthM = w;
    });
    expect(parse(s).stages[0]?.gates[0]?.widthM).toBe(w);
  });
  it.each([1, 40])("%d gates", (n) => {
    const s = mutate((o) => {
      o.stages[0].gates = Array.from({ length: n }, (_, i) => gate(`g${i}`));
    });
    expect(parse(s).stages[0]?.gates).toHaveLength(n);
  });
  it("inclusive extent bounds", () => {
    const s = mutate((o) => {
      o.stages[0].start.x = -500;
      o.stages[0].finish.z = 500;
    });
    expect(parse(s).stages[0]?.start.x).toBe(-500);
  });
  it("same gate id in two stages", () => {
    const s = mutate((o) => {
      o.stages[1].gates[0].id = "g1";
    });
    expect(parse(s).stages).toHaveLength(2);
  });
  it("ignores unknown keys and __proto__", () => {
    const text = JSON.stringify(source()).replace(
      '"id":"g1"',
      '"id":"g1","extra":5,"__proto__":{"polluted":true}',
    );
    const data = parse(text);
    expect(Object.hasOwn(data.stages[0]!.gates[0]!, "extra")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      (data.stages[0]!.gates[0] as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();
    expect(serializeStageData(data)).not.toContain("extra");
  });
});

describe("parseStageData rejects", () => {
  const cases: [string, () => unknown][] = [
    [
      "schemaVersion 2",
      () =>
        mutate((o) => {
          o.schemaVersion = 2;
        }),
    ],
    ["non-JSON", () => "{nope"],
    ["array root", () => "[]"],
    [
      "missing areaId",
      () =>
        mutate((o) => {
          delete o.areaId;
        }),
    ],
    [
      "bad areaId",
      () =>
        mutate((o) => {
          o.areaId = "Bad Id";
        }),
    ],
    ["21 stages", () => source(Array.from({ length: 21 }, (_, i) => stage(`s${i}`)))],
    [
      "bad stage id",
      () =>
        mutate((o) => {
          o.stages[0].id = "Bad_Id";
        }),
    ],
    [
      "empty gate id",
      () =>
        mutate((o) => {
          o.stages[0].gates[0].id = "";
        }),
    ],
    [
      "duplicate stage ids",
      () =>
        mutate((o) => {
          o.stages[1].id = "a";
        }),
    ],
    [
      "duplicate gate ids",
      () =>
        mutate((o) => {
          o.stages[0].gates[1].id = "g1";
        }),
    ],
    [
      "empty name",
      () =>
        mutate((o) => {
          o.stages[0].name = "";
        }),
    ],
    [
      "whitespace name",
      () =>
        mutate((o) => {
          o.stages[0].name = "   ";
        }),
    ],
    [
      "61-char name",
      () =>
        mutate((o) => {
          o.stages[0].name = "x".repeat(61);
        }),
    ],
    [
      "string x",
      () =>
        mutate((o) => {
          o.stages[0].start.x = "1";
        }),
    ],
    [
      "NaN heading (null)",
      () =>
        mutate((o) => {
          o.stages[0].gates[0].headingRad = null;
        }),
    ],
    [
      "string z",
      () =>
        mutate((o) => {
          o.stages[0].gates[0].z = "1";
        }),
    ],
    [
      "string width",
      () =>
        mutate((o) => {
          o.stages[0].finish.widthM = "20";
        }),
    ],
    [
      "start outside extent",
      () =>
        mutate((o) => {
          o.stages[0].start.x = 500.1;
        }),
    ],
    [
      "gate outside extent",
      () =>
        mutate((o) => {
          o.stages[0].gates[0].z = -501;
        }),
    ],
    [
      "finish outside extent",
      () =>
        mutate((o) => {
          o.stages[0].finish.x = 600;
        }),
    ],
    [
      "width 7.9",
      () =>
        mutate((o) => {
          o.stages[0].gates[0].widthM = 7.9;
        }),
    ],
    [
      "width 60.1",
      () =>
        mutate((o) => {
          o.stages[0].finish.widthM = 60.1;
        }),
    ],
    [
      "0 gates",
      () =>
        mutate((o) => {
          o.stages[0].gates = [];
        }),
    ],
    [
      "41 gates",
      () =>
        mutate((o) => {
          o.stages[0].gates = Array.from({ length: 41 }, (_, i) => gate(`g${i}`));
        }),
    ],
    [
      "gold >= silver",
      () =>
        mutate((o) => {
          o.stages[1].medals.goldSec = 70;
        }),
    ],
    [
      "silver >= bronze",
      () =>
        mutate((o) => {
          o.stages[1].medals.silverSec = 80;
        }),
    ],
    [
      "medal <= 0",
      () =>
        mutate((o) => {
          o.stages[1].medals.goldSec = 0;
        }),
    ],
    [
      "medal vehicle tank",
      () =>
        mutate((o) => {
          o.stages[1].medals.vehicle = "tank";
        }),
    ],
    [
      "missing finish",
      () =>
        mutate((o) => {
          delete o.stages[0].finish;
        }),
    ],
  ];
  it.each(cases)("%s", (_name, build) => {
    expect(() => parse(build())).toThrow(/^parseStageData: t: /);
  });
  it("huge coordinate with a huge extent", () => {
    const s = mutate((o) => {
      o.stages[0].start.x = 200000;
    });
    expect(() =>
      parseStageData(JSON.stringify(s), "t", { minX: -1e9, minZ: -1e9, maxX: 1e9, maxZ: 1e9 }),
    ).toThrow(/^parseStageData: t: /);
  });
});

describe("serializeStageData", () => {
  it("round trips and never writes y", () => {
    const data = parse(source());
    const text = serializeStageData(data);
    expect(text).not.toContain('"y"');
    expect(text.endsWith("\n")).toBe(true);
    expect(parse(text)).toEqual(data);
  });
});

describe("classifyStageMedal", () => {
  const medals = { goldSec: 60, silverSec: 70, bronzeSec: 80, vehicle: "rwd" } as const;
  it("none without medals", () => {
    expect(classifyStageMedal(10, undefined)).toBe("none");
  });
  it.each([
    [59.9, "gold"],
    [60, "gold"],
    [65, "silver"],
    [80, "bronze"],
    [80.01, "none"],
    [Number.NaN, "none"],
    [Number.POSITIVE_INFINITY, "none"],
    [0, "none"],
  ])("%s -> %s", (t, expected) => {
    expect(classifyStageMedal(t, medals)).toBe(expected);
  });
});

describe("drafts", () => {
  it("returns null for incomplete drafts", () => {
    const st = parse(source()).stages[0]!;
    expect(stageFromDraft({ ...draftFromStage(st), finish: null })).toBeNull();
    expect(stageFromDraft({ ...draftFromStage(st), gates: [] })).toBeNull();
  });
  it("round trips a stage", () => {
    const st = parse(source()).stages[1]!;
    expect(stageFromDraft(draftFromStage(st))).toEqual(st);
  });
});
