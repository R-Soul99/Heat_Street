/** Pure info-bar / status text builders. No DOM. */
import { fmt3 } from "../editor-shell/format.ts";

export function worldSizeText(widthM: number, heightM: number): string {
  return `${fmt3(widthM / 1000)} x ${fmt3(heightM / 1000)} km`;
}

export function countsText(roads: number, buildings: number): string {
  return `${roads} ${roads === 1 ? "road" : "roads"}, ${buildings} ${
    buildings === 1 ? "building" : "buildings"
  }`;
}

export const UNREGISTERED_MESSAGE =
  "This map is not registered with the compiler yet. Add its two lines to tools/map-compiler/cli.ts (shown when it was created), then compile again.";

export interface CompileOutcome {
  ok: boolean;
  summary: string;
}

export function compileOutcome(log: string): CompileOutcome {
  if (log.includes("unknown area")) return { ok: false, summary: UNREGISTERED_MESSAGE };
  if (log.includes("[exit")) {
    const first = log.split("\n").find((l) => /error/i.test(l));
    if (first !== undefined) return { ok: false, summary: first.trim().slice(0, 160) };
    return { ok: false, summary: "Compile failed (see Help > Show log)." };
  }
  return { ok: true, summary: "Compiled." };
}
