// Pure guidance and save planning for the Route tool (Phase 10). No DOM, no three.

import type { RouteDraft } from "../../src/core/route-draft.ts";
import type { StageDraft } from "../../src/core/stage.ts";

export type RouteKind = "stage" | "p2p" | "circuit";

/** Gates or checkpoints needed before the finish (p2p 2 and circuit 3 points include the finish). */
const MIN_ITEMS: Record<RouteKind, number> = { stage: 1, p2p: 1, circuit: 2 };

export function itemWord(kind: RouteKind): string {
  return kind === "stage" ? "gate" : "checkpoint";
}

export function finishWord(kind: RouteKind): string {
  return kind === "circuit" ? "lap line" : "finish";
}

/** How many more gates or checkpoints are needed before a finish can be placed. */
export function itemsStillNeeded(kind: RouteKind, count: number): number {
  return Math.max(0, MIN_ITEMS[kind] - count);
}

function missingText(
  kind: RouteKind,
  hasStart: boolean,
  count: number,
  hasFinish: boolean,
): string | null {
  const parts: string[] = [];
  if (!hasStart) parts.push("start");
  if (itemsStillNeeded(kind, count) > 0) {
    parts.push(count === 0 ? `${itemWord(kind)}s` : `second ${itemWord(kind)}`);
  }
  if (!hasFinish) parts.push(finishWord(kind));
  return parts.length === 0 ? null : `has no ${parts.join(" or ")}`;
}

/** Null when the stage is complete, else text such as "has no finish". */
export function stageMissing(s: StageDraft): string | null {
  return missingText("stage", true, s.gates.length, s.finish !== null);
}

export function routeMissing(r: RouteDraft): string | null {
  return missingText(r.mode, r.start !== null, r.checkpoints.length, r.finish !== null);
}

export interface PartialSave<T> {
  /** What goes in the file: complete items, plus the last saved version of an unfinished one. */
  write: T[];
  /** One line per unfinished item, e.g. "Stage 1 has no finish". */
  unfinished: string[];
}

/** An unfinished item never blocks the others and never removes its own saved version. */
export function planPartialSave<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  saved: readonly T[],
  missing: (item: T) => string | null,
): PartialSave<T> {
  const write: T[] = [];
  const unfinished: string[] = [];
  for (const item of items) {
    const m = missing(item);
    if (m === null) {
      write.push(item);
      continue;
    }
    unfinished.push(`${item.name} ${m}`);
    const old = saved.find((s) => s.id === item.id);
    if (old) write.push(old);
  }
  return { write, unfinished };
}

export interface PromptState {
  kind: RouteKind;
  /** The route being built or edited; null when the next drag starts a new one. */
  current: { name: string; items: number; hasFinish: boolean } | null;
  newPending: boolean;
  finishPending: boolean;
}

/** The sidebar line that says what to do next. */
export function routePrompt(p: PromptState): string {
  const thing = p.kind === "stage" ? "stage" : "route";
  const item = itemWord(p.kind);
  const fin = finishWord(p.kind);
  const c = p.current;
  if (c === null || p.newPending) {
    return `Next: drag on the map to set the start of a new ${thing}. The drag sets which way the car faces.`;
  }
  if (c.hasFinish) {
    return `${c.name} is complete. Test it, drag a marker to move it, or drag on empty ground to start a new ${thing}.`;
  }
  if (p.finishPending) return `Next: click on the map where the ${fin} goes. Esc cancels.`;
  const need = itemsStillNeeded(p.kind, c.items);
  if (c.items === 0) {
    const aim = p.kind === "stage" ? " Gates turn to follow the route." : "";
    return `Start set. Next: click on the map to add the first ${item}.${aim}`;
  }
  if (need > 0) return `Next: add ${need} more ${item}${need === 1 ? "" : "s"}.`;
  return `Next: add more ${item}s, or press Place ${fin} (or Enter at the pointer).`;
}

/** A tag's bottom centre and size, in pixels. */
export interface TagBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bottom y for each tag, moved up where tags would cover each other (earlier tags stay put). */
export function stackTags(boxes: readonly TagBox[], gap = 2): number[] {
  const placed: TagBox[] = [];
  return boxes.map((b) => {
    let y = b.y;
    for (let i = 0; i <= placed.length; i++) {
      const hit = placed.find(
        (q) => Math.abs(q.x - b.x) < (q.w + b.w) / 2 && y > q.y - q.h && y - b.h < q.y,
      );
      if (!hit) break;
      y = hit.y - hit.h - gap;
    }
    placed.push({ ...b, y });
    return y;
  });
}
