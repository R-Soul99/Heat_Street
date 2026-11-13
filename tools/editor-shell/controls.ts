/** Form controls for the editor shell. All text via textContent; all carry data-tip. */
import { parseStepperInput, type StepperSpec, stepValue } from "./stepper.ts";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
  tip?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (tip !== undefined) e.dataset.tip = tip;
  return e;
}

export function createButton(o: {
  label: string;
  tip: string;
  onClick: () => void;
  kind?: "primary" | "danger";
}): HTMLButtonElement {
  const b = el("button", o.kind ? `btn ${o.kind}` : "btn", o.label, o.tip);
  b.type = "button";
  b.addEventListener("click", () => o.onClick());
  return b;
}

export function createStepper(o: {
  value: number;
  spec: StepperSpec;
  tip: string;
  unit?: string;
  onChange: (v: number) => void;
}): { el: HTMLElement; get(): number; set(v: number): void } {
  const root = el("div", "stepper");
  const minus = el("button", "step-btn", "\u2212", `${o.tip} (decrease; Shift = coarse)`);
  const plus = el("button", "step-btn", "+", `${o.tip} (increase; Shift = coarse)`);
  minus.type = "button";
  plus.type = "button";
  const input = el("input", "step-input", undefined, o.tip);
  input.type = "text";
  input.inputMode = "decimal";
  let value = o.value;
  const show = (): void => {
    input.value = value.toFixed(o.spec.decimals);
  };
  const apply = (v: number, notify: boolean): void => {
    const changed = v !== value;
    value = v;
    show();
    if (changed && notify) {
      o.onChange(v);
      // Let a containing dialog hear user edits (clears its inline error).
      root.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  show();
  root.append(minus, input);
  if (o.unit) root.appendChild(el("span", "unit", o.unit));
  root.appendChild(plus);

  const hold = (btn: HTMLButtonElement, dir: 1 | -1): void => {
    let delay: number | undefined;
    let rep: number | undefined;
    const stop = (): void => {
      if (delay !== undefined) window.clearTimeout(delay);
      if (rep !== undefined) window.clearInterval(rep);
      delay = rep = undefined;
    };
    btn.addEventListener("pointerdown", (e) => {
      const shift = e.shiftKey;
      apply(stepValue(value, dir, o.spec, shift), true);
      delay = window.setTimeout(() => {
        rep = window.setInterval(() => apply(stepValue(value, dir, o.spec, shift), true), 80);
      }, 400);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
  };
  hold(minus, -1);
  hold(plus, 1);

  const commit = (): void => {
    const p = parseStepperInput(input.value, o.spec);
    if (p === undefined) show();
    else apply(p, true);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      apply(stepValue(value, e.key === "ArrowUp" ? 1 : -1, o.spec, e.shiftKey), true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  });
  input.addEventListener("blur", commit);
  return {
    el: root,
    get: () => value,
    set: (v) => apply(v, false),
  };
}

export function createSelect<T extends string>(o: {
  options: { value: T; label: string }[];
  value: T;
  tip: string;
  onChange: (v: T) => void;
}): { el: HTMLSelectElement; get(): T; set(v: T): void } {
  const s = el("select", undefined, undefined, o.tip);
  for (const opt of o.options) {
    const e = el("option", undefined, opt.label);
    e.value = opt.value;
    s.appendChild(e);
  }
  s.value = o.value;
  s.addEventListener("change", () => {
    o.onChange(s.value as T);
    s.blur(); // so letter hotkeys work again
  });
  return { el: s, get: () => s.value as T, set: (v) => (s.value = v) };
}

export function createToggle(o: {
  label: string;
  checked: boolean;
  tip: string;
  onChange: (v: boolean) => void;
}): { el: HTMLLabelElement; get(): boolean; set(v: boolean): void } {
  const label = el("label", "toggle", undefined, o.tip);
  const cb = el("input", undefined, undefined, o.tip);
  cb.type = "checkbox";
  cb.checked = o.checked;
  cb.addEventListener("change", () => {
    o.onChange(cb.checked);
    cb.blur();
  });
  label.append(cb, el("span", undefined, o.label));
  return { el: label, get: () => cb.checked, set: (v) => (cb.checked = v) };
}

export function createField(label: string, control: HTMLElement, tip?: string): HTMLElement {
  const f = el("div", "field", undefined, tip);
  f.append(el("div", "field-label", label), control);
  return f;
}

export function createSection(
  title: string,
  tip: string,
  open: boolean,
  children: HTMLElement[],
): HTMLDetailsElement {
  const d = el("details", "section");
  d.open = open;
  d.append(el("summary", undefined, title, tip), ...children);
  return d;
}
