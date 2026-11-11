export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface Prefs {
  get(key: string, fallback: string): string;
  set(key: string, value: string): void;
  getBool(key: string, fallback: boolean): boolean;
  setBool(key: string, value: boolean): void;
}

/** Per-browser preferences. Storage errors fall back to an in-memory Map. */
export function createPrefs(store: KeyValueStore | null): Prefs {
  const memory = new Map<string, string>();
  const get = (key: string, fallback: string): string => {
    if (memory.has(key)) return memory.get(key) ?? fallback;
    try {
      const v = store?.getItem(key);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  };
  const set = (key: string, value: string): void => {
    memory.set(key, value);
    try {
      store?.setItem(key, value);
    } catch {
      // memory copy already holds the value
    }
  };
  return {
    get,
    set,
    getBool(key, fallback) {
      const v = get(key, "");
      if (v === "1") return true;
      if (v === "0") return false;
      return fallback;
    },
    setBool(key, value) {
      set(key, value ? "1" : "0");
    },
  };
}

function safeLocalStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const prefs: Prefs = createPrefs(safeLocalStorage());
