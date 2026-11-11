import { prefs } from "./prefs";

export interface TooltipControl {
  enabled(): boolean;
  setEnabled(on: boolean): void;
  toggle(): void;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 6;
const MARGIN = 4;
const PREF_KEY = "editor-shell.tooltips";
const SHOW_DELAY_MS = 400;

/** Below the anchor, flipped above if it would overflow, clamped inside the viewport. */
export function tipPosition(
  anchor: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  let top = anchor.bottom + GAP;
  if (top + tip.height > viewport.height - MARGIN) top = anchor.top - GAP - tip.height;
  top = Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - tip.height));
  let left = Math.min(anchor.left, viewport.width - MARGIN - tip.width);
  left = Math.max(MARGIN, left);
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

export function installTooltips(root: HTMLElement, store = prefs): TooltipControl {
  let on = store.getBool(PREF_KEY, true);
  const tip = document.createElement("div");
  tip.className = "es-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: HTMLElement | null = null;

  const hide = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    current = null;
    tip.hidden = true;
  };
  const show = (el: HTMLElement): void => {
    const text = el.dataset.tip;
    if (!on || !text || !el.isConnected) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const p = tipPosition(
      r,
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    tip.style.left = `${p.left}px`;
    tip.style.top = `${p.top}px`;
  };
  const arm = (e: Event): void => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
    if (!el || el === current) return;
    hide();
    if (!on) return;
    current = el;
    timer = setTimeout(() => show(el), SHOW_DELAY_MS);
  };
  const leave = (e: Event): void => {
    const el = (e.target as Element | null)?.closest?.("[data-tip]");
    if (el && el === current) hide();
  };

  // Delegation on body (not root) so dialog controls get tips too.
  void root;
  document.body.addEventListener("pointerover", arm);
  document.body.addEventListener("focusin", arm);
  document.body.addEventListener("pointerout", leave);
  document.body.addEventListener("focusout", leave);
  document.body.addEventListener("pointerdown", hide, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  const control: TooltipControl = {
    enabled: () => on,
    setEnabled(v) {
      on = v;
      store.setBool(PREF_KEY, v);
      if (!v) hide();
    },
    toggle() {
      control.setEnabled(!on);
    },
  };
  return control;
}

/** Controls lacking data-tip. Warns once; returns the list of descriptions. */
export function reportMissingTips(root: ParentNode): string[] {
  const missing: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("button, input, select, [role=menuitem]")) {
    if (el.dataset.tip || el.dataset.tipSkip !== undefined) continue;
    const text = el.textContent?.trim() || el.getAttribute("aria-label") || "";
    missing.push(`${el.tagName.toLowerCase()}${text ? ` "${text}"` : ""}`);
  }
  if (missing.length > 0) console.warn("Controls missing data-tip:", missing);
  return missing;
}
