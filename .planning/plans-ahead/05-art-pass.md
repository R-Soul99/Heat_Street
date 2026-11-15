# Plan 5: Art pass (car bodies and surface effects, SURF-03)

Read `README.md` in this folder first. Do Plan 3 first if possible: bodies are
made per vehicle, and effects scale with vehicle size.

## Goal

Cars stop being boxes on wheels, and the dust, smoke and tyre marks look like
dust, smoke and tyre marks. Physics does not change at all.

**When it is done the user sees:** each vehicle has a recognisable low-poly
body (bonnet, cabin, boot or bed, bumpers, lights) and proper wheels with
tyres and hubs; soft round smoke and dust in place of square sprites; a dust
trail on loose ground when moving, roost behind the driven wheels, a burst of
dust on landing; smooth continuous tyre tracks in place of blocky decals.

This plan has two independent halves. Part A (bodies) and Part B (effects) can
be done in either order or by different sessions.

## Current state

- `src/render/vehicle-view.ts` `buildCarMeshes(wheelRadius, halfTrack,
  halfWheelbase, chassisHalfExtents, chassisColor)` returns `CarMeshes`:
  `chassis` (one `THREE.Mesh`, a `BoxGeometry` with one
  `MeshStandardMaterial`), `wheelMeshes` (four cylinders, children of the
  chassis, FL FR RL RR), `updateWheels(vc)`, `dispose()`.
- Things that assume the chassis is **one mesh with one material**:
  `src/render/ai-vehicle-view.ts` `setColor` (casts the chassis to a mesh and
  sets its material colour; used for pursuit role colours);
  `src/render/car-xray.ts` and `src/render/car-shadow.ts` (read both before
  changing the chassis); the interpolator, which moves the chassis object.
- `src/render/surface-fx.ts`: six `THREE.Points` systems (one per surface)
  with a shared canvas puff texture, `PARTICLE_POOL_SIZE` 96 each;
  `SURFACE_FX_PROFILES` per surface; particles are spawned only when a wheel's
  slip exceeds the surface's `slipThreshold`. Skid marks are a ring buffer of
  48 `DecalGeometry` meshes, each spawn allocating a new geometry, spaced at
  least 1 m apart. That spacing and the square decals are why marks look
  blocky. `TerrainDecalTarget` gives `meshAt` and `heightAt` for terrain maps.
