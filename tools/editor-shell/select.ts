export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectHandle<T extends string> {
  el: HTMLElement;
  get(): T;
  set(v: T): void;
  setOptions(opts: SelectOption<T>[]): void;
}

export function createSelect<T extends string>(o: {
  label?: string;
  tip: string;
  options: SelectOption<T>[];
  value: T;
  onChange(v: T): void;
}): SelectHandle<T> {
  const sel = document.createElement("select");
  sel.className = "es-select";
  sel.dataset.tip = o.tip;
  const fill = (opts: SelectOption<T>[]): void => {
    sel.replaceChildren();
    for (const opt of opts) {
      const e = document.createElement("option");
      e.value = opt.value;
      e.textContent = opt.label;
      sel.append(e);
    }
  };
  fill(o.options);
  sel.value = o.value;
  sel.addEventListener("change", () => {
    o.onChange(sel.value as T);
    sel.blur();
  });

  let el: HTMLElement = sel;
  if (o.label) {
    const wrap = document.createElement("label");
    wrap.className = "es-select-row";
    const t = document.createElement("span");
    t.className = "es-row-label";
    t.textContent = o.label;
    wrap.append(t, sel);
    el = wrap;
  }
  return {
    el,
    get: () => sel.value as T,
    set(v) {
      sel.value = v;
    },
    setOptions(opts) {
      const cur = sel.value;
      fill(opts);
      sel.value = cur;
    },
  };
}
