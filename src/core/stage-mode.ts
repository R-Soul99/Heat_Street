/**
 * Stage mode request parsing and stage selection (Phase 10, D-08).
 * Pure: no DOM, no renderer, no physics.
 */

import { STAGE_ID_PATTERN, type Stage, type StageData } from "./stage";

export interface StageRequest {
  readonly stageId: string | null;
  readonly badStageId: boolean;
}

export type StageSelection =
  | { readonly kind: "stage"; readonly stage: Stage; readonly warning?: string }
  | { readonly kind: "free-drive"; readonly warning: string };

export function parseStageRequest(search: string): StageRequest | null {
  const params = new URLSearchParams(search);
  if (params.get("mode") !== "stage") return null;
  const raw = params.get("stage");
  if (raw === null) return { stageId: null, badStageId: false };
  if (!STAGE_ID_PATTERN.test(raw)) return { stageId: null, badStageId: true };
  return { stageId: raw, badStageId: false };
}

export function selectStage(
  data: StageData | undefined,
  request: StageRequest,
  context: { readonly isTerrain: boolean; readonly areaId: string },
): StageSelection {
  if (!context.isTerrain) {
    return {
      kind: "free-drive",
      warning: "stage mode: stages need a terrain map; falling back to free drive.",
    };
  }
  if (data === undefined) {
    return {
      kind: "free-drive",
      warning: `stage mode: no stages file for "${context.areaId}"; falling back to free drive.`,
    };
  }
  if (data.areaId !== context.areaId) {
    return {
      kind: "free-drive",
      warning: `stage mode: stages file is for area "${data.areaId}", not "${context.areaId}"; falling back to free drive.`,
    };
  }
  const first = data.stages[0];
  if (first === undefined) {
    return {
      kind: "free-drive",
      warning: "stage mode: the stages file has no stages; falling back to free drive.",
    };
  }
  if (request.badStageId) {
    return {
      kind: "stage",
      stage: first,
      warning: "stage mode: invalid stage id in the URL; using the first stage.",
    };
  }
  if (request.stageId === null) return { kind: "stage", stage: first };
  const found = data.stages.find((s) => s.id === request.stageId);
  if (found === undefined) {
    return {
      kind: "stage",
      stage: first,
      warning: `stage mode: unknown stage "${request.stageId}"; using the first stage.`,
    };
  }
  return { kind: "stage", stage: found };
}
