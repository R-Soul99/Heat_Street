# Phase 1: Engine Foundation - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the timing and rendering foundation every later system depends on: a fixed-timestep physics loop (Rapier) with render interpolation (Three.js), resilient to tab-away/focus-loss, observable through a profiler HUD against a written frame budget, wired together in a minimal debug scene. Also freeze the map-data sourcing decision and a draft road-graph schema in the repo before any map work starts (Phase 4). No vehicle feel, no surfaces, no camera, no map content — those are later phases.

</domain>

<decisions>
## Implementation Decisions

User deferred all Phase 1 gray areas to Claude's discretion (no meaningful user-facing product decisions in a pure-infrastructure phase). Recorded here as locked defaults so research/planning don't re-litigate them.

### Debug Scene Fidelity
- **D-01:** Debug scene is a bare physics test — one dynamic box (or a few) dropping/rolling onto a static flat plane collider. No vehicle-shaped placeholder yet; the vehicle controller is Phase 2's job and starting it here risks conflating "loop is correct" with "car feels right."
- **D-02:** The debug scene must still exercise render interpolation visibly (e.g., a spinning/falling body) so judder at 30/60/144fps is actually observable, per Success Criterion 2.

### Profiler HUD Depth
- **D-03:** Minimal-but-real HUD: physics step ms, render ms, draw calls, triangle count, active body count — all four are explicitly required by Success Criterion 4, so "minimal" still means all four, not fewer.
- **D-04:** Written frame budget target: 16.6ms total frame @ 60fps, with physics step budgeted at ≤4ms of that (leaves headroom for render + browser overhead). Record this budget in the HUD or an adjacent doc/comment so it's the thing the HUD is checked against, not an implicit assumption.
- **D-05:** Toggle key: a single dedicated key (e.g. backtick/`~` or F1) gated behind a `?debug` query param convention consistent with the later lil-gui tuning panel (per STACK research doc).

### Repo & Tooling Scaffold
- **D-06:** Single package (no monorepo) — the project is one deployable browser app with no separate publishable packages; a monorepo adds tooling overhead with no consumer.
- **D-07:** Package manager: npm (default, zero extra install, matches `npm pack`-based research already done in STACK.md). No strong reason to prefer pnpm/yarn for a solo-dev single-package project.
- **D-08:** Biome lint/format wired up in Phase 1, not deferred — cheap to add at project init, and catching style/type drift matters more once physics/render code starts accumulating in Phase 2+.

### Claude's Discretion
- Exact Vite config details (target: esnext, assetsInlineLimit: 0, optimizeDeps.exclude for Rapier) — follow STACK.md research doc directly, no open question.
- Directory layout under `src/` — Claude picks a structure during planning informed by RESEARCH.md.
- Whether the alt-tab resilience fix is a clamped accumulator vs. a max-substep cap — implementation detail, verified by Success Criterion 3 regardless of mechanism.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Technology Decisions
- `CLAUDE.md` — full stack research (Three.js r185, Rapier 0.20.0 non-compat, Vite 8.2.2, TypeScript 7.0.2), including the fixed-timestep-accumulator requirement, `@dimforge/rapier3d` (non-compat) package choice, and the explicit "what NOT to use" table (no `RapierPhysics.js`, no variable-timestep physics, no `-compat` package as default).

### Project Scope & Decisions
- `.planning/PROJECT.md` — vision, tech stack rationale, build-order phases
- `.planning/REQUIREMENTS.md` — VEH-03 (this phase's mapped requirement) and full traceability
- `.planning/ROADMAP.md` §"Phase 1: Engine Foundation" — goal, success criteria, requirements
- `.planning/STATE.md` — locked project-level decisions: map data source is OpenStreetMap + open DEM (zero Google-sourced bytes, P0 legal decision to freeze in this phase), fixed-timestep physics from Phase 1 is non-negotiable

No other ADRs/SPECs exist for this project yet — CLAUDE.md's stack research doc is the primary technical canon for this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

This is a greenfield project — no `src/`, no `package.json`, no prior code exists yet. Phase 1 is the first code written.

### Reusable Assets
- None yet.

### Established Patterns
- None yet — this phase establishes the first patterns (fixed-timestep loop, Rapier/Three bridge) that all later phases build on.

### Integration Points
- N/A — first phase.

</code_context>

<specifics>
## Specific Ideas

No specific ideas volunteered beyond what's captured in Decisions above — user explicitly deferred all gray areas to Claude's judgment.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Vehicle feel, surfaces, camera, map content, and everything else in ROADMAP.md remain correctly scoped to their own later phases.)

</deferred>

---

*Phase: 01-engine-foundation*
*Context gathered: 2026-09-08*
