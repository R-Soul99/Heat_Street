import { describe, expect, it } from "vitest";
import {
  emptyMedalProgress,
  loadMedalProgress,
  MEDAL_PROGRESS_KIND,
  MEDAL_PROGRESS_VERSION,
  type MedalProgress,
  type MedalStorage,
  mergeMedalResult,
  parseMedalProgress,
  saveMedalResult,
  serializeMedalProgress,
} from "../src/core/medal-persistence";

const COURSES = ["course-alpha", "course-beta"] as const;

function progressWith(
  ...records: Array<[string, number, "ace" | "gold" | "silver" | "bronze" | "none"]>
): MedalProgress {
  return records.reduce((progress, [courseId, bestTimeSec, medal]) => {
    progress.courses[courseId] = { courseId, bestTimeSec, medal };
    return progress;
  }, emptyMedalProgress());
}

function memoryStorage(initial: string | null = null): MedalStorage & { writes: string[] } {
  let value = initial;
  const writes: string[] = [];
  return {
    writes,
    get: () => value,
    set: (_key, nextValue) => {
      value = nextValue;
      writes.push(nextValue);
    },
  };
}

describe("medal progress round trip", () => {
  it("serializes and parses versioned course-keyed results", () => {
    const original = progressWith(["course-alpha", 42.5, "gold"]);

    const parsed = parseMedalProgress(serializeMedalProgress(original), COURSES);

    expect(parsed).toEqual(original);
    expect(JSON.parse(serializeMedalProgress(original))).toMatchObject({
      kind: MEDAL_PROGRESS_KIND,
      version: MEDAL_PROGRESS_VERSION,
    });
  });

  it("returns an empty safe store for null, malformed, scalar, array, kind, or version input", () => {
    const invalid = [
      null,
      "not json",
      "[]",
      "7",
      JSON.stringify({ kind: "other", version: MEDAL_PROGRESS_VERSION, courses: {} }),
      JSON.stringify({ kind: MEDAL_PROGRESS_KIND, version: 99, courses: {} }),
    ];

    for (const raw of invalid) {
      expect(() => parseMedalProgress(raw, COURSES)).not.toThrow();
      expect(parseMedalProgress(raw, COURSES)).toEqual(emptyMedalProgress());
    }
  });
});

describe("medal progress record validation", () => {
  it("keeps valid siblings while dropping malformed, unknown, and extra-key records", () => {
    const raw = JSON.stringify({
      kind: MEDAL_PROGRESS_KIND,
      version: MEDAL_PROGRESS_VERSION,
      courses: {
        "course-alpha": {
          courseId: "course-alpha",
          bestTimeSec: 42,
          medal: "silver",
          extra: true,
        },
        "course-beta": { courseId: "course-beta", bestTimeSec: -1, medal: "gold" },
        unknown: { courseId: "unknown", bestTimeSec: 12, medal: "ace" },
      },
    });

    const result = parseMedalProgress(raw, COURSES);

    expect(result.courses).toEqual({
      "course-alpha": { courseId: "course-alpha", bestTimeSec: 42, medal: "silver" },
    });
  });

  it.each(["null", '"NaN"', '"Infinity"', '"12"', "0", "-2"])(
    "drops a record with an invalid best time: %s",
    (bestTimeSec) => {
      const raw = JSON.stringify({
        kind: MEDAL_PROGRESS_KIND,
        version: MEDAL_PROGRESS_VERSION,
        courses: {
          "course-alpha": {
            courseId: "course-alpha",
            bestTimeSec: bestTimeSec === "null" ? null : JSON.parse(bestTimeSec),
            medal: "bronze",
          },
        },
      });

      expect(parseMedalProgress(raw, COURSES).courses).toEqual({});
    },
  );

  it("drops invalid medals and does not allow prototype keys to pollute returned data", () => {
    const raw = JSON.stringify({
      kind: MEDAL_PROGRESS_KIND,
      version: MEDAL_PROGRESS_VERSION,
      courses: {
        "course-alpha": { courseId: "course-alpha", bestTimeSec: 20, medal: "platinum" },
        __proto__: { courseId: "__proto__", bestTimeSec: 1, medal: "ace" },
        constructor: { courseId: "constructor", bestTimeSec: 1, medal: "ace" },
      },
    });

    const result = parseMedalProgress(raw, COURSES);

    expect(result.courses).toEqual({});
    expect(Object.getPrototypeOf(result.courses)).toBe(Object.prototype);
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("medal progress updates", () => {
  it("updates only with a valid completed positive result", () => {
    const result = mergeMedalResult(emptyMedalProgress(), "course-alpha", {
      complete: true,
      effectiveTimeSec: 31.25,
      medal: "ace",
    });

    expect(result.courses["course-alpha"]).toEqual({
      courseId: "course-alpha",
      bestTimeSec: 31.25,
      medal: "ace",
    });
  });

  it.each([
    { complete: false, effectiveTimeSec: 20, medal: "gold" as const },
    { complete: true, effectiveTimeSec: 0, medal: "gold" as const },
    { complete: true, effectiveTimeSec: -1, medal: "gold" as const },
    { complete: true, effectiveTimeSec: Number.NaN, medal: "gold" as const },
    { complete: true, effectiveTimeSec: Number.POSITIVE_INFINITY, medal: "gold" as const },
  ])("does not persist incomplete or invalid result $effectiveTimeSec", (attempt) => {
    expect(mergeMedalResult(emptyMedalProgress(), "course-alpha", attempt)).toEqual(
      emptyMedalProgress(),
    );
  });

  it("keeps the historical medal and time when a later result is slower", () => {
    const original = progressWith(["course-alpha", 40, "silver"]);

    expect(
      mergeMedalResult(original, "course-alpha", {
        complete: true,
        effectiveTimeSec: 41,
        medal: "bronze",
      }),
    ).toEqual(original);
  });
});

describe("injected storage adapter", () => {
  it("loads safely and writes only a completed improvement", () => {
    const storage = memoryStorage(
      serializeMedalProgress(progressWith(["course-alpha", 40, "silver"])),
    );
    const loaded = loadMedalProgress(storage, COURSES);

    expect(
      saveMedalResult(
        storage,
        "course-alpha",
        { complete: true, effectiveTimeSec: 35, medal: "gold" },
        COURSES,
      ),
    ).toBe(true);
    expect(storage.writes).toHaveLength(1);
    expect(loadMedalProgress(storage, COURSES).courses["course-alpha"]).toEqual({
      courseId: "course-alpha",
      bestTimeSec: 35,
      medal: "gold",
    });
    expect(loaded.courses["course-alpha"]?.bestTimeSec).toBe(40);

    expect(
      saveMedalResult(
        storage,
        "course-alpha",
        { complete: true, effectiveTimeSec: 36, medal: "gold" },
        COURSES,
      ),
    ).toBe(false);
    expect(storage.writes).toHaveLength(1);
  });

  it("does not write incomplete or zero results", () => {
    const storage = memoryStorage();

    expect(
      saveMedalResult(
        storage,
        "course-alpha",
        { complete: false, effectiveTimeSec: 0, medal: "none" },
        COURSES,
      ),
    ).toBe(false);
    expect(storage.writes).toHaveLength(0);
  });
});
