import { describe, expect, it } from "vitest";
import { createSnapshotHistory } from "./history";

describe("snapshot history", () => {
  it("undo and redo round-trip", () => {
    const h = createSnapshotHistory<string>();
    h.push("a");
    h.push("b");
    expect(h.undo("c")).toBe("b");
    expect(h.canRedo()).toBe(true);
    expect(h.redo("b")).toBe("c");
    expect(h.undo("c")).toBe("b");
    expect(h.undo("b")).toBe("a");
    expect(h.undo("a")).toBeUndefined();
    expect(h.canUndo()).toBe(false);
  });
  it("push after undo clears redo", () => {
    const h = createSnapshotHistory<string>();
    h.push("a");
    h.undo("b");
    expect(h.canRedo()).toBe(true);
    h.push("x");
    expect(h.canRedo()).toBe(false);
    expect(h.redo("y")).toBeUndefined();
  });
  it("cap drops oldest", () => {
    const h = createSnapshotHistory<number>(3);
    for (let i = 0; i < 5; i++) h.push(i);
    expect(h.undo(99)).toBe(4);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
  });
  it("clear empties both stacks", () => {
    const h = createSnapshotHistory<number>();
    h.push(1);
    h.undo(2);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
