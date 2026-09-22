# Phase 7: NPC Driving AI & Circuit Racers - Context

**Gathered:** 2026-09-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Delivers CIRC-02: AI racers that compete in Circuit mode at one fixed difficulty with no
rubber-banding. AI cars are the identical physics vehicle the player drives (built through the
same `createVehicle()` call, driven only through per-tick `InputFrame`s — nothing writes their
transforms), they race a smoothed line on the road, recover when stuck, and are observable via
an AI debug overlay. The AI field is a new **Circuit Race** mode that sits alongside the existing
solo Circuit time attack, so the Phase 6 medal system is untouched.

Out of scope: pursuers/police behavior (Phase 8), ambient traffic (WORLD-01, v2), AI in
Point-to-Point, new maps or new courses, additional car classes/drivetrains.

</domain>

<decisions>
## Implementation Decisions

### Field & Start
- **D-01:** Field is **3 AI racers + the player** (4-car race).
- **D-02:** AI racers drive the **exact same car and tune as the player**, recolored with a
  distinct paint per racer. No different car classes, no different bodies.
- **D-03:** Player starts at the **back of the grid**. AI occupy the three grid slots ahead.
- **D-04:** (Claude's call, user said "you decide") Circuit Race uses a **staggered grid behind
  the start line with a 3-2-1-GO countdown**; all cars launch on GO and the race timer starts on
  GO (sim-clock derived, per Phase 6 D-05). Solo Time Attack keeps Phase 6 D-04's
  start-on-first-movement unchanged.

### Modes, Medals & Placing
- **D-05:** **Separate modes.** The existing Circuit stays a solo Time Attack with its current
  medals, reference runs and saved bests — untouched. "Circuit Race" (with AI) is its own
  course card with its own persisted bests. Traffic can never pollute a medal time; this is how
  success criterion 5 ("adding AI changes nothing about the player's medal time") is met.
- **D-06:** Finishing position is **shown live and saved**: live position on the HUD, final
  place on the results view, and **best finish per course persisted** alongside best time for
  Circuit Race (same local-only, schema-versioned, corruption-tolerant persistence rules as
  Phase 6 D-07/D-09). No unlocks.
- **D-07:** When the player finishes, **AI keep driving until they finish**, and the final order
  is shown as they cross. The player can **interrupt at any moment to retry**; interrupting
  immediately projects the remaining AI's placings from race progress (lap + checkpoint +
  distance along path) and ends the race. Retry must keep the Phase 5 fast-retry feel.
- **D-08:** Player **respawn** (checkpoint reset): AI keep racing — the respawn costs the player
  time and positions. Full **restart**: everyone resets to the grid and the countdown reruns.

### AI Pace & Temperament
- **D-09:** One fixed difficulty at roughly **Silver pace** of the circuit's reference run: a
  clean Silver-level drive beats them, a messy one loses. Pace is fixed per race — no
  rubber-banding, catch-up, or speed multipliers anywhere in the code (CIRC-02, REQUIREMENTS
  anti-feature list).
- **D-10:** Temperament: **race their own line with mild avoidance** — they avoid rear-ending
  the player/other cars but do not yield, block or defend. Contact in tight corners is allowed to
  happen naturally. No deliberate ramming (that is Phase 8 PIT territory).
- **D-11:** AI follow a **smoothed racing line derived from the road graph**, cutting apexes
  within the road width (edge `widthM`) but never through scenery or off-road. No authored
  gravel shortcuts.
- **D-12:** AI aim for **tidy grip driving**. They slide when physics makes them (gravel,
  overcooked corners) and must recover, but they do not handbrake-drift or power-oversteer on
  purpose.

### Stuck Cars & Readability
- **D-13:** Stuck/flipped/wedged recovery: **first try to drive out** (a few seconds of
  reverse + steer-out), then if still stuck, **reset onto the road at its last checkpoint** —
  the same rule as the player's respawn, including the same time cost. Prefer performing
  resets while the car is off-camera.
- **D-14:** AI racers appear on the **existing minimap as dots colored to match their paint**,
  with edge blips when outside the minimap radius (same treatment as checkpoints, Phase 5 D-10).
- **D-15:** The `?debug` AI overlay shows **all four**: each AI's planned racing line (world
  space), current look-ahead target plus steer/throttle/brake values, a state label
  (racing / avoiding / recovering / reset) above each car, and a stuck/no-progress timer.
- **D-16:** Race HUD shows **position + lap + gap to car ahead** (e.g. `P3/4 · Lap 2/3 · +1.4s`),
  placed in/near the existing top-right timing area without colliding with the speedometer or
  split display.

### Claude's Discretion
- Countdown presentation and exact grid spacing/stagger (D-04).
- How Circuit Race is represented in course data — a new `CourseMode`, a race-variant flag on the
  existing circuit, or a separate course entry reusing the same checkpoints — provided solo
  Time Attack IDs, references and saved bests are not invalidated.
- The AI controller algorithm (pure-pursuit vs. other path-follower, speed-profile planning from
  path curvature, how Silver pace is calibrated), provided it outputs `InputFrame`s only and is
  deterministic on the fixed tick.
- Exact stuck thresholds and drive-out duration (D-13), AI paint colors (D-02/D-14).
- How the "gap to car ahead" is computed (time at shared progress points is preferred over
  distance) and what shows when the player is P1.

