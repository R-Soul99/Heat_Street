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
 *   GET  /__editor/status/<area>          -> {registered, format, hasTerrain, hasCompiled}
 *   POST /__editor/to-terrain/<area>      -> compile, convert to the terrain format, register
 *                                            it as "terrain"; returns {ok, log, summary|error}
 *   POST /__editor/new-world              -> body {id,widthKm,heightKm}: writes a blank
 *                                            authored world and registers it; returns
 *                                            {ok,id,registered[,warning]} or {error}
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import {
  authoredLegacyIds,
  readAuthoredManifest,
  registerAuthoredMap,
  setAuthoredFormat,
} from "../map-compiler/authored-registry.ts";
import { convertAuthoredMap } from "../map-compiler/terrain/convert-authored.ts";
import { WorldExistsError, writeNewWorld } from "./new-world.ts";
import { MAX_WORLD_KM, MIN_WORLD_KM } from "./world.ts";

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

function postCompileFor(area: string): string[] | undefined {
  if (POST_COMPILE[area] !== undefined) return POST_COMPILE[area];
  return authoredLegacyIds(ROOT).includes(area) ? [ROUTE_SCRIPT, "--area", area] : undefined;
}

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

/**
 * Compiles an area. A registered map that is already in the terrain format is
 * not on the compiler's list, so its format is flipped to "legacy" for the
 * compile and put back afterwards (also when the compile fails).
 */
async function compileArea(area: string): Promise<{ log: string; ok: boolean }> {
  const entry = readAuthoredManifest(ROOT).find((e) => e.id === area);
  const restore = entry?.format === "terrain";
  if (restore) await setAuthoredFormat(ROOT, area, "legacy");
  try {
    let log = await run(["tools/map-compiler/cli.ts", "--area", area]);
    if (!log.includes("[exit")) {
      const post = postCompileFor(area);
      if (post !== undefined) log += await run(post);
    }
    if (log.includes("unknown area")) {
      log +=
        "\nThis map is not registered. Create it with File > New, or add it to tools/map-compiler/authored-maps.json.\n";
    }
    return { log, ok: !log.includes("[exit") };
  } finally {
    if (restore) await setAuthoredFormat(ROOT, area, "terrain");
  }
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
            const body = JSON.parse(await readBody(req)) as {
              id?: unknown;
              widthKm?: unknown;
              heightKm?: unknown;
            };
            const { id, widthKm, heightKm } = body;
            const bad = (error: string) => send(res, 400, JSON.stringify({ error }));
            if (typeof id !== "string" || id === "") return bad("Name is required.");
            if (!/^[a-z0-9-]+$/.test(id)) {
              return bad(`Name may only use a-z, 0-9 and - (got "${id.slice(0, 64)}").`);
            }
            if (
              typeof widthKm !== "number" ||
              typeof heightKm !== "number" ||
              !Number.isFinite(widthKm) ||
              !Number.isFinite(heightKm)
            ) {
              return bad("Width and height must be numbers in km.");
            }
            for (const [label, km] of [
              ["Width", widthKm],
              ["Height", heightKm],
            ] as const) {
              if (km < MIN_WORLD_KM || km > MAX_WORLD_KM) {
                return bad(
                  `${label} must be between ${MIN_WORLD_KM} and ${MAX_WORLD_KM} km (got ${Number(km.toFixed(3))}).`,
                );
              }
            }
            try {
              writeNewWorld(AREAS_DIR, id, widthKm, heightKm, new Date().toISOString());
            } catch (err) {
              if (err instanceof WorldExistsError) {
                return send(
                  res,
                  409,
                  JSON.stringify({
                    error: `A map called "${id}" already exists. Pick another name.`,
                  }),
                );
              }
              return bad(err instanceof Error ? err.message : String(err));
            }
            try {
              await registerAuthoredMap(ROOT, { id, format: "legacy" });
              return send(res, 200, JSON.stringify({ ok: true, id, registered: true }));
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return send(
                res,
                200,
                JSON.stringify({
                  ok: true,
                  id,
                  registered: false,
                  warning: `Created, but could not register for compiling: ${msg}`,
                }),
              );
            }
          }
          if (req.method === "POST" && parts[1] === "compile" && parts[2] !== undefined) {
            if (rawPath(parts[2], "roads") === undefined) {
              return send(res, 404, '{"error":"unknown area"}');
            }
            const out = await compileArea(parts[2]);
            res.setHeader("X-Compile-Ok", out.ok ? "1" : "0");
            return send(res, 200, out.log, "text/plain");
          }
          if (req.method === "GET" && parts[1] === "status" && parts[2] !== undefined) {
            const entry = readAuthoredManifest(ROOT).find((e) => e.id === parts[2]);
            const maps = path.join(ROOT, "public", "maps");
            return send(
              res,
              200,
              JSON.stringify({
                registered: entry !== undefined,
                format: entry?.format ?? null,
                hasTerrain:
                  entry !== undefined && existsSync(path.join(maps, `${entry.id}.terrain.json`)),
                hasCompiled:
                  entry !== undefined && existsSync(path.join(maps, `${entry.id}.map.json`)),
              }),
            );
          }
          if (req.method === "POST" && parts[1] === "to-terrain" && parts[2] !== undefined) {
            const entry = readAuthoredManifest(ROOT).find((e) => e.id === parts[2]);
            if (entry === undefined || rawPath(entry.id, "roads") === undefined) {
              return send(
                res,
                404,
                JSON.stringify({ ok: false, error: "That map is not one of your maps." }),
              );
            }
            const compiled = await compileArea(entry.id);
            if (!compiled.ok) {
              return send(
                res,
                200,
                JSON.stringify({
                  ok: false,
                  log: compiled.log,
                  error: "The map did not compile, so nothing was converted. See the compile log.",
                }),
              );
            }
            try {
              const summary = await convertAuthoredMap(ROOT, entry.id);
              await setAuthoredFormat(ROOT, entry.id, "terrain");
              return send(res, 200, JSON.stringify({ ok: true, log: compiled.log, summary }));
            } catch (err) {
              return send(
                res,
                200,
                JSON.stringify({
                  ok: false,
                  log: compiled.log,
                  error: `Converting to the terrain format failed: ${err instanceof Error ? err.message : String(err)}`,
                }),
              );
            }
          }
          return send(res, 404, '{"error":"not found"}');
        } catch (err) {
          return send(res, 500, JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}
