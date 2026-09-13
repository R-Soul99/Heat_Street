# Phase 4: Map Pipeline & First Area - Pattern Map

**Mapped:** 2026-09-13
**Files analyzed:** ~18 new files (`tools/map-compiler/`) + 3 edits to existing files + 1 likely
new runtime-loader pair (`src/`) implied by SC1's "drivable" requirement
**Analogs found:** 0 exact / 9 convention-level / several "no analog — genuinely new" (see
"No Analog Found")

**Read this first:** this phase builds a subsystem — an offline Node CLI at `tools/map-compiler/`
— that has no prior implementation anywhere in this codebase. There is no file to copy a CRUD
handler or a component from. What DOES exist, and what this document extracts concretely, is a
very consistent **house style** across every existing `src/`/`tests/`/`docs/` file: a specific
module-header comment shape, a "Layering:" contract line, provenance tags on tuned/researched
values, doc-vs-code drift guards, and a test-construction idiom (`?raw` + `import.meta.glob`,
never `node:fs`). The planner and executor should match that house style even though the
compiler's actual logic (Overpass fetch, GeoTIFF sampling, ribbon geometry, glTF authoring) is
new territory with no in-repo precedent — RESEARCH.md's "Architecture Patterns" section is the
substantive design reference for that logic.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `tools/map-compiler/cli.ts` | tool entry-point (CLI) | batch | `src/main.ts` (composition root — the only other "wire everything together and run" file in the repo) | structural-only |
| `tools/map-compiler/areas/<area-id>.config.ts` | config | — | `src/core/vehicle-tuning.ts` / `src/core/surface-tuning.ts` (typed config object + defaults shape) | role-match |
| `tools/map-compiler/sources/overpass.ts` | service (network fetch) | request-response / file-I/O (cached to disk) | none in-repo — first network-fetching module in the project | no analog |
| `tools/map-compiler/sources/dem.ts` | service (network fetch + binary parse) | file-I/O | none in-repo | no analog |
| `tools/map-compiler/graph/build-graph.ts` | transform | batch | `src/physics/telemetry/routines.ts` (pure data-in/data-out module, closed-form, no I/O) | role-match (purity discipline only) |
| `tools/map-compiler/graph/surface-mapping.ts` | transform / utility (lookup table + throw-on-unmapped) | batch | `src/core/surface-types.ts` (closed enum mirrored from a doc, doc-parity test) | strong structural match |
| `tools/map-compiler/graph/elevation.ts` | transform | batch | `src/physics/transform-cache.ts` ("allocate once, mutate/sample in place" discipline, referenced elsewhere as the project's own precedent for this pattern) | partial |
| `tools/map-compiler/geometry/ribbon.ts` | utility (pure geometry) | transform | `src/render/camera/camera-math.ts` (pure math module, no engine imports, Node-testable) | role-match |
| `tools/map-compiler/geometry/junction-fan.ts` | utility (pure geometry) | transform | `src/render/camera/camera-math.ts` | role-match |
| `tools/map-compiler/author/collision.ts` | transform (buffers only, no Rapier calls) | batch | `src/physics/surface-scene.ts` (builds collider *descriptions* per surface zone, registers into a side-table) — analog for the CONSUMING runtime pattern, not for this compiler module itself | partial (see "No Analog Found" for the trimesh-buffer authoring half) |
| `tools/map-compiler/author/gltf.ts` | transform (glTF Document assembly) | batch | none in-repo — no glTF authoring exists yet | no analog |
| `tools/map-compiler/validate/validator.ts` | validator / service | batch | none in-repo — closest conceptual sibling is `tests/road-graph-schema.test.ts`'s "loud, named failure" discipline, but that is a test file, not a runtime validator | no analog (convention-level match only) |
| `tools/map-compiler/**/*.test.ts` (colocated) | test | — | `tests/road-graph-schema.test.ts`, `tests/surface-tuning.test.ts` (doc-parity / schema-conformance idiom) | strong structural match |
| `tests/no-google-pipeline.test.ts` (EDIT) | test / mechanical gate | — | itself (edit in place) | exact (same file) |
| `tsconfig.json` (EDIT) | config | — | itself (edit in place) | exact (same file) |
| `package.json` (EDIT) | config | — | itself (edit in place) | exact (same file) |
| `src/physics/map-scene.ts` (likely, runtime loader — SC1 "drivable" implies this exists somewhere in this phase) | service / scene composition | request-response (fetch) + CRUD-like (register colliders) | `src/physics/surface-scene.ts` (scene factory: builds world geometry, registers a `SurfaceMap`, returns a scene interface with `applyInput`/`dispose`) | strong structural match |
| `src/render/map-view.ts` (likely, render counterpart) | component / render scene | transform | `src/render/surface-view.ts` (mirrors physics geometry into meshes, "MUST MATCH" comment convention) | role-match (though this file will genuinely use `GLTFLoader`, which `surface-view.ts` does not) |
| `docs/adr/000X-*.md` (only if a new locked decision emerges, e.g. building-detail ceiling) | doc | — | `docs/adr/0001-map-data-source.md`, `docs/adr/0003-occlusion-mitigation.md` | exact (doc convention) |

## Pattern Assignments

### `tools/map-compiler/cli.ts` (tool entry-point, batch)

**Analog:** `src/main.ts` (composition-root shape, not its DOM/render wiring)

**What to copy — the header-comment convention** (`src/main.ts` lines 1-20):
```typescript
/**
 * Composition root: wires core, physics, render and debug together into a
 * running application.
 * ...
 * `src/main.ts` is the trust boundary where a layering violation is easiest
 * to introduce and hardest to see (01-RESEARCH.md "Architectural
 * Responsibility Map"). `tests/layering.test.ts` polices the whole `src/`
 * tree automatically rather than relying on this file being reviewed
 * carefully by eye every time it changes.
 */
```
`cli.ts` should open with the equivalent statement for `tools/`: name itself as the single
entry point, name what it wires (area config -> sources -> graph -> geometry -> author ->
validate -> write), and state explicitly that `tests/layering.test.ts` does **not** currently
cover `tools/**` (see Pitfall 2 in RESEARCH.md) — so this file's own discipline is the only guard
until that test is extended.

**Core pattern — fail loud, named, non-zero exit** (mirrors the schema's own design decision 4
and RESEARCH.md's Pattern 2/3 "fails the BUILD" requirement; no direct source excerpt exists yet
in-repo for a CLI exit-code convention, so this is the one place RESEARCH.md's own text, not a
code excerpt, is the binding pattern):
```
surface-mapping.ts: throws on unmapped OSM surface=* value (never a silent tarmac fallback)
validator.ts: process.exit(1) with every failing node/edge id named, never a bare stack trace
```

---

### `tools/map-compiler/graph/surface-mapping.ts` (transform / utility, batch)

**Analog:** `src/core/surface-types.ts` — the strongest single match in the whole codebase for
this file's exact shape (closed enum, doc is the source of truth, code is the mirror, a test
enforces they can never drift).

