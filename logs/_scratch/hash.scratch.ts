import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { buildRoadGeometry } from "../../src/core/road-geometry";
import { parseRoadGraph } from "../../src/core/road-graph";
it("hash", () => {
  const out: Record<string, string> = {};
  for (const f of readdirSync("public/maps")) {
    let graph: any;
    try {
      if (f.endsWith(".map.json")) graph = parseRoadGraph(readFileSync(`public/maps/${f}`, "utf8"), f);
      else if (f.endsWith(".terrain.json")) {
        const j = JSON.parse(readFileSync(`public/maps/${f}`, "utf8"));
        if (!j.graph) continue;
        graph = parseRoadGraph(JSON.stringify(j.graph), f);
      } else continue;
    } catch (e) { out[f] = "ERR " + String(e).slice(0, 80); continue; }
    const g = buildRoadGeometry(graph);
    for (const e of g.edges) {
      const h = createHash("sha256").update(Buffer.from(e.positions.buffer, e.positions.byteOffset, e.positions.byteLength)).update(Buffer.from(e.indices.buffer, e.indices.byteOffset, e.indices.byteLength)).digest("hex");
      out[`${f}#${e.edgeId}`] = h;
    }
    (g as any).shoulders?.forEach?.((s: any, i: number) => { out[`${f}#sh${i}`] = createHash("sha256").update(JSON.stringify(Array.from(s.leftPositions ?? s.positions ?? []))).digest("hex"); });
  }
  writeFileSync(process.env.HASH_OUT!, JSON.stringify(out, null, 1));
});
