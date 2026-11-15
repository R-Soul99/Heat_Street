# Phase 11: Art Pass - Context

**Gathered:** 2026-11-15
**Status:** Ready for planning
**Source:** Brief `.planning/plans-ahead/05-art-pass.md` (written from a code survey on 2026-11-15)

<domain>
## Phase Boundary

Two independent halves, no physics change in either:

- **Part A, car bodies:** shaped low-poly bodies and proper wheels in place of boxes and cylinders, per vehicle.
- **Part B, surface effects:** soft particles that grow and fade, rolling dust, roost, landing bursts, mud spray, and continuous tyre-track ribbons in place of blocky decals.

The brief is the specification. Its stages (A1 to A6, B0 to B5) map to plans roughly one to one. A and B can be planned as separate waves. Everything in the brief's Decisions section is locked unless marked ASK.

**Out of scope:** colliders, mass or wheel positions; scenery art (Phase 07.1.3); damage visuals (Phase 8); night lighting; physics debris.

</domain>

<decisions>
## Implementation Decisions

- **D-01:** Bodies are built in code first (extruded profiles and boxes, normalised to the collider box), with a glTF hook per vehicle for later. **Default pending user confirmation (ASK in brief D1).**
- **D-02:** The physics collider stays a box; the visual fits inside it.
- **D-03:** `CarMeshes.chassis` stays a single `THREE.Mesh` with material groups (paint, glass, trim, light); `setColor` changes paint only.
- **D-04:** Body styles: coupe, buggy, rally, pickup, monster. Generic shapes; no real designs or logos.
- **D-05:** Per car: at most 1,500 body triangles and 2 body draw calls.
- **D-06:** Effects: at most 12 FX draw calls, 1,500 live particles, no per-frame allocation; tyre tracks for at most 8 vehicles.
- **D-07:** Particles stay CPU-updated `THREE.Points`, with per-particle size and alpha added via `onBeforeCompile`; fallback is instanced quads. Decide in stage B1 and record which.
- **D-08:** Tyre tracks are ring-buffer ribbons; the `DecalGeometry` pool is removed once ribbons work on terrain and legacy maps.
- **D-09:** FX constants stay as an editable table in code, not in the tuning panel.
- **D-10:** `surface-fx.ts` is split first (stage B0) with its public exports unchanged.

### Claude's Discretion
Body profiles, colours, particle numbers, wave split.

</decisions>

<canonical_refs>
## Canonical References (MANDATORY reading before planning)

- `.planning/plans-ahead/README.md` - rules that apply to every plan
- `.planning/plans-ahead/05-art-pass.md` - current state, stages, tests, traps
- `src/render/vehicle-view.ts`, `src/render/ai-vehicle-view.ts`, `src/render/car-xray.ts`, `src/render/car-shadow.ts`
- `src/render/surface-fx.ts`
- `docs/frame-budget.md`
- `tests/layering.test.ts`
- `.planning/seeds/offroad-point-to-point-stages.md` (SURF-03 description)

</canonical_refs>

<specifics>
## Specific Ideas

- The user has no modelling skill; art source files live outside the repo (memory: repo-organisation).
- Keep rendering separable from mission logic for a later neon-wireframe reskin (memory: vr-challenge-mode-idea).
- Human check is short: one burnout, one drift, one loose-surface run, one jump.

</specifics>

<deferred>
## Deferred Ideas

- Bought or commissioned glTF car models (hook provided in stage A5)
- Damage states (Phase 8)
- Physics-based debris; water splashes at crossings; ruts in soft ground

</deferred>

---
*Context gathered: 2026-11-15 from .planning/plans-ahead briefs*
