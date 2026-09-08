# Phase 2: Vehicle Feel Core - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Phase Boundary

The player can drive one muscle car with a Rapier `DynamicRayCastVehicleController` that feels heavy, momentum-driven and slideable on a flat plane — controllable oversteer, readable braking consequences, stable landings off jumps, smooth keyboard/gamepad steering, a live speedometer, and a live-tunable handling panel validated by a scripted telemetry track. No surfaces, no camera work, no map content, no NPC AI behavior — those are later phases. This phase is also the project's flagged highest-risk spike: whether Rapier's raycast vehicle can reach an "arcade-realistic hybrid" feel at all.

</domain>

<decisions>
## Implementation Decisions

### Drift & Oversteer Control Scheme
- **D-01:** Dedicated handbrake input locks rear-wheel friction near-zero on press — a reliable, learnable drift-initiation trigger (Dukes of Hazzard/Bullitt-style handbrake turn). `InputFrame.handbrake` already exists from Phase 1 (currently ignored by design — see `src/physics/debug-scene.ts` comment) and should now be wired to the vehicle controller's rear-wheel side-friction-stiffness reduction.
- **D-02:** Handbrake is **binary** (on/off), not analog — simpler to tune, matches its role as a deliberate drift trigger rather than a fine-grained control. Keyboard: spacebar convention. Gamepad: a face button or bumper.
- **D-03:** A light arcade-assist layer helps the player catch/recover from a slide — a subtle stabilizing yaw torque proportional to `(desiredHeading − actualHeading)`, layered on top of the physics body per CLAUDE.md's documented mitigation. Not baked into friction values; a separate tunable assist strength.
- **D-04:** Late braking has a **visible** consequence: hard braking while turning reduces front grip and the car understeers/skids straight rather than merely lengthening stopping distance. This is a readable penalty for over-committing to a brake, not just a longer stopping distance.

