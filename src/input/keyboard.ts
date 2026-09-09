/**
 * Latched keyboard state for driving input: `ArrowLeft`/`KeyA`, `ArrowRight`/`KeyD`,
 * `ArrowUp`/`KeyW`, `ArrowDown`/`KeyS`, and `Space` for the handbrake (D-02:
 * keyboard handbrake is spacebar and is binary).
 *
 * Layering: touches `document`/`navigator`; may import `src/core/`; never writes
 * simulation state; all smoothing advances by `DT` per fixed tick, never per frame.
 */

/** One tick's raw latched key state, before any ramping is applied. */
export interface KeyState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  handbrake: boolean;
}

/** The live handle returned by `createKeyboard`. */
export interface KeyboardHandle {
  /** Snapshot of the currently latched keys. */
  read(): KeyState;
  /** Remove both listeners. */
  dispose(): void;
}

/**
 * Registers `keydown`/`keyup` listeners and latches booleans keyed on `e.code`
 * (physical key, layout-independent — correct for WASD). Nothing runs at module
 * scope: listeners are registered only when this factory is called, mirroring
 * `src/loop.ts`'s lazy-default-inside-the-factory shape so importing this module
 * never touches `document`.
 */
export function createKeyboard(): KeyboardHandle {
  const state: KeyState = {
    left: false,
    right: false,
    up: false,
    down: false,
    handbrake: false,
  };

  // Guard shaped like debug-gate.ts:32-34's `typeof location !== "undefined"`
  // check: bare Node (Vitest's `node` environment, no jsdom) has no global
  // `addEventListener`/`document`, and `LiveInputSource`'s lazy default calls
  // `createKeyboard()` unconditionally inside its constructor. Returning an
  // inert, all-neutral handle here — rather than throwing — is what lets
  // `new LiveInputSource()` with no injected deps be constructed safely
  // outside a browser (see the "importable in a bare Node environment" cases
  // in tests/live-input.test.ts).
  if (typeof document === "undefined") {
    return {
      read(): KeyState {
        return { ...state };
      },
      dispose(): void {
        /* no listeners were ever registered */
      },
    };
  }

  function setFromCode(code: string, value: boolean): void {
    switch (code) {
      case "ArrowLeft":
      case "KeyA":
        state.left = value;
        break;
      case "ArrowRight":
      case "KeyD":
        state.right = value;
        break;
      case "ArrowUp":
      case "KeyW":
        state.up = value;
        break;
      case "ArrowDown":
      case "KeyS":
        state.down = value;
        break;
      case "Space":
        state.handbrake = value;
        break;
      default:
        break;
    }
  }

  const DRIVING_CODES = new Set([
    "ArrowLeft",
    "KeyA",
    "ArrowRight",
    "KeyD",
    "ArrowUp",
    "KeyW",
    "ArrowDown",
    "KeyS",
    "Space",
  ]);

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) return;
    // Deviation from debug-gate.ts's `!e.repeat` guard: a held key must stay
    // latched, so repeat events are accepted (they are idempotent here anyway).
    if (DRIVING_CODES.has(e.code)) {
      // Deviation from debug-gate.ts: preventDefault on the driving keys so the
      // page does not scroll while driving.
      e.preventDefault();
    }
    setFromCode(e.code, true);
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) return;
    setFromCode(e.code, false);
  }

  addEventListener("keydown", onKeyDown);
  addEventListener("keyup", onKeyUp);

  return {
    read(): KeyState {
      return { ...state };
    },
    dispose(): void {
      removeEventListener("keydown", onKeyDown);
      removeEventListener("keyup", onKeyUp);
    },
  };
}
