/**
 * `?laps=N` practice override for Circuit Race (07-07): N from 1 to 9 replaces
 * the course's lap count for that run only. A run whose lap count differs
 * from the course's own is PRACTICE: it is never saved, so the Circuit Race
 * best finish / best time stay comparable across runs (always the standard
 * course distance).
 *
 * Pure: no DOM, no `location` — the caller passes `location.search`.
 */
export const MIN_RACE_LAPS = 1;
export const MAX_RACE_LAPS = 9;

export interface RaceLapsConfig {
  /** Laps this run races. */
  readonly laps: number;
  /** True when `laps` differs from the course's own count: the result is not saved. */
  readonly practice: boolean;
  /** HUD note for a practice run (e.g. "1-LAP PRACTICE - NOT SAVED"), `null` for a standard race. */
  readonly note: string | null;
}

/** Only a single digit 1-9 is accepted; anything else (missing, 0, 10, "2.5", "x") keeps the course's lap count. */
export function resolveRaceLaps(search: string, courseLaps: number): RaceLapsConfig {
  const raw = new URLSearchParams(search).get("laps");
  const parsed = raw !== null && /^[1-9]$/.test(raw) ? Number(raw) : courseLaps;
  const laps = parsed >= MIN_RACE_LAPS && parsed <= MAX_RACE_LAPS ? parsed : courseLaps;
  const practice = laps !== courseLaps;
  return Object.freeze({
    laps,
    practice,
    note: practice ? `${laps}-LAP PRACTICE - NOT SAVED` : null,
  });
}
