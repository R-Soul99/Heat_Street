# Terrain Area Format v1

**Status:** Normative. Implemented by `src/core/terrain-format.ts`; the single codec shared by the
browser game, the sculpt page's dev plugin, the Node converter and the tests.
**Version:** binary `formatVersion: 1`, sidecar `formatVersion: 1`
**Companions:** `docs/schemas/road-graph.v1.md` (the sidecar's `graph` block, verbatim),
`tests/terrain-format.test.ts` (golden bytes and hardening tests).

## Purpose and files

A terrain area is a file pair under `public/maps/`:

- `<id>.terrain.bin` : binary heights and surface paint (this document, "Binary layout").
- `<id>.terrain.json` : road graph v1, objects, buildings, id counters ("Sidecar").

All coordinates are local ENU metres, Y-up (X east, Z south), as in the road graph.

## Binary layout

All multi-byte values are little-endian. Magic is the ASCII string `HSTR`.

| Offset | Type | Field | Meaning |
|-------:|------|-------|---------|
| 0 | 4 bytes | magic | `HSTR` |
| 4 | u16 | formatVersion | `1` |
| 6 | u16 | headerBytes | total header length including the surface enum and padding (multiple of 4) |
| 8 | u32 | rows | cells along Z |
| 12 | u32 | cols | cells along X |
| 16 | f32 | cellSizeM | cell edge length, metres |
| 20 | f64 | originX | world X of col 0 |
| 28 | f64 | originZ | world Z of row 0 |
| 36 | i32 | heightOffsetSteps | quantisation offset |
| 40 | f32 | heightScaleM | metres per step (default 0.01) |
| 44 | u8 | colliderSubdiv | heightfield collider subdivisions per cell, 1 or 2 |
| 45 | u8 | paintEncoding | 0 raw, 1 deflate-raw |
| 46 | u16 | reserved | 0 |
| 48 | u32 | paintWidth | pixels along X |
| 52 | u32 | paintHeight | pixels along Z |
| 56 | f32 | paintMetresPerPixel | |
| 60 | f64 | paintOriginX | |
| 68 | f64 | paintOriginZ | |
| 76 | u8 | surfaceCount | number of enum entries that follow |
| 77 | repeated | surface names | per entry: u8 length, then that many ASCII bytes |
| ... | zero pad | | up to `headerBytes` (4-byte multiple) |

Sections after the header, in order:

1. **Heights:** `Uint16[(rows + 1) * (cols + 1)]` in `row + col * (rows + 1)` order (the same
   order Rapier's heightfield uses), zero padded to a 4-byte multiple.
2. **Paint:** `paintWidth * paintHeight` bytes, row-major (`pz * width + px`). With
   `paintEncoding` 0 these are the raw bytes. With 1 the section is a u32 `compressedLength`
   followed by that many bytes of deflate-raw (RFC 1951, no zlib header).

The file length must equal the sum of the sections exactly.

### Height quantisation

`height = (q + heightOffsetSteps) * heightScaleM`, computed in float64, stored into a Float32Array.
The encoder picks `heightOffsetSteps = floor(minHeight / heightScaleM)` and
`q = round(height / heightScaleM) - heightOffsetSteps`. Any multiple of the scale, including
exactly 0, therefore round-trips exactly. If `(maxSteps - minSteps) > 65535` the encoder throws a
RangeError naming the span.

### Paint bytes

Low 4 bits: index into the file's surface enum, remapped on load to the current `SURFACE_TYPES`
order by name (a name not in `SURFACE_TYPES` rejects the file). Bit 7 (`0x80`): road flag.
Bits 4-6 are preserved.

### Caps (checked before allocating)

- `(rows + 1) * (cols + 1) <= 4,000,000`
- `paintWidth * paintHeight <= 2^27`
- Exact byte-length equality with the sections above.
- Inflation aborts as soon as output exceeds `paintWidth * paintHeight` bytes.

## Sidecar (`<id>.terrain.json`)

| Field | Type | Meaning |
|-------|------|---------|
| `kind` | string | exactly `heat-street.terrain-area` |
| `formatVersion` | number | exactly `1` |
| `areaId` | string | must equal the expected area id (and `graph.areaId`) |
| `name` | string | human-readable name |
| `groundSurface` | SURFACE_ENUM | surface of unpainted ground |
| `legacyGlbBuildings` | boolean | buildings come from the old GLB path |
| `nextEdgeId` | integer | strictly greater than every edge id; never decreases |
| `graph` | object | road graph v1, parsed by `parseRoadGraph` |
| `objects` | array | `{ "kind": "crest", id, centerX, centerZ, radiusM, heightM, ramp? }`; `ramp` = `{ headingRad, widthM, angleDeg, footRadiusM }` |
| `buildings` | array | `{ center {x,y,z}, halfExtents {x,y,z}, rotationY }` |

Every number must be finite. Unknown object kinds are rejected. Parsing rebuilds every field by
name; unknown keys (including `__proto__`) are ignored.

A loaded pair is additionally rejected when the graph bounds lie outside the grid extent by more
than one cell.

## Migration rule

To change the format: bump `formatVersion`, add a migration from N-1 (a function from old bytes
to new bytes, registered by version), and never edit v1 in place. Files with a version above the
build's are rejected with `unknown format version N`.

## Stable ids

`nextEdgeId` never decreases and edge ids are never reused. Node ids stay dense (`0..n-1`, a
`parseRoadGraph` requirement) and may be compacted if spawns are remapped with them.
