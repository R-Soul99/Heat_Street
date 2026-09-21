import type { RaceSnapshot } from "../core/race-state";

export interface RaceHud {
  update(snapshot: RaceSnapshot): void;
  flashRestart(): void;
  dispose(): void;
}

export function createRaceHud(): RaceHud {
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;z-index:7;pointer-events:none;color:#f4fbff;font:700 14px/1.2 sans-serif";
  const status = document.createElement("div");
  status.style.cssText = "position:fixed;top:78px;left:24px;letter-spacing:.08em;text-shadow:0 2px 4px #000";
  const wrongWay = document.createElement("div");
  wrongWay.textContent = "WRONG WAY";
  wrongWay.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff665c;font-size:26px;letter-spacing:.18em;visibility:hidden";
  const tint = document.createElement("div");
  tint.style.cssText = "position:fixed;inset:0;border:18px solid rgba(255,45,45,.16);visibility:hidden";
  const flash = document.createElement("div");
  flash.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;transition:opacity 60ms linear";
  root.append(status, wrongWay, tint, flash);
  document.body.appendChild(root);
  return {
    update(snapshot): void {
      status.textContent = snapshot.mode === "circuit"
        ? `LAP ${Math.min(snapshot.lap, snapshot.totalLaps)} / ${snapshot.totalLaps}   ${snapshot.currentTargetId ?? "FINISH"}`
        : `CHECKPOINT ${snapshot.visitedIds.length}   ${snapshot.currentTargetId ?? "FINISH"}`;
      const visible = snapshot.wrongWay;
      wrongWay.style.visibility = visible ? "visible" : "hidden";
      tint.style.visibility = visible ? "visible" : "hidden";
    },
    flashRestart(): void {
      flash.style.opacity = "0.78";
      setTimeout(() => { flash.style.opacity = "0"; }, 125);
    },
    dispose(): void { root.remove(); },
  };
}