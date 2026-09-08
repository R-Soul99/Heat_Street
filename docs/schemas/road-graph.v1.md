# Road Graph Schema v1

**Status:** Normative. This is the contract the Phase 4 map compiler must emit and every
downstream consumer may rely on.
**Version:** `schemaVersion: 1`
**Companion files:** `fixtures/road-graph.sample.json` (a conforming sample),
`tests/road-graph-schema.test.ts` (machine-checks the sample against this document),
`docs/adr/0001-map-data-source.md` (where the data and its attribution strings come from).

Phase 1 records this contract; Phase 4 implements the compiler that emits it. Writing it down
now — with a sample artifact and a test — is what makes ROADMAP Phase 1 SC5 automatable rather
than "a human confirmed a document exists".

---

## Normative shape

All coordinates are **local ENU metres, Y-up** (three.js convention): X east, Y up, Z south.

```jsonc
{
  "schemaVersion": 1,
  "areaId": "area-01",
  "name": "Human-readable area name",

  // Provenance. Phase 4 SC3 requires a one-command reproducible rebuild;
  // without these four fields a shipped map cannot be reproduced or diffed.
  "source": {
    "osmExtract": "geofabrik://<region>/<file>.osm.pbf",
    "osmSnapshot": "2026-09-01T00:00:00Z",
    "demSource": "usgs-3dep-1m",            // or "copernicus-glo30"
    "compilerVersion": "0.1.0"
  },

  // Generated straight into the credits screen — never hand-maintained.
  // The strings are specified in docs/adr/0001-map-data-source.md.
  "attribution": {
    "osm": "© OpenStreetMap contributors",
    "osmLicense": "ODbL-1.0",
    "osmLicenseUrl": "https://www.openstreetmap.org/copyright",
    "dem": "U.S. Geological Survey 3D Elevation Program (public domain)"
  },

  // World origin. Recording the lat/lon origin is what makes the projection
  // choice fixable later without re-sourcing the data.
  "origin": { "lat": 0.0, "lon": 0.0, "projection": "local-enu-metres" },
  "bounds": { "minX": 0, "minZ": 0, "maxX": 0, "maxZ": 0 },

  // Dense 0..n-1 integer ids assigned by the compiler. NOT OSM node ids —
  // ngraph and typed arrays both want dense ints. OSM id kept for provenance only.
  "nodes": [
    { "id": 0, "x": 0.0, "y": 0.0, "z": 0.0, "junction": true, "osmNodeId": 0 }
  ],

  // Stored UNDIRECTED with a `oneway` flag. The runtime builds a directed
  // ngraph from this; the minimap and collision builder want it undirected.
  "edges": [
    {
      "id": 0,
      "from": 0,
      "to": 1,
      // Centreline polyline INCLUDING both endpoints, local metres.
      // Feeds: collision ribbon generation, minimap draw, AI racing line, arrow heading.
      "points": [[0, 0, 0], [10, 0.2, 0]],
      "lengthM": 10.0,
      // Game surface ENUM — never a raw OSM string. The compiler owns the
      // mapping table so an unknown OSM value fails the BUILD, not the runtime.
      "surface": "tarmac",
      "roadClass": "residential",           // from OSM highway=*
      "lanes": 2,
      "widthM": 6.5,
      "oneway": false,
      "speedLimitKph": 50,
      "bridge": false,
      "tunnel": false,
      "layer": 0,                           // OSM layer=* — bridge/tunnel z-ordering
      "osmWayId": 0
    }
  ],

  // Optional in v1; route/checkpoint authoring may move to a sibling file in Phase 5.
  "spawns": [ { "id": "default", "nodeId": 0, "headingRad": 0.0 } ]
}
```

## Field reference

### Top level

| Key | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | integer | yes | Exactly `1` for this document. Mandatory from v1 so Phase 4 rebuilds and Phase 6 persistence can detect stale artifacts. |
| `areaId` | string | yes | Stable machine id; the key used by save data and area unlocking. |
| `name` | string | yes | Human-readable, shown in UI. |
| `source` | object | yes | Provenance — see below. |
| `attribution` | object | yes | Licence strings — see below. |
| `origin` | object | yes | `lat`, `lon`, `projection`. |
| `bounds` | object | yes | `minX`, `minZ`, `maxX`, `maxZ`. Must contain every node coordinate. |
| `nodes` | array | yes | Dense, ordered by `id`. |
| `edges` | array | yes | Undirected. |
| `spawns` | array | no | Optional in v1. |