### Folded Todos
None — both matched todos were reviewed and deliberately left deferred (see `<deferred>`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 7: NPC Driving AI & Circuit Racers" — goal and 5 success criteria
- `.planning/REQUIREMENTS.md` — CIRC-02; the "Rubber-band/catch-up AI" anti-feature row; WORLD-01 (traffic stays v2)

### Prior phase decisions this builds on
- `.planning/phases/05-objectives-navigation-race-modes/05-CONTEXT.md` — course authoring, 3-lap circuit (D-13), minimap layout/style (D-09..D-12), fast-retry feel (D-15), respawn penalty
- `.planning/phases/06-medals-time-attack-loop/06-CONTEXT.md` — timer/sim-clock rules (D-04/D-05), persistence rules (D-07/D-09), results cards (D-08)

### Data & map
- `docs/schemas/road-graph.v1.md` — road graph schema (edge `widthM`, `lanes`, `oneway`, `surface`) the racing line derives from
- `docs/adr/0004-first-area-and-compiler-decisions.md` — first-area/compiler decisions
- `public/maps/juliette-ga.routes.json` — existing `juliette-three-lap-loop` circuit the AI will race
- `.planning/STATE.md` `[Phase 04.1, open]` items — known geometry-defect coordinates the AI line must not be steered through carelessly

### Vehicle & tuning
- `docs/vehicle-tuning-guide.md` — the shared tune AI cars must use unchanged
- `docs/frame-budget.md` — frame budget; 3 extra full vehicles must fit

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createVehicle(world, tuning, spawn)` (`src/physics/vehicle.ts`): explicitly generic ("Phase 7/8 constructs pursuers through this exact same call"); returns `tick(frame, tuning, surfaces)`, `resetPose`, `dispose`.
- `InputSource` / `InputFrame` (`src/core/input-tape.ts`): per-tick steer/throttle/brake/handbrake. An AI driver should be an `InputSource`, which structurally guarantees "no cheating".
- `src/physics/vehicle-assists.ts`: the player's assist layer; AI must receive the same assists.
- `findRoadPath`, `nearestRoadNode`, `buildNavigationGraph` (`src/core/navigation.ts`): ngraph.path routing on the road graph, basis for the racing line.
- `createRaceState` (`src/core/race-state.ts`): per-racer lap/checkpoint/wrong-way tracking, currently single-racer; candidates for per-car instances to derive placings.
- `detectCheckpointHit` (`src/core/checkpoint-detection.ts`), `poseForCheckpoint` in `src/gameplay/race-coordinator.ts`: reusable for AI checkpoint progress and resets (D-13).
- `createVehicleView` (`src/render/vehicle-view.ts`), `Minimap` (`src/hud/minimap.ts`), `RaceHud` (`src/hud/race-hud.ts`), `results-view.ts`, `medal-persistence.ts`.
- `src/debug/` (`debug-gate.ts`, `telemetry-hud.ts`, `nav-pointer.ts`): the `?debug` overlay home for D-15.

### Established Patterns
- Fixed-timestep sim clock; everything gameplay-relevant is derived from ticks, not wall-clock.
- Pure logic in `src/core/` (unit-tested with vitest), wiring in `src/gameplay/` and `src/main.ts`.
- Hand-authored, deterministic, well-commented data; mode selected via URL query (`?mode=circuit`) in `main.ts`.
- `CourseMode = "p2p" | "circuit"` in `src/core/course.ts`; medal references keyed by course ID.

### Integration Points
- `src/main.ts` (~line 294-350): course/mode selection, race state and coordinator construction; the loop's `onTickEnd` / `onRaceCommands` hooks.
- `src/loop.ts`: fixed tick where AI `InputSource`s must be sampled and AI vehicles ticked before `world.step()`.
- `src/gameplay/race-coordinator.ts`: currently single-racer; placing, countdown and finish/interrupt flow (D-07) connect here or in a sibling coordinator.

</code_context>

<specifics>
## Specific Ideas

- The user wants the finish to feel like a real race (watch the rest cross the line) but never
  at the cost of fast retry: interrupting to retry must be instant and project placings.
- "The clock is the opponent" stays true: medals live in solo Time Attack; Circuit Race is about
  placing.
- Juliette is "ok but very big and quite sparse". The long circuit legs (~650m/~943m) make AI
  racing less dense than ideal; accepted for this phase.

</specifics>

<deferred>
## Deferred Ideas

- **New maps:** a city map, plus small areas with short tracks. Juliette is big and sparse.
  Needs its own roadmap discussion (new phase/milestone). The user wants this discussed "at some
  point".

### Reviewed Todos (not folded)
- **Author a shorter, tighter course on the Juliette map** (`.planning/todos/pending/2026-09-22-author-a-shorter-tighter-course-on-the-juliette-map.md`): user chose to leave it for the new-maps discussion; Phase 7 races the existing `juliette-three-lap-loop`.
- **Support configurable drivetrain type per car class** (`.planning/todos/pending/2026-09-20-support-configurable-drivetrain-type-per-car-class.md`): not needed because AI drive the player's exact RWD car (D-02). Stays deferred for a future car-classes phase.

</deferred>

---

*Phase: 07-npc-driving-ai-circuit-racers*
*Context gathered: 2026-09-22*
