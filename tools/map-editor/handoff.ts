/**
 * Pure helpers for the map editor's page-reload resilience and the "Open in
 * terrain editor" handoff. No DOM, no fs, no timers of its own (sleep is
 * injected), so everything here is unit tested in `handoff.test.ts`.
 */

export const RESUME_KEY = "heat-street:map-editor:resume";
export const RESUME_TTL_MS = 30_000;
const RESUME_ID_RE = /^[a-z0-9-]{1,64}$/;

export interface ResumeMarker {
  id: string;
  until: number;
}

/** Marker to store (as JSON) just before the editor does something that can reload the page. */
export function resumeMarker(id: string, now: number, ttlMs: number = RESUME_TTL_MS): ResumeMarker {
  return { id, until: now + ttlMs };
}

/**
 * The map id to reopen after a page reload, or undefined. The marker comes from
 * sessionStorage and is treated as untrusted: shape, id pattern and expiry are
 * all checked.
 */
export function shouldResume(marker: unknown, now: number): string | undefined {
  if (typeof marker !== "object" || marker === null) return undefined;
  const { id, until } = marker as Record<string, unknown>;
  if (typeof id !== "string" || !RESUME_ID_RE.test(id)) return undefined;
  if (typeof until !== "number" || !Number.isFinite(until) || now > until) return undefined;
  return id;
}

export interface WaitOptions {
  tries: number;
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
}

/** Polls `check` up to `tries` times, sleeping between tries. A throwing check counts as false. */
export async function waitUntil(
  check: () => boolean | Promise<boolean>,
  { tries, delayMs, sleep }: WaitOptions,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if (await check()) return true;
    } catch {
      // treated as "not yet"
    }
    if (i + 1 < tries) await sleep(delayMs);
  }
  return false;
}

/** Exact id match against the terrain editor's /__terrain/areas list. */
export function terrainListed(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}
