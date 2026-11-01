/**
 * Converts a roads GeoJSON (LineStrings) and a buildings GeoJSON (Polygons)
 * into the Overpass-shaped raw caches the map compiler reads
 * (`areas/<areaId>.raw-osm.json`, `areas/<areaId>.raw-buildings.json`).
 *
 * Run: `npm run import-newton-poppleford`, then
 * `npm run compile-map -- --area newton-poppleford`.
 *
 * Only `highway`, `name`, `ref` are passed through for roads — no surface,
 * width or lanes are invented; the compiler's fallbacks decide those.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AreaConfig } from "../areas/juliette-ga.config.ts";
import { newtonPopplefordConfig } from "../areas/newton-poppleford.config.ts";
import { skiddersAndPoppConfig } from "../areas/skidders-and-popp.config.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const AREAS_DIR = path.join(import.meta.dirname, "..", "areas");
const NODE_ID_BASE = 1_000_000_000;
/** Carriageway width per highway class, metres (UK-typical). */
const ROAD_WIDTH_M: Readonly<Record<string, number>> = {
  primary: 7,
  secondary: 6.5,
  tertiary: 6,
  unclassified: 4.5,
  residential: 5,
  service: 3.5,
  track: 3.5,
};
const DEFAULT_ROAD_WIDTH_M = 4.5;
/** Extra clearance between a road edge and a building, metres. */
const BUILDING_ROAD_CLEARANCE_M = 1.5;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_AT_LAT = 111_320 * Math.cos((50.7 * Math.PI) / 180);

interface Feature {
  readonly id?: number | string;
  readonly properties: Record<string, unknown>;
  readonly geometry: { readonly type: string; readonly coordinates: unknown };
}
interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

const toLatLon = (c: readonly number[]): LatLon => ({ lon: c[0] as number, lat: c[1] as number });

async function readFeatures(file: string): Promise<Feature[]> {
  const json = JSON.parse(await readFile(path.join(ROOT, file), "utf8")) as {
    features: Feature[];
  };
  return json.features;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined;
}

function featureId(f: Feature, fallback: number): number {
  const id = Number(f.id ?? f.properties.id);
  return Number.isFinite(id) ? id : fallback;
}

export function roadsToElements(features: readonly Feature[]): unknown[] {
  const nodeIds = new Map<string, number>();
  let next = NODE_ID_BASE;
  const nodeId = (p: LatLon): number => {
    const key = `${p.lat},${p.lon}`;
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = next++;
      nodeIds.set(key, id);
    }
    return id;
  };
  const out: unknown[] = [];
  features.forEach((f, i) => {
    if (f.geometry.type !== "LineString") return;
    const geometry = (f.geometry.coordinates as number[][]).map(toLatLon);
    if (geometry.length < 2) return;
    const tags: Record<string, string> = {};
    for (const k of ["highway", "name", "ref"] as const) {
      const v = str(f.properties[k]);
      if (v !== undefined) tags[k] = v;
    }
    tags.width = String(ROAD_WIDTH_M[tags.highway ?? ""] ?? DEFAULT_ROAD_WIDTH_M);
    out.push({
      type: "way",
      id: featureId(f, 2_000_000_000 + i),
      nodes: geometry.map(nodeId),
      geometry,
      tags,
    });
  });
  return out;
}

interface RoadSeg {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly halfWidth: number;
}

function roadSegments(features: readonly Feature[]): RoadSeg[] {
  const segs: RoadSeg[] = [];
  for (const f of features) {
    if (f.geometry.type !== "LineString") continue;
    const pts = (f.geometry.coordinates as number[][]).map(toLatLon);
    const halfWidth = (ROAD_WIDTH_M[str(f.properties.highway) ?? ""] ?? DEFAULT_ROAD_WIDTH_M) / 2;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as LatLon;
      const b = pts[i + 1] as LatLon;
      segs.push({ ...toMetres(a), bx: toMetres(b).ax, by: toMetres(b).ay, halfWidth });
    }
  }
  return segs;
}

function toMetres(p: LatLon): { ax: number; ay: number } {
  return {
    ax: p.lon * M_PER_DEG_LON_AT_LAT,
    ay: p.lat * M_PER_DEG_LAT,
  };
}

function distToSeg(px: number, py: number, s: RoadSeg): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2));
  return Math.hypot(px - s.ax - t * dx, py - s.ay - t * dy);
}

/** True when any sample of the footprint lies within a road corridor plus clearance. */
function footprintOnRoad(ring: readonly LatLon[], segs: readonly RoadSeg[]): boolean {
  const pts = ring.map(toMetres);
  const samples: { ax: number; ay: number }[] = [...pts];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as { ax: number; ay: number };
    const b = pts[i + 1] as { ax: number; ay: number };
    samples.push({ ax: (a.ax + b.ax) / 2, ay: (a.ay + b.ay) / 2 });
  }
  const n = pts.length - 1;
  samples.push({
    ax: pts.slice(0, n).reduce((sum, p) => sum + p.ax, 0) / n,
    ay: pts.slice(0, n).reduce((sum, p) => sum + p.ay, 0) / n,
  });
  return samples.some((p) =>
    segs.some((s) => distToSeg(p.ax, p.ay, s) < s.halfWidth + BUILDING_ROAD_CLEARANCE_M),
  );
}