### Feel Reference Anchor
- **D-05:** Primary feel reference is **Bullitt's Mustang chase** (film) — heavy, momentum-driven, hard body-roll through corners. This anchors the human-playtest sign-off in Success Criterion 5 ("reads as a heavy muscle car").
- **D-06:** For this phase specifically (physics/handling only — no audio/camera/surfaces yet), the top priority is **visible body roll and weight transfer** under cornering, braking, and acceleration — the chassis should read as heavy even before any slide happens. Favor lower suspension stiffness for visible dive/squat/roll per CLAUDE.md's guidance, over prioritizing momentum/line-commitment alone.
- **D-07:** Jump landings use an **auto-level assist** — a gentle in-air torque nudges the chassis toward level/wheels-down as it approaches the ground, guaranteeing a driveable landing per Success Criterion 3 regardless of takeoff angle. This is a distinct tunable assist from the slide-catch assist (D-03).
- **D-08:** Rollover resistance at the full-lock 60mph turn (Success Criterion 3) comes from an **arcade-assist layer** — a speed-scaled downforce impulse and/or anti-roll torque on top of the physics body — rather than relying solely on physical tuning (CoM, track width, suspension). This guarantees the no-roll requirement holds even as other tuning parameters drift during iteration.
- **D-09:** **Vehicle controller architecture must be generic/reusable, not player-hardcoded.** NPC pursuers/racers (Phase 7/8) will reuse the same vehicle controller class and tuned handling parameters for consistency in a chase — but this phase does NOT build NPC AI or the kinematic/full-physics LOD-switching itself (that belongs to Phase 7/8, informed by CLAUDE.md's existing guidance to run distant pursuers as a simplified kinematic model and only promote to full vehicle-controller physics near the player). Concretely: design the controller to take a car config in and produce a controller out, without assuming "the player" as the only caller.

### Speedometer / HUD Gauge
- **D-10:** Retro analog speedometer — a period-correct circular needle gauge (white numerals on black face, amber redline zone) with a small digital readout inset, matching the 60s-70s chase-cinema tone. (Corrected mid-discussion: an earlier turn recorded "modern neutral HUD gauge" by mistake — retro analog is the locked decision.)
- **D-11:** Units: **mph** (matches the American muscle-car setting and the mph figures already used in ROADMAP.md, e.g. "120mph ramp jump").
- **D-12:** Placement: **bottom-right corner**, needle range **0–160mph** (headroom above the 120mph ramp-jump target without pinning at redline during normal driving).
- **D-13:** The digital numeric readout uses **slight damping/smoothing** to avoid jitter from physics noise; the needle itself may move instantly/unsmoothed.

### Telemetry Targets & Tuning Panel
- **D-14:** Scripted telemetry track (0-60, braking, skidpad, slalom, ramp) pass/fail targets are grounded in **real-ish muscle-car performance figures** — roughly 6–7s 0-60mph, ~120ft 60-0mph braking distance — not arcade-exaggerated numbers. This grounds the "weighty" feel in period-correct performance while corners/slides can still be tuned arcade-loose.
- **D-15:** The lil-gui live tuning panel is a **dev tool only**, gated behind the existing `?debug` query-param convention from `src/debug/debug-gate.ts` (per the D-01/D-05 pattern noted in Phase 1's STATE.md decisions). It is never player-facing — consistent with REQUIREMENTS.md's Out of Scope entry ruling out player-facing performance tuning/customization (it would break medal-time comparability).
- **D-16:** Expose **all** candidate tuning parameters from day one, not a curated subset — mass/CoM, suspension stiffness, friction slip, side-friction stiffness, engine force, PLUS the new arcade-assist strengths introduced by this phase's decisions (slide-catch yaw assist D-03, jump auto-level D-07, anti-roll/downforce D-08, handbrake rear-friction drop D-01). Success Criterion 5 explicitly requires "no code edit" retuning with a full telemetry re-verification pass, so every relevant knob should be live from the start.
- **D-17:** Tuning panel values **persist across page reloads via localStorage**, with a "reset to defaults" button for the rare case of wanting a clean slate. Avoids losing an in-progress tuning session on every Vite HMR refresh.

### Claude's Discretion
- Exact vehicle controller wheel geometry (track width, wheelbase, wheel radius) and chassis mass/CoM starting values — informed by RESEARCH.md and CLAUDE.md's example tuning table, tuned against D-14's telemetry targets.
- Exact implementation mechanism for each assist layer (D-03, D-07, D-08) — magnitude curves, speed-scaling functions, and whether they're implemented as post-step torque/impulse application or another mechanism — as long as they satisfy the relevant success criteria.
- Directory/module layout for the vehicle controller code under `src/physics/` and `src/vehicle/` (or similar) — Claude picks a structure informed by RESEARCH.md and Phase 1's existing layering conventions (`src/physics/` may not import `three`).
- Exact retro-gauge visual details (font, needle shape, tick marks, redline start point) — D-10 sets the direction, execution details are Claude's call.
- Whether the scripted telemetry track is a standalone test scene, a debug-mode overlay, or a CLI/test-runner script — as long as it's re-runnable with no code edit per Success Criterion 5.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack & Vehicle Physics
- `CLAUDE.md` — full stack research including the Rapier `DynamicRayCastVehicleController` API surface, tuning-constant starting table (mass, suspension stiffness, friction slip, engine force, wheel offsets), the arcade-assist layering mitigation for the drift/on-rails tension, and the NPC kinematic-LOD guidance ("run distant pursuers on a simplified kinematic model... promote to full physics only within a radius of the player").

### Project Scope & Decisions
- `.planning/PROJECT.md` — vision, reference touchstones (Bullitt, Vanishing Point, etc.), "arcade-realistic hybrid" handling target, open benchmark research item
- `.planning/REQUIREMENTS.md` §Vehicle & Handling (VEH-01, VEH-02, VEH-04) and §Navigation & HUD (NAV-01) — this phase's mapped requirements; also §Out of Scope for the "no player-facing tuning" constraint (D-15)
- `.planning/ROADMAP.md` §"Phase 2: Vehicle Feel Core" — goal, success criteria, requirements, MVP mode
- `.planning/STATE.md` — locked project-level decisions, including "Rapier's raycast vehicle can reach the arcade-realistic hybrid feel" flagged as this phase's spike risk (not an assumption)

### Prior Phase Foundations (Phase 1)
- `.planning/phases/01-engine-foundation/01-CONTEXT.md` — D-05 debug-toggle convention (`?debug` + dedicated key) that this phase's tuning panel must reuse (D-15)
- `src/core/sim-clock.ts` — the fixed-timestep clock (`DT = 1/60`) the vehicle controller must step against; do not introduce a second timing source
- `src/physics/debug-scene.ts` — the Phase 1 placeholder scene being replaced this phase; note the `applyInput` comment explicitly marking `handbrake` as "ignored in Phase 1; Phase 2 wires it to the vehicle controller's rear-wheel friction" (confirms D-01)
- `src/physics/world.ts`, `src/physics/transform-cache.ts`, `src/render/interpolator.ts`, `src/render/renderer.ts` — existing physics/render bridge layering conventions (`src/physics/` must not import `three`) that the vehicle controller and gauge HUD should follow
- `src/debug/debug-gate.ts`, `src/debug/profiler-hud.ts` — existing `?debug` + hotkey pattern and HUD conventions the lil-gui tuning panel (D-15) and speedometer (D-10–D-13) should follow

No other ADRs/SPECs apply to this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/sim-clock.ts` (`SimClock`, `DT`) — the fixed-timestep source of truth; vehicle physics must step on this, not a new clock.
- `src/core/input-tape.ts` (`InputFrame`) — already defines `handbrake`, `throttle`, `brake`, `steer` fields; the vehicle controller consumes this directly, no input-plumbing changes needed.
- `src/debug/debug-gate.ts` — the `?debug` query-param + hotkey gate this phase's tuning panel and any new debug displays must reuse (per D-15 and Phase 1's D-05).
- `src/debug/profiler-hud.ts` — existing DOM-overlay HUD pattern (physics ms, render ms, draw calls) to follow for the speedometer gauge's DOM/CSS approach (per CLAUDE.md's "HUD → absolutely-positioned HTML/CSS, pointer-events: none" guidance).
- `src/render/interpolator.ts`, `src/physics/transform-cache.ts` — render interpolation pipeline the vehicle chassis mesh should plug into like the Phase 1 debug bodies did.

### Established Patterns
- Physics/render layering: `src/physics/` never imports `three` or touches the DOM/wall clock; `src/render/` owns all mesh/interpolation work. The vehicle controller and wheel visuals must follow this same split.
- Dense index-order contract between physics bodies and render meshes (see `01-PATTERNS.md` R2, referenced in `debug-scene.ts`) — the vehicle's wheel/chassis mesh array should follow the same ordering discipline if reused patterns apply.
- `?debug` + dedicated hotkey convention for anything developer-facing (tuning panel, telemetry track trigger).

### Integration Points
- `src/physics/debug-scene.ts` is the direct replacement target — this phase's vehicle scene supersedes it (the box/spinner scene was explicitly built as a placeholder, not a foundation to extend).
- `src/loop.ts` / `src/main.ts` — the fixed-timestep game loop wiring where the vehicle controller's `world.step()` call and per-tick input application must be hooked in, following the same `preTick`/`applyInput` shape debug-scene.ts already established.

</code_context>

<specifics>
## Specific Ideas

- Bullitt's Mustang chase is the explicit feel touchstone (D-05) — visible body roll/weight transfer over pure momentum (D-06).
- Retro analog speedometer, bottom-right, 0–160mph, mph, slight damping (D-10–D-13) — deliberately corrected mid-discussion from an initially mis-recorded "modern" style, so this should not be second-guessed by downstream agents as ambiguous.
- Real-world-grounded telemetry numbers (~6-7s 0-60, ~120ft braking) as the pass/fail bar (D-14), even though corners/slides stay arcade-loose.
- NPC vehicles will eventually share this phase's vehicle controller and tuning (D-09) — build it generically now to avoid a Phase 7/8 rewrite, but do not build any NPC AI behavior in this phase.

</specifics>

<deferred>
## Deferred Ideas

- NPC/pursuer AI driving logic and the kinematic-vs-full-physics LOD switching for distant pursuers — belongs to Phase 7 (AI racers) and Phase 8 (Getaway/heat pursuers). Only the requirement that the vehicle controller be built generically (D-09) applies now.
- Player-facing handling/assist settings (e.g. an accessibility "assist strength" slider) — explicitly out of scope for v1 per REQUIREMENTS.md; the tuning panel stays dev-only (D-15).

None else — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-vehicle-feel-core*
*Context gathered: 2026-09-08*