**Full pattern to copy** (`src/core/surface-types.ts` lines 1-33):
```typescript
/**
 * The six-value closed surface enum, spelled and ORDERED identically to
 * `docs/schemas/road-graph.v1.md`'s normative `SURFACE_ENUM` line:
 *
 *   SURFACE_ENUM = tarmac | gravel | dirt_road | grass | sand | mud
 *
 * That document is the source; this file is the mirror, never the reverse —
 * `tests/surface-tuning.test.ts` parses the doc (reusing
 * `tests/road-graph-schema.test.ts`'s `surfaceEnumFromDoc` idiom) and asserts
 * exact array equality against `SURFACE_TYPES` below, so any future edit to
 * either side that drifts from the other fails the build (T-03-04).
 * ...
 * Pure by construction: no renderer, no physics engine, no DOM, no wall
 * clock. `tests/layering.test.ts` mechanically enforces this for every file
 * under `src/core/`.
 */
export const SURFACE_TYPES = ["tarmac", "gravel", "dirt_road", "grass", "sand", "mud"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];
```

**Apply directly:** `surface-mapping.ts` must implement `docs/schemas/road-graph.v1.md`'s "OSM ->
game surface mapping" table (already normative, not to be redesigned — see that doc's own
warning against "fixing" the `sett`/`cobblestone` asymmetry) as a lookup that **throws** on any
`surface=*` value not in the fifteen documented OSM values, and its companion test should reuse
`tests/road-graph-schema.test.ts`'s exact `surfaceEnumFromDoc(doc: string): string[]` regex-parse
idiom (lines 98-109 of that file) against `docs/schemas/road-graph.v1.md`, not a hardcoded
duplicate array — this is the specific mechanism that keeps the compiler's enum from silently
drifting off the schema's.

