export interface SnapshotHistory<T> {
  /** Push the PRE-mutation state; clears redo. */
  record(current: T): void;
  undo(current: T): T | undefined;
  redo(current: T): T | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createSnapshotHistory<T>(cap = 100): SnapshotHistory<T> {
  let undoStack: T[] = [];
  let redoStack: T[] = [];
  return {
    record(current) {
      undoStack.push(current);
      if (undoStack.length > cap) undoStack.shift();
      redoStack = [];
    },
    undo(current) {
      const prev = undoStack.pop();
      if (prev === undefined) return undefined;
      redoStack.push(current);
      return prev;
    },
    redo(current) {
      const next = redoStack.pop();
      if (next === undefined) return undefined;
      undoStack.push(current);
      return next;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack = [];
      redoStack = [];
    },
  };
}
