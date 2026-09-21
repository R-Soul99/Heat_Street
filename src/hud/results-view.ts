import type { Course } from "../core/course";
import type { MedalProgressRecord } from "../core/medal-persistence";
import type { MedalReferenceCourse } from "../core/medal-reference";
import type { FrozenCompletion, Medal } from "../core/medal-timing";

export interface CourseCardModel {
  readonly courseId: string;
  readonly title: string;
  readonly modeLabel: string;
  readonly bestTimeSec: number | null;
  readonly medal: Medal | null;
  readonly thresholds: MedalReferenceCourse["thresholds"];
  readonly selected: boolean;
}

export interface ResultRowModel {
  readonly label: string;
  readonly timeSec: number;
  readonly cumulativeSec: number;
  readonly deltaSec: number | null;
  readonly slowest: boolean;
}

export function formatResultTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "UNAVAILABLE";
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

export function buildCourseCardModels(
  courses: readonly Course[],
  references: readonly MedalReferenceCourse[],
  progress: Readonly<Record<string, MedalProgressRecord>>,
  selectedCourseId: string,
): readonly CourseCardModel[] {
  return courses.flatMap((course) => {
    const reference = references.find((candidate) => candidate.courseId === course.id);
    if (reference === undefined) return [];
    const saved = progress[course.id];
    return [
      {
        courseId: course.id,
        title: course.name,
        modeLabel: course.mode === "circuit" ? "CIRCUIT" : "POINT TO POINT",
        bestTimeSec: saved?.bestTimeSec ?? null,
        medal: saved?.medal ?? null,
        thresholds: reference.thresholds,
        selected: course.id === selectedCourseId,
      },
    ];
  });
}

export function buildResultRows(completion: FrozenCompletion): readonly ResultRowModel[] {
  return completion.sectors.map((sector) => ({
    label: `L${sector.lap} ${sector.fromCheckpointId ?? "START"}->${sector.checkpointId}`,
    timeSec: sector.sectorElapsedSec,
    cumulativeSec: sector.cumulativeElapsedSec,
    deltaSec: sector.deltaSec,
    slowest: sector.ordinal === completion.slowestSectorOrdinal,
  }));
}

export interface ResultsView {
  updateCards(progress: Readonly<Record<string, MedalProgressRecord>>): void;
  showCompletion(completion: FrozenCompletion): void;
  clearCompletion(): void;
  dispose(): void;
}

function text(value: string, className?: string): HTMLDivElement {
  const element = document.createElement("div");
  element.textContent = value;
  if (className !== undefined) element.className = className;
  return element;
}

export function createResultsView(
  courses: readonly Course[],
  references: readonly MedalReferenceCourse[],
  selectedCourseId: string,
  progress: Readonly<Record<string, MedalProgressRecord>>,
): ResultsView {
  const root = document.createElement("aside");
  root.style.cssText =
    "position:fixed;top:150px;left:16px;z-index:8;width:260px;max-height:42vh;overflow:auto;padding:12px;color:#f4fbff;background:rgba(7,16,21,.86);border:1px solid rgba(126,232,255,.55);font:700 11px/1.35 monospace;letter-spacing:.04em;pointer-events:none";
  const heading = text("COURSES", "results-heading");
  heading.style.cssText = "color:#ffd447;font-size:13px;margin-bottom:8px";
  const cards = document.createElement("div");
  const completion = document.createElement("div");
  completion.style.cssText =
    "display:none;margin-top:12px;padding-top:10px;border-top:1px solid #456";
  root.append(heading, cards, completion);
  document.body.appendChild(root);

  function renderCards(nextProgress: Readonly<Record<string, MedalProgressRecord>>): void {
    cards.replaceChildren();
    for (const card of buildCourseCardModels(courses, references, nextProgress, selectedCourseId)) {
      const element = document.createElement("section");
      element.style.cssText = `padding:8px;margin-bottom:8px;border:1px solid ${card.selected ? "#ffd447" : "#456"};background:rgba(20,35,42,.72)`;
      element.append(
        text(`${card.modeLabel}  ${card.title}`, "results-card-title"),
        text(
          `BEST  ${formatResultTime(card.bestTimeSec)}  ${card.medal?.toUpperCase() ?? "UNEARNED"}`,
        ),
        text(
          `ACE ${formatResultTime(card.thresholds.ace)}  GOLD ${formatResultTime(card.thresholds.gold)}`,
        ),
        text(
          `SILVER ${formatResultTime(card.thresholds.silver)}  BRONZE ${formatResultTime(card.thresholds.bronze)}`,
        ),
      );
      cards.appendChild(element);
    }
  }

  renderCards(progress);
  return {
    updateCards(nextProgress): void {
      renderCards(nextProgress);
    },
    showCompletion(result): void {
      completion.replaceChildren(
        text(`RESULT  ${result.medal.toUpperCase()}  ${formatResultTime(result.effectiveTimeSec)}`),
      );
      const rows = document.createElement("div");
      for (const row of buildResultRows(result)) {
        const element = text(
          `${row.label}  ${formatResultTime(row.timeSec)}  ${formatResultTime(row.cumulativeSec)}  ${row.deltaSec === null ? "--" : `${row.deltaSec >= 0 ? "+" : ""}${row.deltaSec.toFixed(2)}s`}`,
        );
        element.style.cssText = row.slowest
          ? "color:#ff8b73;background:rgba(255,102,92,.16);padding:3px"
          : "padding:3px";
        rows.appendChild(element);
      }
      completion.appendChild(rows);
      completion.style.display = "block";
    },
    clearCompletion(): void {
      completion.replaceChildren();
      completion.style.display = "none";
    },
    dispose(): void {
      root.remove();
    },
  };
}
