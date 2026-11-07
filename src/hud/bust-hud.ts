import type { BustState } from "../core/bust-meter";

/** Player-facing text for the pressure line under the bar. */
export function bustCaption(state: BustState): string {
  if (state.busted) return "BUSTED";
  if (state.escaped) return "LOST THEM";
  if (!Number.isFinite(state.nearestM)) return "";
  const m = Math.round(state.nearestM);
  if (state.boxed) return `BOXED IN · ${m} m`;
  return `${m} m`;
}

/** Bar colour from level: calm yellow, then orange, then red. */
export function bustColour(level: number): string {
  if (level < 0.4) return "#ffd447";
  if (level < 0.75) return "#ff9a2e";
  return "#ff3b30";
}

export interface BustHud {
  update(state: BustState): void;
  dispose(): void;
}

export function createBustHud(): BustHud {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;z-index:7;pointer-events:none;color:#f4fbff;font:700 14px/1.2 sans-serif";
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed;bottom:34px;left:50%;transform:translateX(-50%);width:260px;text-align:center;letter-spacing:.1em;text-shadow:0 2px 4px #000";
  const label = document.createElement("div");
  label.textContent = "BUST";
  label.style.cssText = "font-size:11px;opacity:.85;margin-bottom:3px";
  const track = document.createElement("div");
  track.style.cssText =
    "height:10px;border:1px solid rgba(255,255,255,.55);background:rgba(0,0,0,.45);overflow:hidden";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%;width:0%;background:#ffd447";
  track.appendChild(fill);
  const caption = document.createElement("div");
  caption.style.cssText = "margin-top:4px;font-size:12px;min-height:15px";
  wrap.append(label, track, caption);
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);font-size:54px;letter-spacing:.2em;text-shadow:0 3px 8px #000;visibility:hidden;text-align:center";
  const sub = document.createElement("div");
  sub.style.cssText = "font-size:16px;letter-spacing:.12em;margin-top:10px";
  const bannerText = document.createElement("div");
  banner.append(bannerText, sub);
  const tint = document.createElement("div");
  tint.style.cssText = "position:fixed;inset:0;border:0 solid rgba(255,40,40,.0)";
  root.append(tint, wrap, banner);
  document.body.appendChild(root);

  return {
    update(state: BustState): void {
      fill.style.width = `${Math.round(state.level * 100)}%`;
      fill.style.background = bustColour(state.level);
      caption.textContent = bustCaption(state);
      const alarm = !state.busted && !state.escaped && state.level > 0.6;
      tint.style.border = alarm
        ? `14px solid rgba(255,40,40,${(0.1 + 0.25 * state.level).toFixed(2)})`
        : "0 solid transparent";
      if (state.busted) {
        bannerText.textContent = "BUSTED";
        bannerText.style.color = "#ff3b30";
        sub.textContent = "press R to restart";
        banner.style.visibility = "visible";
      } else if (state.escaped) {
        bannerText.textContent = "LOST THEM";
        bannerText.style.color = "#5ee88a";
        sub.textContent = "keep moving";
        banner.style.visibility = "visible";
      } else {
        banner.style.visibility = "hidden";
      }
    },
    dispose(): void {
      root.remove();
    },
  };
}
