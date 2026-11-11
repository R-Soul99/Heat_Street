import { describe, expect, it } from "vitest";
import { createSnapshotHistory } from "./history";

describe("snapshot history", () => {
  it("undo and redo", () => {
    const h = createSnapshotHistory<string>();
    h.record("A");
    expect(h.canUndo()).toBe(true);
    expect(h.undo("B")).toBe("A");
    expect(h.canRedo()).toBe(true);
    expect(h.redo("A")).toBe("B");
    expect(h.canRedo()).toBe(false);
    expect(h.canUndo()).toBe(true);
  });
  it("recording clears redo", () => {
    const h = createSnapshotHistory<string>();
    h.record("A");
    h.undo("B");
    h.record("C");
    expect(h.canRedo()).toBe(false);
  });
  it("cap drops oldest", () => {
    const h = createSnapshotHistory<number>(2);
    h.record(1);
    h.record(2);
    h.record(3);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
  });
  it("empty returns undefined; clear empties", () => {
    const h = createSnapshotHistory<number>();
    expect(h.undo(1)).toBeUndefined();
    expect(h.redo(1)).toBeUndefined();
    h.record(1);
    h.clear();
    expect(h.canUndo()).toBe(false);
  });
});
