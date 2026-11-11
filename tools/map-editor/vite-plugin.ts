/**
 * Dev-only Vite middleware for the map editor (`/tools/map-editor/index.html`).
 * `apply: "serve"` keeps it out of production builds. Area ids are matched
 * against `^[a-z0-9-]+$` AND an existing raw file, so no request can reach a
 * path outside `tools/map-compiler/areas/`.
 *
 *   GET  /__editor/areas                  -> ["newton-poppleford", ...]
 *   GET  /__editor/raw/<area>/<kind>      -> raw envelope (kind: roads|buildings)
 *   PUT  /__editor/raw/<area>/<kind>      -> overwrite it (body: envelope JSON)
 *   POST /__editor/compile/<area>         -> compile-map (+ route authoring), returns log
 *   POST /__editor/new-world              -> body {id,widthKm,heightKm}: writes a blank
 *                                            authored world; returns {ok,register:[cli.ts lines]}
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { validateNewWorldBody } from "./new-map.ts";
import { WorldExistsError, writeNewWorld } from "./new-world.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const AREAS_DIR = path.join(ROOT, "tools", "map-compiler", "areas");
const FILE_FOR_KIND: Record<string, string> = { roads: "raw-osm", buildings: "raw-buildings" };
/** Extra steps after compile-map, for areas whose routes are authored by script. */
const ROUTE_SCRIPT = "tools/map-compiler/synthetic/author-newton-routes.ts";
const POST_COMPILE: Record<string, string[]> = {
  "newton-poppleford": [ROUTE_SCRIPT, "--area", "newton-poppleford"],
  "skidders-and-popp": [ROUTE_SCRIPT, "--area", "skidders-and-popp"],
  "my-map": [ROUTE_SCRIPT, "--area", "my-map"],
  // Terrain-format flat maps: rebuild the terrain from the freshly compiled graph.
  "arena-test": ["tools/map-compiler/terrain/cli.ts", "--area", "arena-test"],
};

function rawPath(area: string, kind: string): string | undefined {
  const suffix = FILE_FOR_KIND[kind];
  if (suffix === undefined || !/^[a-z0-9-]+$/.test(area)) return undefined;
  const file = path.join(AREAS_DIR, `${area}.${suffix}.json`);
  return existsSync(file) ? file : undefined;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = "application/json"): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve(
          `$ node ${args.join(" ")}\n${stdout}${stderr}${err ? `\n[exit ${err.code}]` : ""}\n`,
        );
      },
    );
  });
}

export function mapEditorApi(): Plugin {
  return {
    name: "heat-street-map-editor-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith("/__editor/")) return next();
        try {
          const parts = url.split("/").filter(Boolean); // ["__editor", ...]
          if (req.method === "GET" && parts[1] === "areas") {
            const { readdirSync } = await import("node:fs");
            const areas = readdirSync(AREAS_DIR)
              .map((f) => /^([a-z0-9-]+)\.raw-osm\.json$/.exec(f)?.[1])
              .filter((a): a is string => a !== undefined);
            return send(res, 200, JSON.stringify(areas));
          }
          if (parts[1] === "raw" && parts[2] !== undefined && parts[3] !== undefined) {
            const file = rawPath(parts[2], parts[3]);
            if (file === undefined) return send(res, 404, '{"error":"unknown area/kind"}');
            if (req.method === "GET") return send(res, 200, await readFile(file, "utf8"));
            if (req.method === "PUT") {
              const body = await readBody(req);
              const parsed = JSON.parse(body) as { response?: { elements?: unknown } };
              if (!Array.isArray(parsed.response?.elements)) {
                return send(res, 400, '{"error":"not a raw envelope"}');
              }
              await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
              return send(res, 200, '{"ok":true}');
            }
          }
          if (req.method === "POST" && parts[1] === "new-world") {
            let body: unknown = null;
            try {
              body = JSON.parse(await readBody(req));
            } catch {
              body = null;
            }
            const problem = validateNewWorldBody(body);
            if (problem !== null) return send(res, 400, JSON.stringify({ error: problem }));
            const { id, widthKm, heightKm } = body as {
              id: string;
              widthKm: number;
              heightKm: number;
            };
            try {
              const register = writeNewWorld(
                AREAS_DIR,
                id,
                widthKm,
                heightKm,
                new Date().toISOString(),
              );
              return send(res, 200, JSON.stringify({ ok: true, register }));
            } catch (err) {
              if (err instanceof WorldExistsError) {
                return send(
                  res,
                  409,
                  JSON.stringify({
                    error: `A map called "${id}" already exists (${err.message}). Pick another name.`,
                  }),
                );
              }
              return send(
                res,
                400,
                JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
              );
            }
          }
          if (req.method === "POST" && parts[1] === "compile" && parts[2] !== undefined) {
            if (rawPath(parts[2], "roads") === undefined) {
              return send(res, 404, '{"error":"unknown area"}');
            }
            let log = await run(["tools/map-compiler/cli.ts", "--area", parts[2]]);
            if (!log.includes("[exit")) {
              const post = POST_COMPILE[parts[2]];
              if (post !== undefined) log += await run(post);
            }
            if (log.includes("unknown area")) {
              log +=
                "\nNew world? Add its import and KNOWN_AREAS line (shown when it was created) to tools/map-compiler/cli.ts, then compile again.\n";
            }
            return send(res, 200, log, "text/plain");
          }
          return send(res, 404, '{"error":"not found"}');
        } catch (err) {
          return send(res, 500, JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}
