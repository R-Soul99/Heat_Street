/**
 * Pure race placement (plan 07-06, D-14/D-16): progress along the racing
 * line, live standings and time-based milestone gap tracking. Presentation
 * only — the coordinator never feeds this back into `ai-driver.ts`/
 * `ai-fleet.ts` (T-07-19), so placing can never become rubber-banding.
 *
 * Pure by construction: imports only `./racing-line` and `./race-state`
 * types — no renderer, no physics engine, no DOM, no wall clock.
 * `tests/layering.test.ts` mechanically enforces this for every file under
 * `src/core/`.
 */
import type { RaceSnapshot } from "./race-state";
import type { RacingLine } from "./racing-line";

/** Metres of backtrack behind a leg's start checkpoint still counted as "on this leg" — covers a car sitting just behind the start/finish line on lap 1. */
export const LEG_BACKTRACK_M = 60;

/** Gap-tracker milestone spacing, metres (07-RESEARCH.md Pattern 7 / D-16). */
export const GAP_MILESTONE_M = 20;

interface LegPoint {
  readonly x: number;
  readonly z: number;
  /** Arc position relative to the LEG's own frame — may be negative when this point lies just before the leg's start checkpoint (wrapped from the end of the lap). */
  readonly legArc: number;
}

export interface ProgressTracker {
  /** Distance-along-the-line progress for one racer, in metres, monotonic within a lap: `(race.lap - 1) * lapLengthM + legArc`, or `race.totalLaps * lapLengthM` once `race.complete`. */
  update(race: RaceSnapshot, x: number, z: number): number;
}

/**
 * Precomputes, per target checkpoint, the bounded list of racing-line points
 * whose arc lies within that leg (`[lo, hi]`, `LEG_BACKTRACK_M` behind the
 * leg's own start checkpoint through its end checkpoint) — restricting the
 * per-tick nearest-point search to the current leg so a car geometrically
 * near another part of the loop is never mis-projected onto it.
 */
export function createProgressTracker(
  line: RacingLine,
  checkpointIds: readonly string[],
): ProgressTracker {
  const { lapLengthM, checkpointArcM, points } = line;
  const legsByCheckpointId = new Map<string, readonly LegPoint[]>();

  for (let t = 0; t < checkpointIds.length; t++) {
    const lo = (t === 0 ? 0 : checkpointArcM[t - 1]) - LEG_BACKTRACK_M;
    const hi = checkpointArcM[t];
    const legPoints: LegPoint[] = [];
    for (const point of points) {
      if (lo < 0) {
        if (point.arcM <= hi) {
          legPoints.push({ x: point.x, z: point.z, legArc: point.arcM });
        } else if (point.arcM >= lapLengthM + lo) {
          legPoints.push({ x: point.x, z: point.z, legArc: point.arcM - lapLengthM });
        }
      } else if (point.arcM >= lo && point.arcM <= hi) {
        legPoints.push({ x: point.x, z: point.z, legArc: point.arcM });
      }
    }
    legsByCheckpointId.set(checkpointIds[t], legPoints);
  }

  function update(race: RaceSnapshot, x: number, z: number): number {
    if (race.complete) return race.totalLaps * lapLengthM;
    const legPoints =
      race.currentTargetId === null ? undefined : legsByCheckpointId.get(race.currentTargetId);
    if (legPoints === undefined || legPoints.length === 0) {
      return (race.lap - 1) * lapLengthM;
    }
    let bestLegArc = legPoints[0].legArc;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const point of legPoints) {
      const d = Math.hypot(point.x - x, point.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestLegArc = point.legArc;
      }
    }
    return (race.lap - 1) * lapLengthM + bestLegArc;
  }

  return { update };
}

export interface StandingInput {
  readonly racerIndex: number;
  readonly finishEffectiveSec: number | null;
  readonly progressM: number;
}

export interface Standing {
  readonly racerIndex: number;
  readonly position: number;
  readonly finished: boolean;
}

/**
 * Finished racers rank first, ordered by `finishEffectiveSec` ascending;
 * unfinished racers follow, ordered by `progressM` descending; ties break by
 * `racerIndex` ascending. Positions are 1..N. Frozen result (array and each
 * entry).
 */
export function computeStandings(inputs: readonly StandingInput[]): readonly Standing[] {
  const sorted = [...inputs].sort((a, b) => {
    const aFinished = a.finishEffectiveSec !== null;
    const bFinished = b.finishEffectiveSec !== null;
    if (aFinished !== bFinished) return aFinished ? -1 : 1;
    if (aFinished && bFinished) {
      const delta = (a.finishEffectiveSec as number) - (b.finishEffectiveSec as number);
      if (delta !== 0) return delta;
      return a.racerIndex - b.racerIndex;
    }
    if (a.progressM !== b.progressM) return b.progressM - a.progressM;
    return a.racerIndex - b.racerIndex;
  });
  return Object.freeze(
    sorted.map((input, index) =>
      Object.freeze({
        racerIndex: input.racerIndex,
        position: index + 1,
        finished: input.finishEffectiveSec !== null,
      }),
    ),
  );
}

export interface GapTracker {
  /** Records the first-pass elapsed time for every milestone index `0..floor(progressM / stepM)` not yet stored. No-op for negative `progressM`. */
  record(racerIndex: number, progressM: number, elapsedSec: number): void;
  /** Drops every stored milestone above `floor(progressM / stepM)` for `racerIndex` — a respawn/reset clears milestones past the racer's new position so a re-pass records fresh times. */
  truncate(racerIndex: number, progressM: number): void;
  /** Clears every racer's milestones. */
  reset(): void;
  /** `t_behind(m) - t_ahead(m)` at the behind racer's own highest recorded milestone `m`, or `null` if the ahead racer has no recorded time at `m` yet (or the behind racer has no milestones at all). */
  gapSec(behindIndex: number, aheadIndex: number): number | null;
}

/** Time-based gap tracker keyed on shared `stepM`-metre progress milestones (D-16: time at shared progress points, not distance divided by speed). */
export function createGapTracker(racerCount: number, stepM = GAP_MILESTONE_M): GapTracker {
  let milestones: (number | undefined)[][] = Array.from({ length: racerCount }, () => []);

  function record(racerIndex: number, progressM: number, elapsedSec: number): void {
    if (progressM < 0) return;
    const maxMilestone = Math.floor(progressM / stepM);
    const arr = milestones[racerIndex];
    for (let m = 0; m <= maxMilestone; m++) {
      if (arr[m] === undefined) arr[m] = elapsedSec;
    }
  }

  function truncate(racerIndex: number, progressM: number): void {
    const keepUpTo = progressM < 0 ? -1 : Math.floor(progressM / stepM);
    milestones[racerIndex] = milestones[racerIndex].slice(0, keepUpTo + 1);
  }

  function reset(): void {
    milestones = Array.from({ length: racerCount }, () => []);
  }

  function gapSec(behindIndex: number, aheadIndex: number): number | null {
    const behindArr = milestones[behindIndex];
    const highestMilestone = behindArr.length - 1;
    if (highestMilestone < 0) return null;
    const tBehind = behindArr[highestMilestone];
    if (tBehind === undefined) return null;
    const tAhead = milestones[aheadIndex][highestMilestone];
    if (tAhead === undefined) return null;
    return tBehind - tAhead;
  }

  return { record, truncate, reset, gapSec };
}
