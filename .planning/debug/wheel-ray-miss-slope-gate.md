---
status: diagnosed
trigger: "Shipped car loses wheel contact for one tick on slope-gate lanes (subdiv 2, climb 15 m/s dir -1, tick 2894, wheel 2) although terrain is within ray reach"
created: 2026-11-03
updated: 2026-11-03
---

## Current Focus

hypothesis: CONFIRMED H1 variant - parry heightfield ray cast misses rays that start within a few f32 ulps of a cell line (wrong start cell, stepping aborts)
test: candidate fix = build terrain collider as a trimesh with the identical triangulation (TERRAIN_DIAGONAL row0col1-row1col0)
expecting: zero lost ticks in full sweep at subdiv 1 and 2; flat regression + feel tests green; measure build cost for 666x666
next_action: awaiting user decision on fix option (A trimesh / B ray-only patch / C upstream); then gate fatal-by-default + summary update

## Symptoms

expected: all four wheels in contact on smooth slope terrain within ray reach (restLength 0.45 + radius 0.36 = 0.81 m)
actual: wheel 2 (rear-left) suspension length = 0.45 (rest; no hit) for exactly one tick, chassis at 0.935 m ride height, other three wheels in contact
errors: gate assertion (GATE_ENFORCE=1) on lost contact ticks
reproduction: GATE_ENFORCE=1 GATE_DIAG=1 npx vitest run tests/terrain-gate.test.ts ; baseline lane subdiv 2, climb 15 m/s dir -1, tick 2894, wheel 2
started: seen since 04.2 slope gate; subdiv 1 clean, subdiv 2 shows losses

## Eliminated

- hypothesis: lift-off blend causes it
  evidence: liftOff gain 0/5/10 doesn't change it (prior work)
  timestamp: pre-session
- hypothesis: ray reach / droop too short
  evidence: maxSuspensionTravel only clamps compression; longer rest length still hops between lanes; chaotic (prior work)
  timestamp: pre-session
- hypothesis: contact skin
  evidence: non-monotonic, hypersensitive (04.2 gate notes)
  timestamp: pre-session

## Evidence

- timestamp: 2026-11-03 probe 1 (tests/zz-raymiss.test.ts, throwaway)
  checked: replayed climb 15 m/s dir -1 subdiv 2; at each tick after vehicle.tick() (pose = the one updateVehicle raycast from) recorded hard point and cast independent rays
  found: tick 2894 wheel 2 hardPoint (940.825195, 0.993746, 377.99997), dir (0.0458,-0.9986,-0.0266), terrain 0.354 below => clearance 0.640 < reach 0.81. collider.castRay(same ray) MISSES; vertical ray MISSES; longer maxToi MISSES; offsets in x up to 0.1 m MISS; offsets in z of +-1e-4 m HIT at toi 0.789 (=0.639 m); origin moved 1 m back up the ray HITS at the right distance. HeightField with and without FIX_INTERNAL_EDGES both miss. world.castRay excluding chassis MISSES.
  implication: H1 confirmed. Not a controller filter/solid issue (H2 out): a bare collider.castRay misses. Not origin-below-surface (H3 out): origin 0.64 m above ground. z=377.99997 is exactly one f32 ulp below the row boundary z=378 (= -519 + 598*1.5).

- timestamp: 2026-11-03 micro test (tests/zz-hfmicro.test.ts, throwaway)
  checked: FLAT heightfield 692x400 cells, 1.5 m, same placement; short downward rays started 0..16 f32 ulps either side of row/col boundaries
  found: 122/4158 z-boundary rays MISS, 16/2880 x-boundary rays MISS (flat ground!). Same geometry as a trimesh (same triangles): 0/4158 miss.
  implication: parry heightfield ray cast picks the wrong start cell when the ray starts within a few ulps of a cell line (f32 rounding of the cell index), tests that cell's triangles (miss), then its cell-stepping gives up because the next-boundary toi is negative (ray heading away). Purely geometric/precision; independent of tuning. Explains: chaotic sensitivity (any 4th-decimal change moves which tick lands within an ulp), subdiv 2 worse than subdiv 1 (twice as many cell lines), hopping between lanes.

- timestamp: 2026-11-03 upstream check
  checked: @dimforge/rapier3d-compat 0.20.0 vs 0.21.0 (latest, 2026-09-25) in scratch dir, same probe
  found: both 122/4158 misses
  implication: not fixed upstream; an upgrade does not help.

- timestamp: 2026-11-03 wide sweep BEFORE (tests/zz-sweep.test.ts, throwaway; hill/bank/climb x 10,15,20,25,30 m/s x both dirs = 30 lanes per row)
  found: shipped s1 0, s2 1 (climb@15/-1); default s1 2, s2 1; plus 8 shipped variants with stiffness*(1+k*1e-4): s1 0,1,2,1,0,1,1,2 / s2 1,2,1,2,2,1,2,4. Total 27 lost ticks over 600 lane runs.

- timestamp: 2026-11-03 wide sweep with terrain collider as TRIMESH (identical triangles, FIX_INTERNAL_EDGES)
  found: 0 lost ticks in all 20 rows (600 lane runs), subdiv 1 and 2, shipped, default and all 8 perturbed variants.
  implication: every observed loss was the heightfield ray miss; counterfactual confirms the root cause.

- timestamp: 2026-11-03 cost of the trimesh fix
  found: 666x666 cells at 3 m (2 km map, 887k tris): heightfield build 3 ms vs trimesh 1060 ms (Node); gate subdiv-2 grid (554k tris) ~600 ms. Wide sweep runtime 29 s -> 203 s.
  implication: robust, but a ~1 s load hitch per terrain collider and large WASM memory; reverses 04.2-RESEARCH's heightfield-for-memory decision.

- timestamp: 2026-11-03 memory + suite with trimesh
  found: RSS +227 MB for the 666x666 trimesh (WASM memory never shrinks). Full suite with trimesh: 1797 pass; 6 fail, all structural (tests assert the terrain collider IS a heightfield / count TriMesh shapes / grep HeightFieldFlags in source); every feel, lift-off, flat-regression and terrain-gate test stays green.
  implication: geometrically and feel-neutral, but the load-time and memory cost is a product decision -> stop and report per fix policy. Patch saved at scratchpad trimesh-terrain-fix.patch; source reverted.

## Resolution

root_cause: Rapier 0.20.0 (and 0.21.0) / parry heightfield ray cast picks the wrong start cell when a ray starts within a few f32 ulps of a heightfield cell line (rounding in the cell-index computation). It tests that cell's triangles (miss) and its cell-stepping aborts because the next-boundary toi is negative, so the whole cast returns None. The vehicle controller's wheel ray (cast from the wheel hard point) occasionally lands within an ulp of a cell line -> one-tick contact loss. Tuning-independent; chaos comes only from which tick happens to land on a line; subdiv 2 has twice the cell lines of subdiv 1.
fix: NOT APPLIED (cost is a product decision). Proposed: build the terrain collider as a trimesh with the identical triangulation (diagonal row0col1-row1col0, body-local vertices, FIX_INTERNAL_EDGES). Proven 27 -> 0 lost ticks over 600 lane runs. Cost ~1.1 s build + ~227 MB for a 2 km/3 m map. Alternatives: (B) keep heightfield for contacts, add a small ray-only trimesh patch (collision groups interact with nothing) rebuilt around each vehicle; (C) upstream parry fix.
verification: probes + wide sweep (see Evidence)
files_changed: []
