/** Hold-to-repeat timer (07.1.2 D-08): one immediate tick, then repeat after a delay. */
export interface RepeatTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

export const REPEAT_DELAY_MS = 400;
export const STEPPER_REPEAT_MS = 80;
export const OP_REPEAT_MS = 120;

export function createRepeater(o: {
  delayMs: number;
  intervalMs: number;
  tick: () => void;
  timers?: RepeatTimers;
}): { start(): void; stop(): void; running(): boolean } {
  const t: RepeatTimers = o.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as never),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (id) => globalThis.clearInterval(id as never),
  };
  let delay: unknown;
  let rep: unknown;
  let on = false;
  const stop = (): void => {
    if (delay !== undefined) t.clearTimeout(delay);
    if (rep !== undefined) t.clearInterval(rep);
    delay = rep = undefined;
    on = false;
  };
  return {
    start() {
      stop();
      on = true;
      o.tick();
      delay = t.setTimeout(() => {
        delay = undefined;
        rep = t.setInterval(o.tick, o.intervalMs);
      }, o.delayMs);
    },
    stop,
    running: () => on,
  };
}
