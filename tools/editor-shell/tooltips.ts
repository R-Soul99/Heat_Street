/** Single delegated tooltip element driven by data-tip (D-04). Not title= (cannot be toggled). */
import { getBoolPref, setBoolPref } from "./prefs.ts";

const DELAY_MS = 400;
let installed = false;
let enabled = getBoolPref("tooltips", true);

export function tooltipsEnabled(): boolean {
  return enabled;
}

export function setTooltipsEnabled(on: boolean): void {
  enabled = on;
  setBoolPref("tooltips", on);
  if (!on) hide();
}

let tipEl: HTMLDivElement | undefined;
let timer: number | undefined;

function hide(): void {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  if (tipEl) tipEl.style.display = "none";
}

function show(target: HTMLElement, text: string): void {
  if (!tipEl) return;
  tipEl.textContent = text;
  tipEl.style.display = "block";
  const r = target.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.bottom + 8;
  if (y + h > window.innerHeight - 4) y = r.top - h - 8;
  x = Math.max(4, Math.min(window.innerWidth - w - 4, x));
  y = Math.max(4, y);
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}

export function installTooltips(doc: Document): void {
  if (installed) return;
  installed = true;
  tipEl = doc.createElement("div");
  tipEl.id = "shell-tooltip";
  tipEl.style.display = "none";
  doc.body.appendChild(tipEl);

  doc.addEventListener("pointerover", (e) => {
    if (!enabled) return;
    const t = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
    if (!t) return;
    hide();
    const text = t.dataset.tip;
    if (!text) return;
    timer = window.setTimeout(() => show(t, text), DELAY_MS);
  });
  doc.addEventListener("pointerout", (e) => {
    const t = (e.target as Element | null)?.closest?.("[data-tip]");
    if (t) hide();
  });
  doc.addEventListener("pointerdown", hide, true);
  doc.addEventListener("keydown", hide, true);
  doc.addEventListener("scroll", hide, true);
}

/** Dev-time check: warn once per interactive element lacking data-tip. */
export function auditTips(root: ParentNode): void {
  const seen = new Set<Element>();
  for (const el of root.querySelectorAll("button, input, select, summary")) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!(el as HTMLElement).dataset.tip)
      console.warn("[editor-shell] control missing data-tip:", el);
  }
}
