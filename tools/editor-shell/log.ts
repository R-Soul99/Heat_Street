import type { StatusKind } from "./types";

export interface LogLine {
  at: string;
  kind: StatusKind;
  text: string;
}

export interface MessageLog {
  add(text: string, kind?: StatusKind): void;
  lines(): readonly LogLine[];
  clear(): void;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function createMessageLog(cap = 300, now: () => Date = () => new Date()): MessageLog {
  let items: LogLine[] = [];
  return {
    add(text, kind = "info") {
      const d = now();
      items.push({
        at: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
        kind,
        text,
      });
      if (items.length > cap) items = items.slice(items.length - cap);
    },
    lines: () => items,
    clear() {
      items = [];
    },
  };
}

/** Pre-wrapped monospace block, newest last. textContent only. */
export function logDialogBody(lines: readonly LogLine[]): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "es-log";
  pre.textContent =
    lines.length === 0
      ? "No messages yet."
      : lines.map((l) => `${l.at} ${l.kind === "info" ? "" : `[${l.kind}] `}${l.text}`).join("\n");
  return pre;
}
