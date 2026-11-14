/** Form controls for the editor shell. All text via textContent; all carry data-tip. */
import {
  applySteps,
  parseStepperInput,
  SCRUB_DEAD_ZONE_PX,
  SCRUB_PX_PER_STEP,
  type StepperSpec,
  scrubSteps,
  stepValue,
  wheelDir,
} from "./stepper.ts";

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
  const boxTip = `${o.tip} (drag, scroll or use arrows; Shift = coarse)`;
  const tipLong = `Range ${o.spec.min} to ${o.spec.max}${o.unit ? ` ${o.unit}` : ""}. Drag sideways or scroll over the box to change it; Shift = coarse steps. Click to type a value.`;
  const root = el("div", "value-box", undefined, boxTip);
  root.dataset.tipLong = tipLong;
  const input = el("input", "vb-input", undefined, boxTip);
  input.dataset.tipLong = tipLong;
  input.type = "text";
  input.inputMode = "decimal";
  input.setAttribute("aria-label", o.tip);
  const up = el("button", "vb-arrow vb-up", "\u25b2", `${o.tip} (increase; Shift = coarse)`);
  const down = el("button", "vb-arrow vb-down", "\u25bc", `${o.tip} (decrease; Shift = coarse)`);
  up.type = "button";
  down.type = "button";
  up.setAttribute("aria-label", "Increase");
  down.setAttribute("aria-label", "Decrease");
  const arrows = el("div", "vb-arrows");
  arrows.append(up, down);
  let value = o.value;
  const show = (): void => {
    input.value = value.toFixed(o.spec.decimals);
    input.size = Math.min(10, Math.max(4, input.value.length));
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
  root.appendChild(input);
  if (o.unit) root.appendChild(el("span", "unit", o.unit));
  root.appendChild(arrows);

  const hold = (btn: HTMLButtonElement, dir: 1 | -1): void => {
    let delay: number | undefined;
    let rep: number | undefined;
    const stop = (): void => {
      if (delay !== undefined) window.clearTimeout(delay);
      if (rep !== undefined) window.clearInterval(rep);
      delay = rep = undefined;
    };
    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const shift = e.shiftKey;
      apply(stepValue(value, dir, o.spec, shift), true);
      delay = window.setTimeout(() => {
        rep = window.setInterval(() => apply(stepValue(value, dir, o.spec, shift), true), 80);
      }, 400);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
  };
  hold(up, 1);
  hold(down, -1);

  // Drag-scrub: sideways drag steps the value; a press without movement focuses for typing.
  let drag: {
    pointerId: number;
    startX: number;
    lastX: number;
    carry: number;
    moved: boolean;
  } | null = null;
  const canScrubFrom = (e: MouseEvent): boolean =>
    e.button === 0 &&
    !(e.target as Element | null)?.closest?.(".vb-arrows") &&
    document.activeElement !== input;
  const endDrag = (): void => {
    if (!drag) return;
    const d = drag;
    drag = null;
    root.classList.remove("scrubbing");
    if (root.hasPointerCapture?.(d.pointerId)) root.releasePointerCapture(d.pointerId);
    if (d.moved) input.blur();
  };
  root.addEventListener("mousedown", (e) => {
    if (canScrubFrom(e)) e.preventDefault();
  });
  root.addEventListener("pointerdown", (e) => {
    if (!canScrubFrom(e)) return;
    e.preventDefault();
    drag = { pointerId: e.pointerId, startX: e.clientX, lastX: e.clientX, carry: 0, moved: false };
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < SCRUB_DEAD_ZONE_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      root.classList.add("scrubbing");
    }
    const r = scrubSteps(e.clientX - drag.lastX, drag.carry, SCRUB_PX_PER_STEP);
    drag.lastX = e.clientX;
    drag.carry = r.carry;
    if (r.steps !== 0) apply(applySteps(value, r.steps, o.spec, e.shiftKey), true);
  });
  root.addEventListener("pointerup", () => {
    if (drag && !drag.moved) {
      input.focus();
      input.select();
    }
    endDrag();
  });
  root.addEventListener("pointercancel", endDrag);
  root.addEventListener("lostpointercapture", endDrag);

  root.addEventListener(
    "wheel",
    (e) => {
      const d = wheelDir(e.deltaY, e.deltaX);
      if (d === 0) return;
      e.preventDefault();
      apply(stepValue(value, d, o.spec, e.shiftKey), true);
    },
    { passive: false },
  );

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
