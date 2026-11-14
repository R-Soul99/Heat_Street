// Pure tool grouping for the shell toolbar (07.1.1 D-02). No DOM.

/** Split tools into consecutive same-group runs; array order is never changed. */
export function groupTools<T extends { group?: string }>(
  tools: readonly T[],
): { group: string | undefined; tools: T[] }[] {
  const runs: { group: string | undefined; tools: T[] }[] = [];
  for (const t of tools) {
    const last = runs[runs.length - 1];
    if (last && last.group === t.group) last.tools.push(t);
    else runs.push({ group: t.group, tools: [t] });
  }
  return runs;
}

/** Visible button word (D-01); the long label stays for aria-label and the shortcuts dialog. */
export function displayLabel(t: { label: string; shortLabel?: string }): string {
  return t.shortLabel ?? t.label;
}