### `source` (all mandatory)

| Key | Type | Notes |
|---|---|---|
| `osmExtract` | string | Which extract the road network came from. |
| `osmSnapshot` | string (ISO 8601) | The OSM data timestamp. Without it a map cannot be diffed against a rebuild. |
| `demSource` | string | `usgs-3dep-1m` or `copernicus-glo30`. Selection rule is in the ADR. |
| `compilerVersion` | string (semver) | Which compiler build produced this artifact. |

### `attribution` (all mandatory)

| Key | Type | Notes |
|---|---|---|
| `osm` | string | e.g. `© OpenStreetMap contributors`. |
| `osmLicense` | string | `ODbL-1.0`. |
| `osmLicenseUrl` | string | `https://www.openstreetmap.org/copyright`. Required where linking is not possible. |
| `dem` | string | The DEM credit. For Copernicus this must be the verbatim mandatory notice from the ADR. |

### `origin`

| Key | Type | Notes |
|---|---|---|
| `lat` | number | WGS84 latitude of local origin. |
| `lon` | number | WGS84 longitude of local origin. |
| `projection` | string | `local-enu-metres` in v1. The only supported value. |

### Node

| Key | Type | Notes |
|---|---|---|
| `id` | integer | Dense, compiler-assigned, contiguous from `0`. |
| `x`, `y`, `z` | number | Local metres, Y-up. |
| `junction` | boolean | True where three or more edges meet. |
| `osmNodeId` | integer | Provenance only — never a lookup key at runtime. |

### Edge

| Key | Type | Notes |
|---|---|---|
| `id` | integer | Dense, compiler-assigned. |
| `from`, `to` | integer | Node ids. Direction is meaningful only when `oneway` is true. |
| `points` | number[][] | Centreline polyline, at least two entries, each a `[x, y, z]` tuple in local metres. First entry equals the `from` node's coordinate, last equals the `to` node's. |
| `lengthM` | number | Polyline length in metres. |
| `surface` | enum | Closed game enum — see below. |
| `roadClass` | string | From OSM `highway=*`. |
| `lanes` | integer | Lane count. |
| `widthM` | number | Carriageway width, metres. Drives collision ribbon width. |
| `oneway` | boolean | When true, traversal is `from` → `to` only. |
| `speedLimitKph` | number | Signposted limit; used by AI target speed, not by the player's car. |
| `bridge` | boolean | From OSM `bridge=*`. |
| `tunnel` | boolean | From OSM `tunnel=*`. |
| `layer` | integer | From OSM `layer=*`; bridge/tunnel z-ordering. |
| `osmWayId` | integer | Provenance only. |

### Spawn (optional)

| Key | Type | Notes |
|---|---|---|
| `id` | string | e.g. `default`. |
| `nodeId` | integer | Node the car spawns at. |
| `headingRad` | number | Initial heading, radians. |

## Surface enum

`surface` is a **closed** game enum with exactly six values. It is never a raw OSM string.

The line below is normative and is parsed by `tests/road-graph-schema.test.ts`. Adding a
seventh surface here without updating the compiler and the fixture is a test failure by design.

```
SURFACE_ENUM = tarmac | gravel | dirt_road | grass | sand | mud
```

### OSM → game surface mapping

This table lives here as the specification; the **implementation of it lives in the Phase 4
compiler**, so an unmapped OSM value fails the BUILD rather than defaulting silently at
runtime. All fifteen `surface=*` values below are documented values of the OSM key.

