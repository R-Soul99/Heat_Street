export interface StepOptions {
  step: number;
  /** Multiplier applied to step while Shift is held. */
  coarse: number;
  min: number;
  max: number;
  decimals: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Step then clamp, then round to display decimals (no float noise). */
export function stepValue(v: number, dir: 1 | -1, o: StepOptions, coarse: boolean): number {
  const delta = o.step * (coarse ? o.coarse : 1) * dir;
  const clamped = clamp(v + delta, o.min, o.max);
  const f = 10 ** o.decimals;
  return Math.round(clamped * f) / f;
}

/** Parse typed text. Null when empty or not a finite number; full precision kept. */
export function parseNumberInput(text: string, o: Pick<StepOptions, "min" | "max">): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return clamp(n, o.min, o.max);
}

export interface StepperOptions extends StepOptions {
  label: string;
  tip: string;
  value: number;
  unit?: string;
  slider?: "none" | "open" | "collapsed";
  onChange(v: number): void;
}

export interface StepperHandle {
  el: HTMLElement;
  get(): number;
  set(v: number, notify?: boolean): void;
  focus(): void;
  setDisabled(d: boolean): void;
}

export function createStepper(o: StepperOptions): StepperHandle {
  let raw = o.value;
  const el = document.createElement("div");
  el.className = "es-stepper";
  el.dataset.tip = o.tip;

  if (o.label) {
    const l = document.createElement("span");
    l.className = "es-stepper-label";
    l.textContent = o.label;
    el.append(l);
  }
  const mkBtn = (cls: string, text: string, tip: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.dataset.tip = tip;
    return b;
  };
  const down = mkBtn("es-step-down", "−", `Decrease ${o.label || "value"}`);
  const up = mkBtn("es-step-up", "+", `Increase ${o.label || "value"}`);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.dataset.tip = `${o.tip} Up/Down arrows step, Shift for bigger steps.`;
  el.append(down, input, up);
  if (o.unit) {
    const u = document.createElement("span");
    u.className = "es-stepper-unit";
    u.textContent = o.unit;
    el.append(u);
  }

  let range: HTMLInputElement | null = null;
  if (o.slider && o.slider !== "none") {
    const d = document.createElement("details");
    d.className = "es-slider";
    d.open = o.slider === "open";
    const s = document.createElement("summary");
    s.textContent = "slider";
    s.dataset.tip = "Show or hide a slider for this value.";
    range = document.createElement("input");
    range.type = "range";
    range.min = String(o.min);
    range.max = String(o.max);
    range.step = String(o.step);
    range.dataset.tip = o.tip;
    d.append(s, range);
    el.append(d);
  }

  const show = (): void => {
    input.value = raw.toFixed(o.decimals);
    if (range) range.value = String(raw);
  };
  const commit = (v: number, notify: boolean): void => {
    const changed = v !== raw;
    raw = v;
    show();
    if (changed && notify) o.onChange(v);
  };
  const flagInvalid = (): void => {
    input.classList.add("invalid");
    setTimeout(() => input.classList.remove("invalid"), 600);
  };
  const stepBy = (dir: 1 | -1, coarse: boolean): void =>
    commit(stepValue(raw, dir, o, coarse), true);
  const commitText = (): void => {
    const n = parseNumberInput(input.value, o);
    if (n === null) {
      flagInvalid();
      show();
      return;
    }
    commit(n, true);
  };

  down.addEventListener("click", (e) => stepBy(-1, e.shiftKey));
  up.addEventListener("click", (e) => stepBy(1, e.shiftKey));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      stepBy(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitText();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      show();
    }
  });
  input.addEventListener("blur", () => {
    if (input.value !== raw.toFixed(o.decimals)) commitText();
  });
  range?.addEventListener("input", () => {
    const n = parseNumberInput(range?.value ?? "", o);
    if (n !== null) commit(n, true);
  });

  show();
  return {
    el,
    get: () => raw,
    set(v, notify = false) {
      commit(Math.min(o.max, Math.max(o.min, v)), notify);
    },
    focus: () => input.focus(),
    setDisabled(d) {
      down.disabled = d;
      up.disabled = d;
      input.disabled = d;
      if (range) range.disabled = d;
    },
  };
}
