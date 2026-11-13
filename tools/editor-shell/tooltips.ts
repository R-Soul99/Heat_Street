/** Single delegated tooltip element driven by data-tip (D-04). Not title= (cannot be toggled). */
import type { Rect } from "./dock.ts";
import { getBoolPref, setBoolPref } from "./prefs.ts";
import { placeTip } from "./tip-place.ts";

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
  const avoid: Rect[] = [];
  for (const o of document.querySelectorAll("button, input, select, summary, [data-tip]")) {
    if (o === target || target.contains(o) || o.contains(target) || o === tipEl) continue;
    const b = o.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    avoid.push(b);
  }
  const p = placeTip(
    r,
    { width: w, height: h },
    { width: window.innerWidth, height: window.innerHeight },
    avoid,
  );
  tipEl.style.left = `${p.x}px`;
  tipEl.style.top = `${p.y}px`;
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
