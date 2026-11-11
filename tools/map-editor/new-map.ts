/**
 * Pure logic for the editor's New popup, shared by the browser and the dev
 * middleware: id suggestion, input validation with readable messages, and
 * image-to-world sizing. No DOM, no fs.
 */

import { fmt3 } from "../editor-shell/format.ts";
import { importScale } from "./image-import.ts";
import { MAX_WORLD_KM, MIN_WORLD_KM } from "./world.ts";

const ID_PATTERN = /^[a-z0-9-]+$/;
const NAME_MSG = "Give the map a name: a-z, 0-9 and - only (for example my-map).";

export function suggestMapId(existing: readonly string[], base?: string): string {
  const taken = new Set(existing);
  if (base === undefined) {
    let n = 1;
    while (taken.has(`map-${n}`)) n++;
    return `map-${n}`;
  }
  let stem = base
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (stem === "") stem = "map";
  if (!taken.has(stem)) return stem;
  let n = 2;
  while (taken.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

function checkKm(label: string, v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return `${label} must be a number between ${MIN_WORLD_KM} and ${MAX_WORLD_KM} km.`;
  }
  if (v < MIN_WORLD_KM || v > MAX_WORLD_KM) {
    return `${label} must be between ${MIN_WORLD_KM} and ${MAX_WORLD_KM} km (you entered ${fmt3(v)}).`;
  }
  return null;
}

function checkFields(id: unknown, widthKm: unknown, heightKm: unknown): string | null {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return NAME_MSG;
  return checkKm("Width", widthKm) ?? checkKm("Height", heightKm);
}

export function validateNewMapInput(
  input: { id: string; widthKm: number; heightKm: number },
  existing: readonly string[],
): string | null {
  const err = checkFields(input.id, input.widthKm, input.heightKm);
  if (err !== null) return err;
  if (existing.includes(input.id)) {
    return `A map called "${input.id}" already exists. Pick another name.`;
  }
  return null;
}

/** Server-side shape + range check. Existence is checked on disk by writeNewWorld. */
export function validateNewWorldBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return "Request body must be JSON with id, widthKm and heightKm.";
  }
  const b = body as { id?: unknown; widthKm?: unknown; heightKm?: unknown };
  return checkFields(b.id, b.widthKm, b.heightKm);
}

export type ImportPlan =
  | { ok: true; widthKm: number; heightKm: number; mPerPx: number; warnings: string[] }
  | { ok: false; error: string };

export function planImportWorld(input: {
  imageW: number;
  imageH: number;
  widthKm?: number;
  mPerPx?: number;
}): ImportPlan {
  const { imageW, imageH } = input;
  if (!(imageW > 0 && imageH > 0)) return { ok: false, error: "The image has no size." };
  let scale: ReturnType<typeof importScale>;
  try {
    scale = importScale(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const widthKm = scale.widthM / 1000;
  const heightKm = scale.heightM / 1000;
  const wErr = checkKm("Width", widthKm);
  if (wErr !== null) return { ok: false, error: wErr };
  const eps = 1e-9;
  if (heightKm < MIN_WORLD_KM - eps || heightKm > MAX_WORLD_KM + eps) {
    const ratio = imageW / imageH;
    const minW = Math.ceil(MIN_WORLD_KM * ratio * 1000 - 1e-6) / 1000;
    const maxW = Math.floor(MAX_WORLD_KM * ratio * 1000 + 1e-6) / 1000;
    const hint =
      heightKm < MIN_WORLD_KM
        ? `Set Width to at least ${fmt3(minW)} km.`
        : `Set Width to at most ${fmt3(maxW)} km.`;
    return {
      ok: false,
      error: `This image would make a map ${fmt3(heightKm)} km tall; maps must be ${MIN_WORLD_KM} to ${MAX_WORLD_KM} km. ${hint}`,
    };
  }
  return { ok: true, widthKm, heightKm, mPerPx: scale.mPerPx, warnings: scale.warnings };
}
