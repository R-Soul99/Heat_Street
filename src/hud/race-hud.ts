import type { MedalTimingSnapshot } from "../core/medal-timing";
import type { RaceSnapshot } from "../core/race-state";

export interface RaceHud {
  update(snapshot: RaceSnapshot, timing?: MedalTimingSnapshot): void;
  flashRestart(): void;
  /** Circuit Race's 3-2-1-GO countdown text (plan 07-02, D-04). `null` hides it. */
  showCountdown(label: string | null): void;
  dispose(): void;
}

export function createRaceHud(): RaceHud {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;inset:0;z-index:7;pointer-events:none;color:#f4fbff;font:700 14px/1.2 sans-serif";
  const status = document.createElement("div");
  status.style.cssText =
    "position:fixed;top:78px;left:24px;letter-spacing:.08em;text-shadow:0 2px 4px #000";
  const wrongWay = document.createElement("div");
  wrongWay.textContent = "WRONG WAY";
  wrongWay.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff665c;font-size:26px;letter-spacing:.18em;visibility:hidden";
  const tint = document.createElement("div");
  tint.style.cssText =
    "position:fixed;inset:0;border:18px solid rgba(255,45,45,.16);visibility:hidden";
  const flash = document.createElement("div");
  flash.style.cssText =
    "position:fixed;inset:0;background:#fff;opacity:0;transition:opacity 60ms linear";
  const timingPanel = document.createElement("div");
  timingPanel.style.cssText =
    "position:fixed;top:78px;right:24px;min-width:180px;text-align:right;letter-spacing:.06em;text-shadow:0 2px 4px #000";
  const timer = document.createElement("div");
  timer.style.cssText = "font-size:24px;color:#ffd447";
  const thresholds = document.createElement("div");
  thresholds.style.cssText = "margin-top:6px;font-size:11px;line-height:1.45;white-space:pre";
  const split = document.createElement("div");
  split.style.cssText = "margin-top:10px;color:#7ee8ff;font-size:12px;min-height:15px";
  timingPanel.append(timer, thresholds, split);
  // Circuit Race's 3-2-1-GO countdown (plan 07-02, D-04): centred, large,
  // hidden (not empty text) when there is nothing to show. Written with
  // `textContent` only, matching every other DOM write in this file --
  // `tests/layering.test.ts`'s repo-wide ban on the raw-HTML assignment path.
  const countdown = document.createElement("div");
  countdown.style.cssText =
    "position:fixed;top:34%;left:50%;transform:translateX(-50%);font-size:72px;font-weight:700;color:#ffd447;text-shadow:0 3px 8px #000;visibility:hidden";
  root.append(status, timingPanel, wrongWay, tint, flash, countdown);

  function formatTime(seconds: number): string {
    const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(2).padStart(5, "0")}`;
  }

  document.body.appendChild(root);
  return {
    update(snapshot, timing): void {
      status.textContent =
        snapshot.mode === "circuit"
          ? `LAP ${Math.min(snapshot.lap, snapshot.totalLaps)} / ${snapshot.totalLaps}   ${snapshot.currentTargetId ?? "FINISH"}`
          : `CHECKPOINT ${snapshot.visitedIds.length}   ${snapshot.currentTargetId ?? "FINISH"}`;
      const visible = snapshot.wrongWay;
      wrongWay.style.visibility = visible ? "visible" : "hidden";
      tint.style.visibility = visible ? "visible" : "hidden";
      if (timing === undefined) return;
      timer.textContent = formatTime(timing.effectiveElapsedSec);
      thresholds.textContent =
        timing.thresholds === null
          ? "THRESHOLDS UNAVAILABLE"
          : `ACE    ${formatTime(timing.thresholds.ace)}\nGOLD   ${formatTime(timing.thresholds.gold)}\nSILVER ${formatTime(timing.thresholds.silver)}\nBRONZE ${formatTime(timing.thresholds.bronze)}`;
      const last = timing.sectors.at(-1);
      split.textContent =
        last === undefined || last.deltaSec === null
          ? ""
          : `${last.comparisonSource === "personal-best" ? "BEST" : last.comparisonSource === "target-medal" ? "TARGET" : "REFERENCE"} ${last.deltaSec >= 0 ? "+" : ""}${last.deltaSec.toFixed(2)}s`;
    },
    flashRestart(): void {
      flash.style.opacity = "0.78";
      setTimeout(() => {
        flash.style.opacity = "0";
      }, 125);
    },
    showCountdown(label: string | null): void {
      countdown.textContent = label ?? "";
      countdown.style.visibility = label === null ? "hidden" : "visible";
    },
    dispose(): void {
      root.remove();
    },
  };
}
