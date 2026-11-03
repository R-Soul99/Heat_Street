/**
 * Dev-only Vite middleware for the 3D terrain editor
 * (`/tools/terrain-editor/index.html`). `apply: "serve"` keeps it out of
 * production builds. Ids are validated by `paths.ts`; bodies are capped and
 * decoded with the shared codec before anything touches disk.
 *
 *   GET /__terrain/areas              -> ["demo-hills", ...]
 *   GET /__terrain/<id>/bin|json      -> file bytes
 *   PUT /__terrain/<id>/bin|json      -> validate, then write via temp + rename
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { decodeTerrainBinary, parseTerrainSidecar } from "../../src/core/terrain-format.ts";
import {
  isSafeAreaId,
  MAX_BIN_BYTES,
  MAX_JSON_BYTES,
  readBodyCapped,
  resolveTerrainFile,
} from "./paths.ts";
import { assertSaveableGraph } from "./save-guard.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MAPS_DIR = path.join(ROOT, "public", "maps");

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type = "application/json",
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  send(res, status, JSON.stringify({ error: message }));
}

/** Strips anything path-like from a message before it reaches the browser (T-04.2-37). */
function safeMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/[A-Za-z]:[\\/][^\s"']*|\/[^\s"']*\/[^\s"']*/g, "<path>");
}

/** Per-file tail of the in-process write queue (WR-07). */
const writeQueues = new Map<string, Promise<void>>();

async function writeViaTemp(file: string, data: Buffer | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

/**
 * Write via a temp file + rename. WR-07: every request in the dev server
 * shares one pid, so the temp name is unique per call (no interleaved bytes,
 * no renaming another request's temp file away), and writes to the same file
 * are queued in-process (concurrent renames onto one target fail with EPERM
 * on Windows). Each call still settles with its own result.
 */
export function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const prev = writeQueues.get(file) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => writeViaTemp(file, data));
  const tail = run.catch(() => undefined);
  writeQueues.set(file, tail);
  void tail.then(() => {
    if (writeQueues.get(file) === tail) writeQueues.delete(file);
  });
  return run;
}

/**
 * Validates a sidecar PUT body: codec parse, then the same road-graph save
 * rule the editor applies client-side (D-17). Throws `terrain-format:` /
 * `parseRoadGraph:` for malformed input and `terrain-save:` for a graph with
 * a blocking validation failure.
 */
export function validateSidecarPut(text: string, id: string): void {
  const sidecar = parseTerrainSidecar(text, id, `${id}.terrain.json`);
  assertSaveableGraph(sidecar.graph);
}

export function terrainEditorApi(): Plugin {
  return {
    name: "heat-street-terrain-editor-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith("/__terrain/")) return next();
        try {
          if (req.method !== "GET" && req.method !== "PUT") {
            return sendError(res, 405, "method not allowed");
          }
          const parts = url.split("/").filter(Boolean); // ["__terrain", ...]
          if (req.method === "GET" && parts[1] === "areas" && parts.length === 2) {
            const areas = existsSync(MAPS_DIR)
              ? readdirSync(MAPS_DIR)
                  .map((f) => /^(.+)\.terrain\.json$/.exec(f)?.[1])
                  .filter((a): a is string => a !== undefined && isSafeAreaId(a))
                  .sort()
              : [];
            return send(res, 200, JSON.stringify(areas));
          }
          const id = parts[1];
          const kind = parts[2];
          if (id === undefined || kind === undefined || parts.length !== 3) {
            return sendError(res, 404, "not found");
          }
          const file = resolveTerrainFile(ROOT, id, kind);
          if (file === null) return sendError(res, 400, "invalid area id or file kind");
          const type = kind === "bin" ? "application/octet-stream" : "application/json";

          if (req.method === "GET") {
            if (!existsSync(file)) return sendError(res, 404, "unknown area");
            return send(res, 200, await readFile(file), type);
          }

          // PUT: cap, validate with the shared codec, then write atomically.
          if (kind === "bin") {
            const body = await readBodyCapped(req, MAX_BIN_BYTES);
            await decodeTerrainBinary(new Uint8Array(body), `${id}.terrain.bin`);
            await writeAtomic(file, body);
          } else {
            const body = await readBodyCapped(req, MAX_JSON_BYTES);
            const text = body.toString("utf8");
            validateSidecarPut(text, id);
            await writeAtomic(file, text);
          }
          return send(res, 200, '{"ok":true}');
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status === 413) return sendError(res, 413, "request body too large");
          const msg = safeMessage(err);
          // Codec/parse failures are the client's fault; filesystem failures are ours.
          const isValidation =
            msg.startsWith("terrain-format:") ||
            msg.startsWith("parseRoadGraph:") ||
            msg.startsWith("terrain-save:");
          return sendError(res, isValidation ? 400 : 500, msg);
        }
      });
    },
  };
}
