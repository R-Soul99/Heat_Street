/**
 * Persisted editor preferences (shared by both editors, per browser - D-04).
 * Storage failures (private mode, quota, no localStorage) never throw; values
 * fall back to an in-memory map.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFIX = "heat-street.editor.";
const memory = new Map<string, string>();

function defaultStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // access itself can throw (sandboxed iframes)
  }
  return undefined;
}

let storage: StorageLike | undefined = defaultStorage();

/** Test hook: inject a storage (or undefined for memory-only). */
export function setPrefStorage(s: StorageLike | undefined): void {
  storage = s;
}

export function getPref(key: string, def: string): string {
  const k = PREFIX + key;
  try {
    const v = storage?.getItem(k);
    if (v !== null && v !== undefined) return v;
  } catch {
    // fall through to memory
  }
  return memory.get(k) ?? def;
}

export function setPref(key: string, value: string): void {
  const k = PREFIX + key;
  memory.set(k, value);
  try {
    storage?.setItem(k, value);
  } catch {
    // memory fallback already set
  }
}

export function getBoolPref(key: string, def: boolean): boolean {
  const v = getPref(key, def ? "1" : "0");
  if (v === "1") return true;
  if (v === "0") return false;
  return def;
}

export function setBoolPref(key: string, v: boolean): void {
  setPref(key, v ? "1" : "0");
}
