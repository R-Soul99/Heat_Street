export const MEDAL_CONTRACT_VERSION = 1;

export const MEDAL_BANDS = {
  ace: 0.9,
  gold: 1,
  silver: 1.15,
  bronze: 1.35,
} as const;

/** Movement must be observed on a fixed simulation tick before timing starts. */
export const FIRST_MOVEMENT_SPEED_MS = 0.5;
export const RESPAWN_PENALTY_SEC = 5;

export type Medal = "ace" | "gold" | "silver" | "bronze" | "none";
export type AttemptPhase = "pre-drive" | "active" | "complete";
export type ComparisonSource = "personal-best" | "target-medal" | "reference";

export interface MedalThresholds {
  readonly ace: number;
  readonly gold: number;
  readonly silver: number;
  readonly bronze: number;
}

export interface CheckpointComparison {
  readonly source: ComparisonSource;
  readonly cumulativeSec: number;
}

export interface CheckpointSplitInput {
  readonly checkpointId: string;
  readonly fromCheckpointId?: string | null;
  readonly lap?: number;
  readonly ordinal?: number;
  readonly comparison?: CheckpointComparison;
}

export interface MedalTimingConfig {
  readonly referenceTimeSec: number;
  readonly speedThresholdMs?: number;
}

export interface MedalTimingInput {
  readonly simTimeSec: number;
  readonly speedMs: number;
  readonly penaltySec?: number;
  readonly complete?: boolean;
  readonly restart?: boolean;
  readonly respawn?: boolean;
  readonly checkpoint?: CheckpointSplitInput;
}

export interface SectorSplit {
  readonly checkpointId: string;
  readonly fromCheckpointId: string | null;
  readonly ordinal: number;
  readonly lap: number;
  readonly sectorElapsedSec: number;
  readonly cumulativeElapsedSec: number;
  readonly deltaSec: number | null;
  readonly comparisonSource: ComparisonSource | null;
}

export interface FrozenCompletion {
  readonly effectiveTimeSec: number;
  readonly medal: Medal;
  readonly sectors: readonly SectorSplit[];
  readonly slowestSectorOrdinal: number | null;
}

export interface MedalTimingSnapshot {
  readonly phase: AttemptPhase;
  readonly startedAtSimSec: number | null;
  readonly baseElapsedSec: number;
  readonly penaltySec: number;
  readonly effectiveElapsedSec: number;
  readonly thresholds: MedalThresholds | null;
  readonly liveMedal: Medal;
  readonly sectors: readonly SectorSplit[];
  readonly completion: FrozenCompletion | null;
}

export interface MedalTiming {
  update(input: MedalTimingInput): MedalTimingSnapshot;
  recordCheckpoint(simTimeSec: number, checkpoint: CheckpointSplitInput): MedalTimingSnapshot;
  respawn(): MedalTimingSnapshot;
  restart(): MedalTimingSnapshot;
  complete(simTimeSec: number): MedalTimingSnapshot;
  snapshot(): MedalTimingSnapshot;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function freezeSnapshot(snapshot: MedalTimingSnapshot): MedalTimingSnapshot {
  return Object.freeze({
    ...snapshot,
    thresholds: snapshot.thresholds === null ? null : Object.freeze({ ...snapshot.thresholds }),
    sectors: Object.freeze(snapshot.sectors.map((sector) => Object.freeze({ ...sector }))),
    completion:
      snapshot.completion === null
        ? null
        : Object.freeze({
            ...snapshot.completion,
            sectors: Object.freeze(
              snapshot.completion.sectors.map((sector) => Object.freeze({ ...sector })),
            ),
          }),
  });
}

export function medalThresholds(referenceTimeSec: number): MedalThresholds | null {
  if (!isPositiveFinite(referenceTimeSec)) return null;
  return {
    ace: referenceTimeSec * MEDAL_BANDS.ace,
    gold: referenceTimeSec * MEDAL_BANDS.gold,
    silver: referenceTimeSec * MEDAL_BANDS.silver,
    bronze: referenceTimeSec * MEDAL_BANDS.bronze,
  };
}

export function classifyMedal(timeSec: number, referenceTimeSec: number): Medal {
  if (!isNonNegativeFinite(timeSec)) return "none";
  if (!isPositiveFinite(referenceTimeSec)) return "none";
  const ratio = timeSec / referenceTimeSec;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(ratio)) * 4;
  if (ratio <= MEDAL_BANDS.ace + tolerance) return "ace";
  if (ratio <= MEDAL_BANDS.gold + tolerance) return "gold";
  if (ratio <= MEDAL_BANDS.silver + tolerance) return "silver";
  if (ratio <= MEDAL_BANDS.bronze + tolerance) return "bronze";
  return "none";
}