- `createSurfaceFx(zoneMeshes, zoneSurfaces, terrainTarget?)`; `update(wheels,
  dtMs)` takes one wheel list (the player's four wheels). AI cars make no
  effects today.
- The file header explains why the FX constants are not in the tuning panel.
  Keep that decision.
- Frame budget (`docs/frame-budget.md`): draw calls under 80, triangles under
  90,000, render CPU under 6 ms. Juliette peaks near 65 draws.
- Asset pipeline rules (`CLAUDE.md`): low-poly, silhouette and colour over
  detail; glTF with Meshopt, never Draco; car models imported with
  `import url from "./assets/x.glb?url"`; `assetsInlineLimit: 0`; no real
  makes or logos. Only `src/render/map-view.ts` uses `GLTFLoader` today.
- The user has no modelling skill, and art source files live outside the repo
  in OneDrive (see memory "repo-organisation").

## Decisions

- **D1. Bodies are built in code first** (procedural low-poly: extruded side
  profiles and boxes), behind a small interface that a glTF model can replace
  later per vehicle. Reasons: no modelling skill in-house, fits the
  code-driven workflow, instantly matches whatever proportions the tuning
  gives, and unblocks everything else. **ASK:** the user may prefer to buy or
  commission glTF models instead. Default: procedural now, with the glTF hook
  in place (stage A5).
- **D2. The physics collider stays a box.** The visual body is fitted inside
  the collider's half extents (may overhang by at most 5 cm at bumpers). No
  collider, mass or wheel position changes in this plan.
- **D3. `CarMeshes.chassis` stays a single `THREE.Mesh`** at the body origin:
  the body geometry is merged into one `BufferGeometry` with **material
  groups** (paint, glass, trim, lights). `setColor` changes the paint
  material only. This keeps the interpolator, x-ray and shadow code working
  with small changes instead of a rewrite.
- **D4. Body styles** (generic, period-flavoured, no real designs):
  `coupe` (muscle car: long bonnet, fastback), `buggy` (open frame, exposed
  rear engine box, roll cage bars), `rally` (short hatchback, roof lights),
  `pickup` (cab and open bed), `monster` (pickup body lifted on a visible
  frame). Each vehicle class names a style and a paint colour.
- **D5. Budgets per car:** at most 1,500 triangles and 2 draw calls for the
  body (opaque and glass), plus wheels as one instanced or merged draw. With
  up to 60 pursuers that is the limit that matters; measure it.
- **D6. Effects budget:** total FX draw calls at most 12; total live particles
  at most 1,500; no per-frame allocation in `update`. Tyre tracks: one draw
  call per vehicle that has them, capped at 8 vehicles (the player plus the 7
  nearest).
- **D7. Particles stay CPU-updated `THREE.Points`** with `PointsMaterial`, as
  now, but with a soft round texture, per-particle size growth and fade. That
  needs per-particle size and alpha, which `PointsMaterial` does not offer;
  use `onBeforeCompile` to add `size` and `alpha` attributes rather than a
  full custom `ShaderMaterial` (the stack notes say to avoid custom shader
  materials). If `onBeforeCompile` proves fragile on three r185, fall back to
  an `InstancedMesh` of camera-facing quads with `MeshBasicMaterial` and
  per-instance colour (alpha baked into colour against additive or
  premultiplied blending). Decide in stage B1 and record which.
- **D8. Tyre tracks are ribbons**, one growing triangle strip per wheel in a
  preallocated ring buffer, vertices laid on the ground height. This replaces
  the `DecalGeometry` pool (and removes its per-spawn allocation).

## Part A: Car bodies

### Stage A1: Body builder (pure geometry data)

Files: `src/core/car-body-shapes.ts` (new, pure: plain numbers only),
`tests/car-body-shapes.test.ts`.

1. Define a body as data: a list of parts, each
   `{ kind: "extrude", profile: [z, y][], halfWidth, taper?, group }` or
   `{ kind: "box", center, halfExtents, group }` or
   `{ kind: "bar", from, to, radius, group }`, where `group` is
   `"paint" | "glass" | "trim" | "light"`. Coordinates are **normalised** to
   the collider box (-1 to 1 on each axis), so one style fits any proportions.
2. `bodyStyle(id)` returns the parts for each D4 style. Author the side
   profile as 8 to 14 points per style (bonnet line, windscreen, roof, rear).
   The front of the car is -Z (rule: forward is -Z).
3. `buildBodyMesh(style, halfExtents)` returns
   `{ positions, normals, indices, groups: [{ start, count, group }] }` as
   typed arrays, flat-shaded (duplicate vertices per face so the low-poly
   facets read clearly from the helicopter camera).
4. Tests: every vertex lies within the half extents plus 5 cm; triangle count
   under 1,500 per style; indices in range; front lights are at -Z; groups
   cover all indices exactly once.

### Stage A2: Use it in `buildCarMeshes`

Files: `src/render/vehicle-view.ts`, `src/render/ai-vehicle-view.ts`,
`src/core/vehicle-class.ts`, tests (`tests/ai-vehicle-view.test.ts`,
`tests/vehicle-scene.test.ts` and any test that inspects the chassis mesh).

1. Add an optional last parameter `opts?: { bodyStyle?: BodyStyleId }` to
   `buildCarMeshes`. With no style it builds the box exactly as today (tests
   that expect a `BoxGeometry` keep passing).
2. With a style: build one `BufferGeometry` from `buildBodyMesh`, add geometry
   groups, and use a material array `[paint, glass, trim, light]`
   (`MeshStandardMaterial`; glass dark and slightly transparent is fine but
   keep `transparent: false` unless measured cheap; lights emissive).
3. `dispose()` disposes all materials.
4. `VehicleClassSpec` gains `bodyStyle`. `main.ts` passes it for the player;
   AI cars get `coupe`.
5. `setColor` in `ai-vehicle-view.ts`: set the **paint** material only (index
   0 of the array, or the single material when there is no style).
6. Read `car-xray.ts` and `car-shadow.ts` and adapt whatever assumes a single
   material. The x-ray silhouette should still be the whole body.

Done when: `npm run check` is green and `?car=rwd` shows a shaped coupe.

### Stage A3: Wheels

File: `src/render/vehicle-view.ts`.

1. Replace the plain cylinder with a merged wheel geometry: tyre (dark, 12 to
   16 segments, slightly rounded shoulder), hub (lighter disc), and 5 simple
   spokes or a hubcap disc so wheel spin is visible. One geometry, two
   material groups, shared by a car's four wheels as today.
2. Width scales with radius; the monster truck gets a much wider tyre
   (width about 0.9 of radius against 0.6 now).
3. Keep the wheel rig (`updateWheels`) and index order untouched. If Plan 3
   added a rear radius, honour it.

### Stage A4: Small details that sell it

Still inside the merged body and its budget: bumpers, a grille block,
headlights and tail lights (emissive group), side windows. Brake lights: make
the tail-light material brighter while braking. That needs one boolean per
frame from sampled vehicle state; pass it through the existing view update
path, never by reading physics from `src/render/` (layering).

### Stage A5: glTF hook (no models required)

File: `src/render/car-model-loader.ts` (new).

1. `loadCarBody(url): Promise<THREE.BufferGeometry-with-groups>` using
   `GLTFLoader` with `MeshoptDecoder` (see how `map-view.ts` sets the loader
   up). It must return the same single-mesh, material-groups shape as stage
   A2 by merging the model's meshes and mapping material names `paint`,
   `glass`, `trim`, `light` to groups.
2. A style can name a model URL; if loading fails or no URL is set, the
   procedural body is used. Log the failure once.
3. Write `docs/car-models.md`: the contract for a model (origin at the
   collider centre, front at -Z, metres, four material names, triangle limit,
   no wheels in the body file, no real designs or logos), and the
   `gltf-transform` optimise command from `CLAUDE.md`.

### Stage A6: Measure

`?pursuers=20&debug` on `grid-test`: draw calls, triangles and render ms
before and after. Record in `docs/frame-budget.md`. If over budget, merge
each car's glass into the paint draw (drop to one material) for AI cars only.

## Part B: Surface effects

### Stage B0: Split the file first (no behaviour change)

`src/render/surface-fx.ts` is 724 lines doing two jobs. Split into
`src/render/fx/particles.ts`, `src/render/fx/tyre-marks.ts` and a thin
`surface-fx.ts` that keeps the existing exports (`createSurfaceFx`,
`SURFACE_FX_PROFILES`, the types) so `main.ts` and tests do not change. Run
the existing FX tests; they must pass unmodified.

### Stage B1: Soft particles with growth and fade

File: `src/render/fx/particles.ts`.

1. Texture: replace the current puff with a soft radial gradient with a
   slightly irregular edge (draw 5 to 7 overlapping soft circles on the
   canvas). Round, no visible square.
2. Per-particle `size` and `alpha` attributes per D7. Size grows from
   `particleSizeM` to `particleSizeM * growth` over life; alpha eases in over
   the first 10 percent and out over the last 60 percent.
3. Add to `SurfaceFxProfile`: `growth` (1.5 to 4), `spreadMps` (sideways
   drift), `startAlpha`. Fill in all six surfaces; tarmac smoke grows and
   thins, dust grows large and hangs, mud stays small and falls.
4. Depth: `depthWrite: false`; sort is not needed for this look.
5. Decide D7's approach here. Test in the browser on three r185 before
   building on it; write one line in the file header saying which approach
   was chosen and why.

Done when: smoke and dust read as soft clouds from the helicopter camera.

### Stage B2: More reasons to emit

Files: `src/core/fx-emission.ts` (new, pure, tested), `src/render/fx/particles.ts`,
`src/main.ts`.

Today particles appear only when sliding. Add, as pure functions returning an
emission rate per wheel from plain inputs:

1. **Rolling dust** on `gravel`, `dirt_road`, `sand`: rate rises with ground
   speed above 5 m/s, even with no slip. None on tarmac, grass or mud.
2. **Roost** behind **driven** wheels on loose surfaces: rate and backward
   launch speed rise with drive force and wheel slip. Needs which wheels are
   driven (from `frontDriveShare`) and throttle; add those to
   `SurfaceFxWheelInput` as optional fields.
3. **Landing burst**: when a wheel goes from airborne to grounded with a
   downward speed above a threshold, emit a one-off burst sized by impact
   speed. Needs the previous grounded state (keep it inside the FX module) and
   vertical speed (new optional input).
4. **Mud spray**: on `mud`, small dark fast particles with strong gravity.
5. Scale every rate and size by a per-vehicle `fxScale` (1 for the car, about
   0.8 buggy, 1.4 pickup, 2.5 monster) from the class spec.

Tests for each function: zero on tarmac, monotonic with speed, capped.
Cap total emission per frame so a field of cars cannot exceed D6.

### Stage B3: Tyre-track ribbons

File: `src/render/fx/tyre-marks.ts`.

1. One ribbon per wheel: a preallocated `BufferGeometry` with room for
   `N` segments (start with 256 per wheel), used as a ring buffer with
   `setDrawRange` and index wrap. All four wheels of a car share one geometry
   and one draw call.
2. While a wheel is grounded and marking (sliding on tarmac, or rolling on
   soft ground), every 0.25 m of travel append two vertices: left and right
   of the contact point, perpendicular to the wheel's travel direction, half
   a tyre width each side, at ground height plus 2 cm. Ground height comes
   from `TerrainDecalTarget.heightAt` on terrain maps, and from the wheel
   contact height otherwise.
3. When marking stops, end the strip (write a degenerate segment) so separate
   skids are not joined by a stray triangle.
4. Colour and opacity per surface from the existing `decalColour` and
   `DECAL_MAX_OPACITY`; fade by age with a per-vertex alpha (vertex colours
   with `transparent: true`, `depthWrite: false`, `polygonOffset` to avoid
   z-fighting with the terrain).
5. Tracks on soft ground (sand, mud, dirt) are darker and wider, and last
   longer; on tarmac they appear only above the slip threshold.
6. Remove the `DecalGeometry` pool once ribbons work on both terrain and
   legacy maps, and remove the "one per-spawn allocation" note from the
   header. Keep the public `createSurfaceFx` signature.
7. Test the pure parts (ring-buffer indexing, strip breaks, vertex placement)
   by factoring them into `src/core/tyre-track.ts`.

Done when: a long drift leaves two smooth continuous curved black lines, and
driving across sand leaves visible tracks.

### Stage B4: Effects for other cars

File: `src/main.ts`, FX module.

`update` takes one wheel list today. Accept a list of vehicles
`{ wheels, fxScale }[]`: the player plus the nearest AI or pursuer cars up to
the D6 cap. Particles are pooled across vehicles within the same per-surface
systems; ribbons are per vehicle. Measure with `?pursuers=20`.

### Stage B5: Measure and record

Frame time, draw calls and triangles on `juliette-ga` and on a dusty terrain
map with pursuers, before and after. Update `docs/frame-budget.md`. If over:
lower pool sizes first, then the vehicle cap.

## Human check (short)

1. `?map=feel-test&car=rwd`: look at the car, do one burnout, one long drift
   on tarmac, one run across the gravel and sand bands, one jump. Questions:
   does the car look like a car, does the smoke look like smoke, are the tyre
   marks smooth lines?
2. One other vehicle from Plan 3, same thing, 30 seconds.
3. `?debug`: frame time normal.

## Traps

- **No physics changes.** If a test in `tests/vehicle*.test.ts` or
  `tests/determinism.test.ts` changes result, something leaked.
- **Layering.** `src/render/` may not import rapier or write simulation
  state. `tests/layering.test.ts` bans specific identifiers; read it before
  adding inputs. New inputs arrive as plain sampled values.
- **`update` runs on the render frame with a variable delta**, not the fixed
  tick. Emission must be rate times delta, with a carried remainder, or
  effects change with frame rate.
- **No allocation per frame.** Use module-level scratch vectors as the
  existing code does.
- **Single-mesh chassis assumption** (D3). A `THREE.Group` body will break
  `setColor`, x-ray and shadow in ways typecheck will not catch because of
  the casts.
- **Flat shading needs unshared vertices**; do not rely on
  `flatShading: true` plus merged vertices if normals are supplied.
- **Front is -Z.** A body built facing +Z drives backwards visually.
- **Z-fighting of tracks on terrain**: the terrain view and collider share
  triangles; sample the same height function and add the small offset.
- **Do not put FX constants in the tuning panel** (see the header of
  `surface-fx.ts`). Edit the profile table; Vite hot-reloads it.
- **Shadows cost draw calls.** Particles and tracks never cast shadows.
