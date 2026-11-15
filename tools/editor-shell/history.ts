/**
 * Snapshot undo/redo. Callers push the PRE-mutation snapshot; undo/redo take
 * the CURRENT state and return the state to restore (or undefined if empty).
 * Generic so editors can keep JSON strings or objects.
 */
export interface SnapshotHistory<T> {
  push(snap: T): void;
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
    push(snap) {
      undoStack.push(snap);
      if (undoStack.length > cap) undoStack.shift();
      redoStack = [];
    },
    undo(current) {
      if (undoStack.length === 0) return undefined;
      redoStack.push(current);
      return undoStack.pop();
    },
    redo(current) {
      if (redoStack.length === 0) return undefined;
      undoStack.push(current);
      return redoStack.pop();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack = [];
      redoStack = [];
    },
  };
}