export function createMedalTiming(config: MedalTimingConfig): MedalTiming {
  const thresholds = medalThresholds(config.referenceTimeSec);
  const speedThresholdMs =
    config.speedThresholdMs !== undefined && isNonNegativeFinite(config.speedThresholdMs)
      ? config.speedThresholdMs
      : FIRST_MOVEMENT_SPEED_MS;

  let phase: AttemptPhase = "pre-drive";
  let startedAtSimSec: number | null = null;
  let lastSimTimeSec = 0;
  let penaltySec = 0;
  let sectors: SectorSplit[] = [];
  let completion: FrozenCompletion | null = null;

  function baseElapsedAt(simTimeSec: number): number {
    if (startedAtSimSec === null) return 0;
    return Math.max(0, simTimeSec - startedAtSimSec);
  }

  function makeSnapshot(simTimeSec = lastSimTimeSec): MedalTimingSnapshot {
    const baseElapsedSec = completion?.effectiveTimeSec
      ? completion.effectiveTimeSec - penaltySec
      : baseElapsedAt(simTimeSec);
    const effectiveElapsedSec = completion?.effectiveTimeSec ?? baseElapsedSec + penaltySec;
    return freezeSnapshot({
      phase,
      startedAtSimSec,
      baseElapsedSec,
      penaltySec,
      effectiveElapsedSec,
      thresholds,
      liveMedal: classifyMedal(effectiveElapsedSec, config.referenceTimeSec),
      sectors,
      completion,
    });
  }

  function acceptTime(simTimeSec: number): boolean {
    if (!isNonNegativeFinite(simTimeSec) || simTimeSec < lastSimTimeSec) return false;
    lastSimTimeSec = simTimeSec;
    return true;
  }

  function startIfMoving(simTimeSec: number, speedMs: number): void {
    if (phase !== "pre-drive" || !isNonNegativeFinite(speedMs) || speedMs < speedThresholdMs)
      return;
    startedAtSimSec = simTimeSec;
    phase = "active";
  }

  function slowestSectorOrdinal(): number | null {
    let slowest: SectorSplit | null = null;
    for (const sector of sectors) {
      if (slowest === null || sector.sectorElapsedSec > slowest.sectorElapsedSec) slowest = sector;
    }
    return slowest?.ordinal ?? null;
  }

  function freezeResult(simTimeSec: number): void {
    if (phase === "complete" || startedAtSimSec === null) return;
    const effectiveTimeSec = baseElapsedAt(simTimeSec) + penaltySec;
    completion = Object.freeze({
      effectiveTimeSec,
      medal: classifyMedal(effectiveTimeSec, config.referenceTimeSec),
      sectors: Object.freeze(sectors.map((sector) => Object.freeze({ ...sector }))),
      slowestSectorOrdinal: slowestSectorOrdinal(),
    });
    phase = "complete";
  }

  function recordCheckpoint(
    simTimeSec: number,
    checkpoint: CheckpointSplitInput,
  ): MedalTimingSnapshot {
    if (phase !== "active" || !acceptTime(simTimeSec) || checkpoint.checkpointId.length === 0) {
      return makeSnapshot();
    }
    const cumulativeElapsedSec = baseElapsedAt(simTimeSec) + penaltySec;
    const previous = sectors[sectors.length - 1];
    const comparison = checkpoint.comparison;
    const comparisonDelta =
      comparison !== undefined && isNonNegativeFinite(comparison.cumulativeSec)
        ? cumulativeElapsedSec - comparison.cumulativeSec
        : null;
    sectors = [
      ...sectors,
      {
        checkpointId: checkpoint.checkpointId,
        fromCheckpointId: checkpoint.fromCheckpointId ?? previous?.checkpointId ?? null,
        ordinal: checkpoint.ordinal ?? sectors.length,
        lap: checkpoint.lap ?? 1,
        sectorElapsedSec: Math.max(0, cumulativeElapsedSec - (previous?.cumulativeElapsedSec ?? 0)),
        cumulativeElapsedSec,
        deltaSec: comparisonDelta,
        comparisonSource: comparison?.source ?? null,
      },
    ];
    return makeSnapshot();
  }

  function update(input: MedalTimingInput): MedalTimingSnapshot {
    if (input.restart === true) return restart();
    if (!isNonNegativeFinite(input.simTimeSec) || input.simTimeSec < lastSimTimeSec)
      return makeSnapshot();
    if (input.respawn === true) penaltySec += RESPAWN_PENALTY_SEC;
    if (input.penaltySec !== undefined && isNonNegativeFinite(input.penaltySec)) {
      penaltySec = Math.max(penaltySec, input.penaltySec);
    }
    if (!acceptTime(input.simTimeSec) || phase === "complete") return makeSnapshot();
    startIfMoving(input.simTimeSec, input.speedMs);
    if (input.checkpoint !== undefined) recordCheckpoint(input.simTimeSec, input.checkpoint);
    if (input.complete === true) freezeResult(input.simTimeSec);
    return makeSnapshot();
  }

  function respawn(): MedalTimingSnapshot {
    if (phase !== "complete") penaltySec += RESPAWN_PENALTY_SEC;
    return makeSnapshot();
  }

  function restart(): MedalTimingSnapshot {
    phase = "pre-drive";
    startedAtSimSec = null;
    penaltySec = 0;
    sectors = [];
    completion = null;
    return makeSnapshot();
  }

  function complete(simTimeSec: number): MedalTimingSnapshot {
    if (acceptTime(simTimeSec)) freezeResult(simTimeSec);
    return makeSnapshot();
  }

  return {
    update,
    recordCheckpoint,
    respawn,
    restart,
    complete,
    snapshot: () => makeSnapshot(),
  };
}
