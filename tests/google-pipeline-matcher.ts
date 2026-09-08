/**
 * Matcher for the retired-map-pipeline gate (ROADMAP Phase 1 SC5, threat T-01-07).
 *
 * This lives in its own module rather than inside the test file because biome's
 * lint/suspicious/noExportsInTest forbids exports from a test file, and
 * tests/no-google-pipeline.test.ts must exercise the matcher against synthetic
 * input to prove it is discriminating.
 *
 * Scope decision record: .planning/phases/01-engine-foundation/01-03-PLAN.md,
 * <grep_scope_decision>. The authority for the prohibition itself is
 * docs/adr/0001-map-data-source.md.
 */

/** A scanned line that names the retired pipeline with no supersession pointer nearby. */
export interface Violation {
  /** Repo-relative path, e.g. `CLAUDE.md`. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The offending line, trimmed. */
  text: string;
}

/**
 * The literal a file must contain near a match to prove the mention is a
 * superseded reference rather than live guidance.
 */
export const ADR_POINTER = "docs/adr/0001-map-data-source.md";

/**
 * How many lines either side of a match are searched for {@link ADR_POINTER}.
 * Six is wide enough for a bullet plus its wrapped continuation lines, and
 * narrow enough that a pointer in an unrelated section does not launder a
 * match elsewhere in the same file.
 */
export const POINTER_WINDOW = 6;

/**
 * Trimmed prefixes that mark a line as commentary rather than instruction.
 * Comment lines are dropped BEFORE matching so that a supersession banner
 * (`> SUPERSEDED — ...`) or a code comment restating the prohibition cannot
 * itself trip the gate. They are still searched when looking for the pointer,
 * because a pointer in a comment is a perfectly good pointer.
 */
const COMMENT_PREFIXES = ["//", "*", "/*", ">"] as const;

// The prohibition is stated in full in docs/adr/0001-map-data-source.md; the
// line below is only the mechanical half of it. Kept adjacent to the pointer
// above so this file passes its own gate on merit rather than by allowlist.
const RETIRED_PIPELINE = /google\s*(?:maps|earth|street\s*view)/i;

/** True when a line is commentary and therefore exempt from matching. */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Returns every line in `contents` that names the retired pipeline without an
 * {@link ADR_POINTER} within {@link POINTER_WINDOW} lines.
 *
 * Pure: takes the file's text, never touches the filesystem, so the test suite
 * can prove it flags a synthetic violation without writing a file.
 */
export function findViolations(file: string, contents: string): Violation[] {
  const lines = contents.split(/\r?\n/);
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (!RETIRED_PIPELINE.test(line)) continue;

    const from = Math.max(0, i - POINTER_WINDOW);
    const to = Math.min(lines.length - 1, i + POINTER_WINDOW);
    let hasPointer = false;
    for (let j = from; j <= to; j++) {
      if (lines[j].includes(ADR_POINTER)) {
        hasPointer = true;
        break;
      }
    }
    if (!hasPointer) {
      violations.push({ file, line: i + 1, text: line.trim() });
    }
  }

  return violations;
}

/** Formats violations so a failing test names the file, the line and the text. */
export function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line}: ${v.text}`).join("\n");
}
