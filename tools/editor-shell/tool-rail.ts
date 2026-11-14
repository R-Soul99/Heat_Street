export interface ShellTool {
  id: string;
  label: string;
  icon: string;
  keyLabel?: string;
  tip: string;
  disabled?: boolean;
  /** Visible button word when label is over 12 characters (D-01); label stays for the shortcuts list; aria-label uses the visible word. */
  shortLabel?: string;
  /** Long how-to text shown on the long-hover tooltip tier (D-08). */
  tipLong?: string;
  /** KeyboardEvent.code for the tool hotkey (07.1.2). */
  code?: string;
}

/** Visible button word (D-01); the long label stays for aria-label and the shortcuts dialog. */
export function displayLabel(t: { label: string; shortLabel?: string }): string {
  return t.shortLabel ?? t.label;
}