export function buildingsToElements(
  features: readonly Feature[],
  roadFeatures: readonly Feature[] = [],
): unknown[] {
  const segs = roadSegments(roadFeatures);
  const out: unknown[] = [];
  features.forEach((f, i) => {
    if (f.geometry.type !== "Polygon") return;
    const ring = ((f.geometry.coordinates as number[][][])[0] ?? []).map(toLatLon);
    if (ring.length < 4) return;
    if (footprintOnRoad(ring, segs)) return; // dropBuildingsOnRoads
    const tags: Record<string, string> = { building: str(f.properties.type) ?? "yes" };
    const height = str(f.properties.height);
    if (height !== undefined) tags.height = height;
    const levels = str(f.properties.levels);
    if (levels !== undefined) tags["building:levels"] = levels;
    out.push({ type: "way", id: featureId(f, 3_000_000_000 + i), geometry: ring, tags });
  });
  return out;
}

/** Splits one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Buildings table (id, type, latitude, longitude, width_meters, depth_meters,
 * height_meters, levels, footprint_area_sqm) -> axis-aligned rectangle
 * polygons. The table has no rotation, so its width/depth are the extents of
 * a possibly rotated footprint; both are scaled by sqrt(area / (w*d)) so the
 * rectangle keeps the real footprint area.
 */
export function csvToBuildingFeatures(csv: string): Feature[] {
  const [headerLine, ...lines] = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitCsvLine(headerLine ?? "");
  const col = (row: string[], name: string): string => row[header.indexOf(name)] ?? "";
  return lines.map((line) => {
    const row = splitCsvLine(line);
    const lat = Number(col(row, "latitude"));
    const lon = Number(col(row, "longitude"));
    const w = Number(col(row, "width_meters"));
    const d = Number(col(row, "depth_meters"));
    const area = Number(col(row, "footprint_area_sqm"));
    const k = w * d > 0 && area > 0 ? Math.min(1, Math.sqrt(area / (w * d))) : 1;
    const hx = Math.max(0.5, (w * k) / 2) / M_PER_DEG_LON_AT_LAT;
    const hy = Math.max(0.5, (d * k) / 2) / M_PER_DEG_LAT;
    return {
      id: Number(col(row, "id")),
      properties: {
        id: Number(col(row, "id")),
        type: col(row, "type"),
        height: Number(col(row, "height_meters")) || undefined,
        levels: Number(col(row, "levels")) || undefined,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon - hx, lat - hy],
            [lon + hx, lat - hy],
            [lon + hx, lat + hy],
            [lon - hx, lat + hy],
            [lon - hx, lat - hy],
          ],
        ],
      },
    };
  });
}

interface ImportSource {
  readonly config: AreaConfig;
  readonly roads: string;
  /** GeoJSON polygons, or a CSV table (`.csv`). */
  readonly buildings: string;
  readonly provenance: string;
}

const IMPORTS: Readonly<Record<string, ImportSource>> = {
  "newton-poppleford": {
    config: newtonPopplefordConfig,
    roads: "fixtures/0ae02c32-roads_vector_4km.geojson",
    buildings: "fixtures/9bcb4759-real_buildings_structures_4km.geojson",
    provenance: "AI Studio GeoJSON export (OpenStreetMap, ODbL)",
  },
  "skidders-and-popp": {
    config: skiddersAndPoppConfig,
    roads: "fixtures/SkiddersAndPopp/roads_vector_4km.geojson",
    buildings: "fixtures/SkiddersAndPopp/building_structures_table_4km.csv",
    provenance: "AI Studio export, roads GeoJSON + buildings table (OpenStreetMap, ODbL)",
  },
};

async function main(): Promise<void> {
  const flag = process.argv.indexOf("--area");
  const areaId = flag === -1 ? "newton-poppleford" : (process.argv[flag + 1] ?? "");
  const source = Object.hasOwn(IMPORTS, areaId) ? IMPORTS[areaId] : undefined;
  if (source === undefined) {
    throw new Error(`unknown area "${areaId}"; known: ${Object.keys(IMPORTS).join(", ")}`);
  }
  const cfg = source.config;
  const fetchedAt = cfg.osmSnapshot ?? "1970-01-01T00:00:00.000Z";
  const envelope = (query: string, elements: unknown[]) => ({
    fetchedAt,
    endpoint: cfg.osmExtract,
    bbox: cfg.bbox,
    query,
    response: { elements },
  });
  const roadFeatures = await readFeatures(source.roads);
  const buildingFeatures = source.buildings.endsWith(".csv")
    ? csvToBuildingFeatures(await readFile(path.join(ROOT, source.buildings), "utf8"))
    : await readFeatures(source.buildings);
  const roads = roadsToElements(roadFeatures);
  const buildings = buildingsToElements(buildingFeatures, roadFeatures);
  const write = (name: string, data: unknown) =>
    writeFile(path.join(AREAS_DIR, name), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await write(`${cfg.areaId}.raw-osm.json`, envelope(`roads: ${source.provenance}`, roads));
  await write(
    `${cfg.areaId}.raw-buildings.json`,
    envelope(`buildings: ${source.provenance}`, buildings),
  );
  console.log(
    `import ${cfg.areaId}: ${roads.length} road ways, ${buildings.length} buildings (${buildingFeatures.length - buildings.length} dropped as on-road)`,
  );
}

main().catch((err: unknown) => {
  console.error(`import: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
