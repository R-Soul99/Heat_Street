export function labelled(label: string, tip: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "es-row";
  row.dataset.tip = tip;
  const l = document.createElement("span");
  l.className = "es-row-label";
  l.textContent = label;
  row.append(l, control);
  return row;
}

export function createCheckbox(o: {
  label: string;
  tip: string;
  checked: boolean;
  onChange(b: boolean): void;
  disabled?: boolean;
}): { el: HTMLElement; get(): boolean; set(b: boolean): void; setDisabled(b: boolean): void } {
  const wrap = document.createElement("label");
  wrap.className = "es-check-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = o.checked;
  input.disabled = o.disabled ?? false;
  input.dataset.tip = o.tip;
  const text = document.createElement("span");
  text.textContent = o.label;
  wrap.append(input, text);
  input.addEventListener("change", () => {
    o.onChange(input.checked);
    input.blur();
  });
  return {
    el: wrap,
    get: () => input.checked,
    set(b) {
      input.checked = b;
    },
    setDisabled(b) {
      input.disabled = b;
    },
  };
}

export function createButton(o: {
  label: string;
  tip: string;
  onClick: () => void;
  kind?: "primary" | "danger";
}): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = o.label;
  b.dataset.tip = o.tip;
  if (o.kind) b.className = o.kind;
  b.addEventListener("click", o.onClick);
  return b;
}

export function hintText(text: string): HTMLElement {
  const p = document.createElement("div");
  p.className = "es-hint";
  p.textContent = text;
  return p;
}

export function readout(text: string): { el: HTMLElement; set(text: string): void } {
  const el = document.createElement("span");
  el.className = "es-readout";
  el.textContent = text;
  return {
    el,
    set(t) {
      el.textContent = t;
    },
  };
}
