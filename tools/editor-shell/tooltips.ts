/** Single delegated tooltip element driven by data-tip (D-04). Not title= (cannot be toggled). */
import { getBoolPref, setBoolPref } from "./prefs.ts";
import { TIP_FADE_OUT_MS, tipSchedule } from "./tip-phase.ts";
import { placeTip, type Rect } from "./tip-place.ts";

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
let timers: number[] = [];
let current: HTMLElement | null = null;
/** Target whose tip already faded or was dismissed; it returns only after the pointer leaves and re-enters. */
let consumed: HTMLElement | null = null;

function clearTimers(): void {
  for (const t of timers) window.clearTimeout(t);
  timers = [];
}

function hide(): void {
  clearTimers();
  if (tipEl) {
    tipEl.classList.remove("visible", "fading");
    tipEl.style.display = "none";
  }
  current = null;
}

function fade(): void {
  if (!tipEl) return;
  tipEl.classList.add("fading");
  tipEl.classList.remove("visible");
  consumed = current;
  timers.push(
    window.setTimeout(() => {
      if (tipEl) tipEl.style.display = "none";
    }, TIP_FADE_OUT_MS),
  );
}

function show(target: HTMLElement, text: string): void {
  if (!tipEl) return;
  const el = tipEl;
  el.textContent = text;
  el.style.display = "block";
  el.classList.remove("fading");
  const r = target.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.classList.toggle("wrapped", h > 24);
  const avoid: Rect[] = [];
  for (const o of document.querySelectorAll("button, input, select, summary, [data-tip]")) {
    if (o === target || target.contains(o) || o.contains(target) || o === el) continue;
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
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  requestAnimationFrame(() => el.classList.add("visible"));
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
    if (!t || t === current || t === consumed) return;
    hide();
    current = t;
    const short = t.dataset.tip;
    if (!short) return;
    const long = t.dataset.tipLong;
    const s = tipSchedule(Boolean(long));
    timers.push(window.setTimeout(() => show(t, short), s.showAt));
    if (long && s.longAt !== undefined) {
      timers.push(window.setTimeout(() => show(t, `${short}. ${long}`), s.longAt));
    }
    timers.push(window.setTimeout(fade, s.fadeAt));
  });
  doc.addEventListener("pointerout", (e) => {
    const t = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
    if (!t) return;
    const rel = e.relatedTarget;
    if (rel instanceof Node && t.contains(rel)) return;
    if (t === current) hide();
    if (t === consumed) consumed = null;
  });
  doc.addEventListener(
    "pointerdown",
    () => {
      consumed = current ?? consumed;
      hide();
    },
    true,
  );
  doc.addEventListener(
    "keydown",
    () => {
      consumed = current ?? consumed;
      hide();
    },
    true,
  );
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