**Error handling pattern to copy** — `src/core/surface-tuning.ts` never throws on bad *input data*
(it clamps/defaults — that is the right shape for user-editable tuning), but the schema's own
design decision 4 is explicit that surface mapping is the ONE place in this project where a
silent default is the bug, not the safety net:
```
"An unknown OSM value fails the BUILD. A runtime default silently turns an
unmapped dirt track into tarmac, which is exactly the kind of bug that stays
invisible until a medal time is inexplicable." — docs/schemas/road-graph.v1.md
```
So `surface-mapping.ts`'s function signature should be `mapSurface(osmSurface: string | undefined,
osmHighway: string): SurfaceType` and it must `throw new Error(...)` (never return a fallback
value) on an explicitly-present-but-unmapped tag — matching Anti-Pattern warning already recorded
in RESEARCH.md ("Any `try { mapSurface(v) } catch { return "tarmac" }` pattern anywhere in the
compiler is exactly the bug the schema was written to prevent").

---

### `tools/map-compiler/geometry/ribbon.ts` and `junction-fan.ts` (pure geometry utilities)

**Analog:** `src/render/camera/camera-math.ts` — the project's existing convention for a pure-math
module with zero engine imports, Node-testable in isolation.

**Layering statement to copy the SHAPE of** (every `src/` file in this repo opens with a
"Layering:" sentence; `tools/map-compiler/**` is outside `src/` and therefore outside
`tests/layering.test.ts`'s glob, so this convention is not mechanically enforced here — copy the
STATEMENT anyway, as documentation, and say so explicitly):
```typescript
// From src/physics/surface.ts:
// "Layering: may import @dimforge/rapier3d and src/core/. Must not import
// three and must not touch the DOM or any wall clock."
```
Equivalent for `ribbon.ts`/`junction-fan.ts`:
```typescript
// Layering: pure geometry. Must not import RAPIER, three, @gltf-transform/*,
// or any network/fs module — inputs are plain node/edge arrays, outputs are
// plain vertex arrays, so this file is testable with zero fixtures beyond a
// literal in-memory graph.
```

**Core pattern (pseudocode already vetted in RESEARCH.md, "Pattern 1")** — this is the only place
in this phase where RESEARCH.md's own code example, not an in-repo excerpt, is the direct source
to implement from, because no ribbon-offset code exists anywhere in this repo:
```typescript
// tools/map-compiler/geometry/ribbon.ts
function buildRibbon(edge: Edge): { left: Vec3[]; right: Vec3[] } {
  const pts = edge.points; // already DEM-sampled + smoothed, y authoritative
  const halfWidth = edge.widthM / 2;
  const left: Vec3[] = [];
  const right: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const tangent = estimateTangent(pts, i);
    const normal = perpendicularXZ(tangent);
    left.push(addScaled(pts[i], normal, halfWidth));
    right.push(addScaled(pts[i], normal, -halfWidth));
  }
  return { left, right };
}
```

---

### `tools/map-compiler/author/collision.ts` (transform: per-edge trimesh buffers, no Rapier calls)

**Analog:** `src/physics/surface.ts` + `src/physics/surface-scene.ts` for the CONSUMING side of
this contract (how the runtime turns a collider + surface into a registered `SurfaceMap` entry).
The compiler module itself has no analog (it emits vertex/index buffers, not live Rapier
objects), but the shape those buffers must satisfy at load time is dictated by this shipped code:

**The constraint this module exists to satisfy** (`src/physics/surface.ts` lines 39-42, and the
"Pitfall 5" note in RESEARCH.md):
```typescript
export interface SurfaceMap {
  register(colliderHandle: number, surface: SurfaceType): void;
  lookup(colliderHandle: number | undefined): SurfaceType;
}
```
This is a **`ColliderHandle -> SurfaceType`, one-value-per-collider** table — confirmed in
`src/physics/surface.ts`'s own header comment. `author/collision.ts` must therefore emit **one
trimesh buffer per edge (or per contiguous same-surface run)**, never one merged buffer for the
whole road network — Anti-Pattern already logged in RESEARCH.md as "the natural first instinct...
and it is specifically wrong here for a documented, code-level reason."

**Runtime consumer pattern to hand to whichever plan builds the loader** (`src/physics/surface-scene.ts`
lines 89-108, `buildSurfaceZone`):
```typescript
function buildSurfaceZone(
  world: RAPIER.World,
  surfaceMap: SurfaceMap,
  surface: SurfaceType,
  centerZ: number,
): void {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -ZONE_HALF_Y, centerZ));
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(ZONE_HALF_X, ZONE_HALF_Y, ZONE_HALF_Z).setFriction(1.0),
    body,
  );
  surfaceMap.register(collider.handle, surface);
}
```
The real map loader's per-edge equivalent replaces `ColliderDesc.cuboid` with
`ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)` — the flag is
mandatory per CLAUDE.md's own HIGH-confidence finding and RESEARCH.md Pitfall 5 — and otherwise
follows this exact `createRigidBody` -> `createCollider` -> `surfaceMap.register(handle, surface)`
sequence.

---

### `tools/map-compiler/validate/validator.ts` (validator, batch)

**Analog (convention only):** `tests/road-graph-schema.test.ts`'s "loud, named failure" discipline
— no runtime validator exists in-repo, but this test file is the project's one existing example
of exactly the failure-reporting shape SC5 demands (name the offending id, never a bare crash):

```typescript
// tests/road-graph-schema.test.ts lines 246-263 — the shape to mirror, not
// literal code to reuse (this is a Vitest assertion, the validator needs a
// runtime equivalent that prints and exits nonzero instead of `expect`):
it("matches each polyline's endpoints to its from/to node coordinates", () => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    expect(from).toBeDefined();
    ...
  }
});
```
Translate this exact "iterate every edge, check the specific invariant, report the specific
`edge.id`/`node.id` that failed" shape into `validator.ts`'s reachability + geometry-sanity
checks, per RESEARCH.md's Pattern/Anti-Pattern sections and SC5's own wording ("reports failures
loudly rather than silently").

---

### `tools/map-compiler/**/*.test.ts` (colocated tests)

**Analog:** `tests/road-graph-schema.test.ts` and `tests/surface-tuning.test.ts` for the
doc-parity idiom; `tests/layering.test.ts` and `tests/no-google-pipeline.test.ts` for the
`import.meta.glob(..., { query: "?raw", eager: true, import: "default" })` file-reading idiom.

**Copy this exact idiom whenever a compiler test needs to read a doc or fixture from disk**
(`tests/road-graph-schema.test.ts` lines 1-10):
```typescript
// Both files are read through Vite's `?raw` transform rather than `node:fs`.
// `@types/node` is not installed [at the time this convention was set] and
// this phase's threat model (T-01-SC) forbids adding packages, so `node:fs`
// fails `tsc --noEmit`. `?raw` is typed by `vite/client` (already in tsconfig
// `types`) and still genuinely reads the file from disk on every run.
import schemaDoc from "../docs/schemas/road-graph.v1.md?raw";
import fixtureRaw from "../fixtures/road-graph.sample.json?raw";
```
**IMPORTANT DEVIATION TO FLAG FOR THE PLANNER:** RESEARCH.md's Standard Stack table explicitly
adds `@types/node` as a new devDependency for this phase ("Currently absent from the repo
entirely... T-01-SC was scoped to browser code; it does not block a Node-only build tool"). Once
`@types/node` lands, `tools/map-compiler/**/*.test.ts` (and `cli.ts`/`sources/*.ts` themselves)
are free to use real `node:fs`/`node:https` directly — the `?raw` glob workaround above is a
`src/`+`tests/` convention that existed specifically BECAUSE `@types/node` was absent; it is not
a rule the new Node-only tree needs to inherit. Do not cargo-cult `?raw` glob reads into
`tools/map-compiler/` source files (tests may still use it for reading `.md` fixtures if
convenient, but the compiler's own `sources/overpass.ts`/`sources/dem.ts` should use real
`node:https`/`node:fs`, which is the whole reason this phase adds the dependency).

**Vitest config:** no new config needed — `vitest.config.ts`'s `environment: "node"` is already
repo-wide (RESEARCH.md's own Validation Architecture section confirms this), and Vitest's default
include glob picks up `tools/map-compiler/**/*.test.ts` automatically.

---

## Shared Patterns

### Module header comment convention (apply to every new `tools/map-compiler/*.ts` file)

Every existing `src/` file opens with a JSDoc block with this shape, observed identically across
`src/physics/surface.ts`, `src/physics/surface-scene.ts`, `src/core/surface-types.ts`,
`src/core/surface-tuning.ts`, `src/physics/telemetry/routines.ts`:

1. One-sentence summary of what the file IS (not what it does — its identity).
2. Why it exists / what decision or plan produced it (cites a plan number or research doc where
   relevant, e.g. "plan 03-03 Task 2").
3. Any non-obvious engineering reason for a structural choice (e.g. why a `Map` side-table over
   `userData`).
4. A closing "Layering:" sentence stating what this file may and may not import.

Apply this shape to every new compiler file. Since `tools/**` is outside `tests/layering.test.ts`'s
scope (RESEARCH.md Pitfall 2), the "Layering:" sentence here is documentation-only, not
mechanically enforced — say so in the sentence itself, e.g. "Layering: pure geometry, no I/O.
NOT mechanically enforced — `tests/layering.test.ts` does not scan `tools/**`."

### Provenance tags on any tuned/reasoned/cited numeric constant

Every numeric constant in this codebase that isn't self-evidently exact carries one of four
tags, observed in `src/core/surface-tuning.ts` and `src/physics/telemetry/routines.ts`:

- `[MEASURED]` — an empirical result from this project's own sessions (e.g. "frictionSlip 10.5
  and 1000 both measured 3.48-3.49 g").
- `[CITED: <source>]` — sourced from an external reference (e.g.
  `hpwizard.com/tire-friction-coefficient.html`).
- `[TUNED in plan XX-YY's feel session]` — corrected by human playtest, with the before/after
  value and the playtest quote where available.
- `[ASSUMED]` — a reasoned default with no external verification, explicitly flagged for a later
  feel-session retune.

RESEARCH.md itself already uses this exact tag vocabulary (`[VERIFIED: ...]`, `[CITED: ...]`,
`[ASSUMED: ...]`) for the compiler's own design decisions (e.g. Pattern 1's junction-fan geometry,
Pattern 2's junction-surface-assignment heuristic). Carry these tags into the actual compiler
source code wherever RESEARCH.md flagged something MEDIUM confidence or reasoned-not-verified —
e.g. `surface-mapping.ts`'s `sett -> tarmac` mapping should cite the schema doc's own
"Design decisions" section 4, and `author/collision.ts`'s junction-surface heuristic (highest
road-class wins) should carry the `[ASSUMED, MEDIUM confidence — RESEARCH.md "Pattern 2"]` tag
verbatim, flagged for the same kind of human feel-check Phase 3's `03-12` plan gave surface grip.

### Version pinning convention

`package.json` currently pins every dependency to an EXACT version, no caret/tilde
(`"@dimforge/rapier3d": "0.20.0"`, `"three": "0.185.1"`). ADR 0001's own "Consequences" section
states the reasoning explicitly: "A patch bump in either can alter solver behaviour and therefore
silently invalidate recorded medal times... should be treated as a gameplay change, not a
maintenance chore." Apply the same exact-pin discipline to every new package this phase adds
(`ngraph.path@1.6.1`, `ngraph.graph@20.1.2`, `geotiff@3.0.5`, `osmtogeojson@3.0.0-beta.5`,
`@gltf-transform/{cli,core,functions,extensions}@4.5.0`, `@types/node@<pinned>`) — RESEARCH.md's
own "Installation" block already writes these as exact pins; do not let a planner or executor
loosen them to `^`/`~` ranges.

### "Doc is the source, code is the mirror" drift guard

Three existing pairs already establish this pattern:
- `docs/schemas/road-graph.v1.md`'s `SURFACE_ENUM` line <-> `src/core/surface-types.ts`'s
  `SURFACE_TYPES` <-> `tests/road-graph-schema.test.ts`'s `surfaceEnumFromDoc()` parser.
- `docs/adr/0001-map-data-source.md` <-> `tests/no-google-pipeline.test.ts`'s grep gate.
- `docs/frame-budget.md` <-> (Phase 1's frame-budget test, not read this session but named in
  `tests/docs-present.test.ts`).

Apply the same shape to `graph/surface-mapping.ts`'s OSM->game mapping table: parse the doc's
table (or at minimum assert the doc and the code's mapped-value set are identical), never
hand-duplicate the fifteen OSM values as a second hardcoded literal that can silently drift.

### Doc existence + non-placeholder floor (`tests/docs-present.test.ts` pattern)

If this phase adds any new doc (e.g. an ADR recording the Juliette, GA area confirmation, or a
building-detail-ceiling decision per Open Question 2), add it to `tests/docs-present.test.ts`'s
`REQUIRED` array with a `minChars` floor (existing floors: 1500 for ADRs/schemas, 1000 for
`docs/frame-budget.md`, 500 for fixtures/licenses) rather than leaving a new doc's existence
unchecked.

### `tsconfig.json` and `tests/no-google-pipeline.test.ts` — mechanical edits, not new patterns

Both are existing files requiring a scoped edit, already fully specified by RESEARCH.md Pitfalls
2 and 3:
- `tsconfig.json`: add `"tools"` to the `include` array (currently `["src", "tests",
  "vite.config.ts", "vitest.config.ts"]`).
- `tests/no-google-pipeline.test.ts`: extend BOTH `SCANNED_GLOBS` (currently `["*.md",
  "docs/**/*.md", "src/**/*.ts", "tests/**/*.ts"]`) AND the `import.meta.glob` calls in `SCANNED`
  (Vite requires literal glob strings, so the array and the glob calls must be updated together —
  this is the file's own documented convention, lines 24-27) to include `tools/**/*.ts`. Do not
  edit one without the other.

---

## No Analog Found

Files/capabilities with no close match anywhere in this codebase. The planner should treat
RESEARCH.md's "Architecture Patterns", "Standard Stack" and "Code Examples" sections as the
substantive design reference for these — there is no in-repo excerpt to fall back on.

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `tools/map-compiler/sources/overpass.ts` | service | request-response / file-I/O | First network-fetching module in the project. No existing HTTP client, retry/backoff, or disk-cache pattern exists in `src/` or `tools/` to copy. Follow RESEARCH.md's Pitfall 1 (cache raw Overpass JSON to disk, detect HTML-error-page-where-JSON-expected explicitly) as the binding design. |
| `tools/map-compiler/sources/dem.ts` | service | file-I/O | First binary-raster-parsing module (`geotiff` npm package). No analog. Follow RESEARCH.md's "Code Examples" `exportImage` REST pattern. |
| `tools/map-compiler/author/gltf.ts` | transform | batch | No glTF authoring exists anywhere in the repo — `GLTFLoader` isn't even imported yet in `src/render/`. `@gltf-transform/core`'s `Document`/`Accessor`/`Primitive` API is entirely new to this codebase. Follow RESEARCH.md's Alternatives Considered note (do NOT use Three's `GLTFExporter` — it needs a live `THREE.Scene`, wrong tier for a Node build tool). |
| `src/render/map-view.ts` (or equivalent) — the eventual `GLTFLoader` consumer | component | request-response (asset load) | `src/render/vehicle-view.ts` and `src/render/surface-view.ts` both build meshes from hand-authored `THREE.BoxGeometry`/literal placement tables — neither loads an external asset. This will be the first `GLTFLoader.load(...)` call in the project. No in-repo async-asset-loading pattern exists to copy; `STACK.md`'s guidance ("maps go in `public/`, loaded by URL at runtime, lazy per-level") is the binding design reference instead. |
| `tools/map-compiler/validate/validator.ts`'s reachability check | validator | batch | `ngraph.path`/`ngraph.graph` are new dependencies with no existing usage anywhere in the repo to copy call-site conventions from. Follow RESEARCH.md's System Architecture Diagram ("undirected reachability (ngraph) + geometry sanity"). |
| A "small, committed fixture OSM+DEM sample for offline/deterministic CI" (RESEARCH.md Wave 0 Gaps) | fixture | — | No existing binary/GeoTIFF fixture exists in `fixtures/`; `fixtures/road-graph.sample.json` is hand-written JSON, not derived from a raw-source fixture pipeline. This is new fixture-authoring territory — decide format at planning time. |

## Metadata

**Analog search scope:** `src/core/`, `src/physics/`, `src/physics/telemetry/`, `src/render/`,
`tests/`, `docs/schemas/`, `docs/adr/`, `fixtures/`, root config files (`package.json`,
`tsconfig.json`, `vitest.config.ts`, `biome.json`).
**Files read in full this session:** `src/physics/surface.ts`, `src/core/surface-types.ts`,
`tests/layering.test.ts`, `tests/no-google-pipeline.test.ts`, `docs/schemas/road-graph.v1.md`,
`docs/adr/0001-map-data-source.md`, `tests/road-graph-schema.test.ts`,
`fixtures/road-graph.sample.json`, `package.json`, `tsconfig.json`, `vitest.config.ts`,
`src/physics/telemetry/routines.ts`, `src/core/surface-tuning.ts`, `src/physics/surface-scene.ts`,
`biome.json`, `src/render/surface-view.ts` (partial), `src/main.ts`, `tests/docs-present.test.ts`.
**Pattern extraction date:** 2026-09-13
