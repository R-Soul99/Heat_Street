import { describe, expect, it } from "vitest";
import {
  emptyMedalProgress,
  knownProgressCourseIds,
  loadMedalProgress,
  MAX_RACE_FIELD_SIZE,
  MEDAL_PROGRESS_KEY,
  MEDAL_PROGRESS_KIND,
  MEDAL_PROGRESS_VERSION,
  type MedalProgress,
  type MedalStorage,
  mergeMedalResult,
  mergeRaceResult,
  parseMedalProgress,
  raceVariantCourseId,
  saveMedalResult,
  saveRaceResult,
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

describe("circuit race persistence (07-07, D-05/D-06)", () => {
  const RACE_ID = "juliette-three-lap-loop.race";
  const routeCourses = [
    { id: "juliette-backroads", mode: "p2p" },
    { id: "juliette-three-lap-loop", mode: "circuit" },
  ] as const;

  function raceBlob(record: Record<string, unknown>): string {
    return JSON.stringify({
      kind: MEDAL_PROGRESS_KIND,
      version: MEDAL_PROGRESS_VERSION,
      courses: {
        [RACE_ID]: { courseId: RACE_ID, bestTimeSec: 480, medal: "none", ...record },
        "juliette-backroads": {
          courseId: "juliette-backroads",
          bestTimeSec: 170,
          medal: "gold",
        },
      },
    });
  }

  it("keeps the storage key and version unchanged", () => {
    expect(MEDAL_PROGRESS_KEY).toBe("heat-street.medals.v1");
    expect(MEDAL_PROGRESS_VERSION).toBe(1);
    expect(MAX_RACE_FIELD_SIZE).toBe(4);
  });

  it("derives the race variant id and lists every known progress id", () => {
    expect(raceVariantCourseId("juliette-three-lap-loop")).toBe(RACE_ID);
    expect(knownProgressCourseIds(routeCourses)).toEqual([
      "juliette-backroads",
      "juliette-three-lap-loop",
      RACE_ID,
    ]);
  });

  it("parses a pre-Phase-7 record without bestFinish and round-trips bestFinish", () => {
    const known = knownProgressCourseIds(routeCourses);
    const legacy = parseMedalProgress(raceBlob({}), known);
    expect(legacy.courses[RACE_ID]).toEqual({ courseId: RACE_ID, bestTimeSec: 480, medal: "none" });
    expect(Object.hasOwn(legacy.courses[RACE_ID], "bestFinish")).toBe(false);

    const withFinish = parseMedalProgress(raceBlob({ bestFinish: 2 }), known);
    expect(withFinish.courses[RACE_ID]?.bestFinish).toBe(2);
    expect(parseMedalProgress(serializeMedalProgress(withFinish), known)).toEqual(withFinish);
  });

  it.each([0, 5, 2.5, "1", null, "NaN"])("drops a record whose bestFinish is %s", (value) => {
    const known = knownProgressCourseIds(routeCourses);
    const bestFinish = value === "NaN" ? Number.NaN : value;
    const parsed = parseMedalProgress(raceBlob({ bestFinish }), known);
    expect(parsed.courses[RACE_ID]).toBeUndefined();
    expect(parsed.courses["juliette-backroads"]).toEqual({
      courseId: "juliette-backroads",
      bestTimeSec: 170,
      medal: "gold",
    });
  });

  it("creates, then improves time and finish independently", () => {
    const first = mergeRaceResult(emptyMedalProgress(), RACE_ID, {
      complete: true,
      effectiveTimeSec: 490,
      finishPosition: 3,
    });
    expect(first.courses[RACE_ID]).toEqual({
      courseId: RACE_ID,
      bestTimeSec: 490,
      medal: "none",
      bestFinish: 3,
    });

    const fasterWorse = mergeRaceResult(first, RACE_ID, {
      complete: true,
      effectiveTimeSec: 480,
      finishPosition: 4,
    });
    expect(fasterWorse.courses[RACE_ID]).toMatchObject({ bestTimeSec: 480, bestFinish: 3 });

    const betterSlower = mergeRaceResult(fasterWorse, RACE_ID, {
      complete: true,
      effectiveTimeSec: 500,
      finishPosition: 1,
    });
    expect(betterSlower.courses[RACE_ID]).toMatchObject({ bestTimeSec: 480, bestFinish: 1 });

    const neither = mergeRaceResult(betterSlower, RACE_ID, {
      complete: true,
      effectiveTimeSec: 600,
      finishPosition: 2,
    });
    expect(neither).toBe(betterSlower);
  });

  it.each([
    { complete: false, effectiveTimeSec: 480, finishPosition: 1 },
    { complete: true, effectiveTimeSec: 0, finishPosition: 1 },
    { complete: true, effectiveTimeSec: Number.NaN, finishPosition: 1 },
    { complete: true, effectiveTimeSec: Number.POSITIVE_INFINITY, finishPosition: 1 },
    { complete: true, effectiveTimeSec: 480, finishPosition: 0 },
    { complete: true, effectiveTimeSec: 480, finishPosition: 5 },
    { complete: true, effectiveTimeSec: 480, finishPosition: 1.5 },
  ])("ignores an invalid race result %o", (attempt) => {
    const progress = emptyMedalProgress();
    expect(mergeRaceResult(progress, RACE_ID, attempt)).toBe(progress);
  });

  it("ignores unknown or unsafe ids", () => {
    const progress = emptyMedalProgress();
    const result = { complete: true, effectiveTimeSec: 480, finishPosition: 1 };
    expect(mergeRaceResult(progress, "__proto__", result)).toBe(progress);
    expect(mergeRaceResult(progress, "../x", result)).toBe(progress);
    expect(mergeRaceResult(progress, RACE_ID, result, ["juliette-backroads"])).toBe(progress);
  });

  it("saveRaceResult returns false when nothing improved and never throws on storage failure", () => {
    const known = knownProgressCourseIds(routeCourses);
    const storage = memoryStorage();
    const result = { complete: true, effectiveTimeSec: 480, finishPosition: 2 };
    expect(saveRaceResult(storage, RACE_ID, result, known)).toBe(true);
    expect(saveRaceResult(storage, RACE_ID, result, known)).toBe(false);
    expect(storage.writes).toHaveLength(1);

    const broken: MedalStorage = {
      get: () => null,
      set: () => {
        throw new Error("quota");
      },
    };
    expect(() => saveRaceResult(broken, RACE_ID, result, known)).not.toThrow();
    expect(saveRaceResult(broken, RACE_ID, result, known)).toBe(false);
  });

  it("solo and race saves preserve each other's records", () => {
    const known = knownProgressCourseIds(routeCourses);
    const storage = memoryStorage();
    expect(
      saveRaceResult(
        storage,
        RACE_ID,
        { complete: true, effectiveTimeSec: 482, finishPosition: 2 },
        known,
      ),
    ).toBe(true);
    expect(
      saveMedalResult(
        storage,
        "juliette-three-lap-loop",
        { complete: true, effectiveTimeSec: 470, medal: "silver" },
        known,
      ),
    ).toBe(true);
    const afterSolo = loadMedalProgress(storage, known).courses;
    expect(afterSolo[RACE_ID]).toEqual({
      courseId: RACE_ID,
      bestTimeSec: 482,
      medal: "none",
      bestFinish: 2,
    });
    expect(afterSolo["juliette-three-lap-loop"]).toMatchObject({ bestTimeSec: 470, medal: "silver" });

    expect(
      saveRaceResult(
        storage,
        RACE_ID,
        { complete: true, effectiveTimeSec: 478, finishPosition: 1 },
        known,
      ),
    ).toBe(true);
    const afterRace = loadMedalProgress(storage, known).courses;
    expect(afterRace["juliette-three-lap-loop"]).toMatchObject({ bestTimeSec: 470, medal: "silver" });
    expect(afterRace[RACE_ID]).toMatchObject({ bestTimeSec: 478, bestFinish: 1 });
  });
});