| Game surface | OSM `surface=*` values | Fallback from `highway=*` when `surface` is absent |
|---|---|---|
| `tarmac` | `asphalt`, `concrete`, `concrete:plates`, `paved`, `chipseal`, `paving_stones` | `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `residential`, `unclassified`, `service` |
| `tarmac` (rough) | `sett` | — |
| `gravel` | `gravel`, `fine_gravel`, `pebblestone` | — |
| `dirt_road` | `compacted`, `dirt`, `earth`, `ground`, `unpaved` | `track` |
| `grass` | `grass`, `grass_paver` | — |
| `sand` | `sand` | — |
| `mud` | `mud` | — |

Reference: <https://wiki.openstreetmap.org/wiki/Key:surface>

**`cobblestone` is deliberately not mapped.** The OSM wiki flags it as *"an unclear value"* and
recommends `sett` and `unhewn_cobblestone` instead. Lumping cobblestone into `tarmac` would
silently give a rough historic street the grip of fresh asphalt. The compiler must handle
`sett` and `unhewn_cobblestone` explicitly and fail the build on bare `cobblestone`. `sett` is
mapped to `tarmac` above as the closest of the six available surfaces; if Phase 2 tuning shows
that reads wrong, add a seventh enum value deliberately rather than remapping silently.

## Design decisions

These are the parts that are expensive to change later. They are recorded so a future agent
knows they were chosen, not defaulted into.

1. **Coordinates are local ENU metres with a recorded lat/lon origin, Y-up.** Lat/lon never
   reaches the runtime. `y` is authored by the compiler from the DEM (sampled and smoothed
   along each centreline), **not** sampled at runtime — SURF-01's per-wheel friction and Phase
   4's "no bumpy junctions" both depend on the road surface being a deliberately smoothed
   artifact rather than a raw heightfield read.
2. **Node ids are compiler-assigned dense integers, not OSM ids.** OSM ids are 64-bit and
   sparse; keeping them as the primary key forces hash maps where typed arrays would do, and
   Phase 7's AI does a lot of graph traversal. OSM ids are retained for provenance only.
3. **Edges are stored undirected with a `oneway` flag.** One representation serves three
   consumers — collision ribbon generation, minimap drawing and pathfinding — which is what
   makes Phase 4 SC3 ("all derive from the same road graph") achievable rather than
   aspirational.
4. **`surface` is a closed game enum; the OSM mapping lives in the compiler.** An unknown OSM
   value must fail the BUILD. A runtime default silently turns an unmapped dirt track into
   tarmac, which is exactly the kind of bug that stays invisible until a medal time is
   inexplicable.
5. **`schemaVersion` is mandatory from v1.** Phase 4 rebuilds and Phase 6 persistence both need
   to detect stale artifacts, and a version field added later cannot describe files written
   before it existed.
6. **Provenance fields are mandatory, not optional.** Without `osmSnapshot` and
   `compilerVersion` a map cannot be reproduced or diffed, and Phase 4 SC3's "rebuilds from
   source with one command" is unverifiable.

## Consumers

| Field group | Serves |
|---|---|
| `edges[].points`, `bounds` | **NAV-03** minimap polylines — drawn directly onto a 2D canvas. |
| `edges[].from`/`to`/`oneway`/`lengthM`/`speedLimitKph`, dense `nodes[].id` | **NAV-04 / NAV-05** road-aware pathfinding (ngraph over dense integer ids). |
| `nodes[]`, `edges[].points`, `spawns[]` | **P2P-01** and **CIRC-01** checkpoint and start placement on the road network. |
| `edges[]` graph topology | **CIRC-02** and **GET-01 / GET-03** AI racer and pursuer pathfinding. |
| `edges[].surface` | **SURF-01** surface types carried from source through to per-wheel friction. |
| `edges[].widthM`, `points`, `bridge`, `tunnel`, `layer` | Collision ribbon generation and bridge/tunnel z-ordering. |
| The whole document | **Phase 4 SC3** — collision geometry, nav graph and route/checkpoint placement all derive from this one artifact. |
| `source.*` | **T-01-08** provenance: a shipped map is always traceable to its inputs. |
| `attribution.*` | **T-01-09** licence compliance: the credits screen is generated from the data. |

## Versioning

`schemaVersion` is an integer. A breaking change to any required field increments it and gets
a new document (`road-graph.v2.md`) rather than an edit to this one. A loader encountering an
unknown `schemaVersion` must refuse the file rather than attempt a best-effort parse.
