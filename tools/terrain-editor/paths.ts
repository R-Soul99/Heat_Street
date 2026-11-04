/**
 * Pure path/id validation and a capped body reader for the terrain dev
 * middleware (T-04.2-33, T-04.2-34). No Vite or filesystem access here so the
 * rules are unit-testable.
 */
import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { Readable } from "node:stream";

export const MAX_BIN_BYTES = 64 * 1024 * 1024;
export const MAX_JSON_BYTES = 8 * 1024 * 1024;

const SAFE_ID = /^[a-z0-9-]{1,64}$/;

export function isSafeAreaId(id: string): boolean {
  return SAFE_ID.test(id);
}

/** Absolute path of an area file inside public/maps, or null if id/kind are not allowed. */
export function resolveTerrainFile(root: string, id: string, kind: string): string | null {
  if (!isSafeAreaId(id)) return null;
  if (kind !== "bin" && kind !== "json") return null;
  const mapsDir = path.resolve(root, "public", "maps");
  const file = path.resolve(path.join(mapsDir, `${id}.terrain.${kind}`));
  if (!file.startsWith(mapsDir + path.sep)) return null;
  return file;
}

export interface StatusError extends Error {
  status: number;
}

/**
 * Reads a request body, rejecting with `{ status: 413 }` past `maxBytes`. The stream is paused,
 * not destroyed, so the caller can still send the 413 response; it should close the connection
 * after that response is flushed (WR-03).
 */
export function readBodyCapped(req: IncomingMessage | Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on("data", (c: Buffer | string) => {
      if (done) return;
      const buf = typeof c === "string" ? Buffer.from(c) : c;
      total += buf.length;
      if (total > maxBytes) {
        done = true;
        const err = new Error("request body too large") as StatusError;
        err.status = 413;
        req.pause();
        reject(err);
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}
