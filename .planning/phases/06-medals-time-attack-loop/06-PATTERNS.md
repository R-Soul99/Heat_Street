# Phase 6: Medals & Time-Attack Loop - Pattern Map

**Mapped:** 2026-09-21  
**Files analyzed:** 15 existing source/test/content files; Phase 6 new files inferred from CONTEXT.md  
**Analogs found:** 15 / 15 for the requested pattern areas

## Scope Read

Phase 6 CONTEXT.md is the controlling brief. It requires a deterministic run timer, four medal tiers, persistent best results keyed by stable course ID, live checkpoint splits, post-run sector breakdowns, and P2P/Circuit sharing one pure timing contract. It explicitly excludes new courses, AI, ghosts, customization, online leaderboards, and Getaway systems.

Phase 6 `RESEARCH.md` is the primary research source. The pattern map also uses the canonical references in `06-CONTEXT.md`, the Phase 5 research/implementation, and the existing test suite.

## File Classification

The exact Phase 6 filenames remain a planning decision. The table below names the smallest likely surface and distinguishes files that should be extended from files that should be created.

| New/Modified File | Role | Data Flow | Closest Analog | Recommendation |
|---|---|---|---|---|
| `src/core/medal-timing.ts` | new pure domain utility/contract | transform + event-driven accumulation | `src/core/race-state.ts`; `src/core/sim-clock.ts` | Create. Own reference bands, effective time, sectors, splits, completion freeze; do not add timing policy to HUD or physics. |
| `src/core/medal-persistence.ts` | new persistence/validation utility | file-I/O boundary / transform | `src/core/vehicle-tuning.ts`; `src/core/tuning-snapshot.ts` | Create. Parse raw storage strings, validate version/course IDs/finite times, ignore bad entries without touching unrelated progress. |
| `src/core/course.ts` | model/content parser | batch transform | `src/core/course.ts` itself; `tests/course-data.test.ts` | Extend only if reference times/medal metadata are part of the validated course contract. Keep stable `Course.id` as the key. |
| `public/maps/juliette-ga.routes.json` | deterministic content | file-I/O / batch input | existing route sidecar | Extend only for authored reference-run metadata if it belongs with course content; otherwise create a separate versioned medal reference sidecar to keep route identity stable. |
| `src/core/race-state.ts` | pure state machine | event-driven fixed-tick state | existing `createRaceState()` | Extend minimally for attempt start/completion/lap-checkpoint identity and immutable snapshot fields; preserve current P2P/Circuit ordering, restart, respawn penalty, and `effectiveTimeSec()`. |
| `src/gameplay/race-coordinator.ts` | controller/integration boundary | event-driven fixed-tick to render snapshot | existing `onTickEnd()` / `refresh()` | Extend. This is the checkpoint event boundary for recording sectors and publishing a completed result; do not make the coordinator calculate threshold policy. |
| `src/hud/race-hud.ts` | DOM component/presenter | request-response snapshot updates | existing `RaceHud` factory/update/dispose | Extend. Add timer, threshold, split-source, live delta, and results rendering through plain snapshots; retain DOM-only ownership and restart flash. |
| `src/main.ts` | composition root | request-response wiring | existing map/course/race construction and `startLoop()` call | Extend. Load/validate reference content and persistence, inject timing/result dependencies, and keep `startLoop()` as the sole loop owner. |
| `src/hud/results-view.ts` or `src/hud/race-hud.ts` | new DOM component, only if result table exceeds HUD scope | request-response snapshot | `src/hud/race-hud.ts`; `src/hud/minimap.ts` | Prefer extending `race-hud.ts` first. Create a separate view only if results/course cards need a persistent level-select surface rather than a post-run overlay. |
| `tests/medal-timing.test.ts` | pure contract test | deterministic batch assertions | `tests/race-state.test.ts`; `tests/sim-clock.test.ts` | Create. Cover bands, first movement, fixed-clock elapsed time, penalty, frozen completion, split deltas, lap/checkpoint identity, and slowest-sector selection. |
| `tests/medal-persist.test.ts` | persistence security/contract test | file-I/O boundary | `tests/tuning-persist.test.ts`; `tests/tuning-snapshot.test.ts` | Create. Cover round trip, malformed input, wrong version, unknown course IDs, non-finite/negative values, partial corruption, and preservation of valid unrelated courses. |
| `tests/race-state.test.ts` | pure state-machine regression test | event-driven state | existing race fixture and tests | Extend. Add deterministic start/completion/restart/respawn assertions without duplicating medal formula tests. |
| `tests/course-data.test.ts` / `tests/route-validation.test.ts` | parser/content fixture tests | batch transform | existing fixture and real-artifact tests | Extend only if course/reference schema changes; keep `fixtures/road-graph.sample.json` for unit tests and `?raw` imports for shipped artifacts. |
| `tests/race-coordinator.test.ts` or focused coordinator test | integration/controller test | fixed-tick event boundary | `src/gameplay/race-coordinator.ts`; existing pure race tests | Create only if split capture cannot be proven through pure state tests. Use fakes for scene/HUD/chime and assert one event per checkpoint boundary, not DOM pixels. |

## Pattern Assignments

### `src/core/medal-timing.ts` (new pure contract, transform + event-driven)

**Analogs:** [src/core/sim-clock.ts](src/core/sim-clock.ts#L13-L94), [src/core/race-state.ts](src/core/race-state.ts#L1-L177)

**Clock source pattern** ([src/core/sim-clock.ts](src/core/sim-clock.ts#L87-L94)):

```typescript
get simTimeSec(): number {
  return this.tick * DT;
}
```

Use the injected fixed-tick time or `SimClock.simTimeSec`; never call `Date.now()`, `performance.now()`, or receive render `dtMs` as elapsed run time. The authoritative attempt time should be a deterministic function of the tick clock, with the existing respawn penalty added separately.

**State-machine shape** ([src/core/race-state.ts](src/core/race-state.ts#L9-L25), [src/core/race-state.ts](src/core/race-state.ts#L63-L177)):

```typescript
export interface RaceSnapshot {
  readonly mode: Course["mode"];
  readonly currentTargetId: string | null;
  readonly visitedIds: readonly string[];
  readonly complete: boolean;
  readonly penaltySec: number;
}

export function createRaceState(course: Course, navigation: NavigationGraph): RaceState {
  let complete = false;
  let penaltySec = 0;
  // Mutate closure-owned state; expose immutable snapshots.
}
```

Follow the closure-owned mutable state plus immutable snapshot pattern. Add explicit attempt fields rather than deriving them from DOM state: `started`, `startTick`/elapsed baseline, `completed`, `finalEffectiveTimeSec`, and sector records. Completion must freeze the effective time and medal so later render frames or stale vehicle movement cannot change the result.

**Formula recommendation:** keep the four bands in one exported, versioned tuning contract. Given reference time $R$, use Ace `<= 0.90R`, Gold `<= 1.00R`, Silver `<= 1.15R`, Bronze `<= 1.35R`, otherwise no medal. Use named constants/types and pure functions so every course/mode shares the same policy. Do not hardcode unrelated thresholds in route JSON or HUD rendering.

**Attempt boundary recommendation:** first meaningful movement starts the timer in fixed-tick state. Respawn increments the existing penalty while leaving `SimClock` untouched; restart resets attempt timing, sectors, penalty, and completion. Reuse `RaceState.effectiveTimeSec(simTimeSec)` at [src/core/race-state.ts](src/core/race-state.ts#L168-L171) rather than creating a second penalty calculation.

**Sector identity recommendation:** record `{ lap, checkpointId, fromCheckpointId, elapsedSec, cumulativeSec, deltaSec, comparisonSource }` at the accepted checkpoint event. Circuit sectors must retain lap number; P2P can use a stable ordinal/checkpoint interval. Keep the worst-sector selector pure and deterministic, with ties resolved by first recorded sector.

### `src/core/medal-persistence.ts` (new validated localStorage boundary)

**Analogs:** [src/core/vehicle-tuning.ts](src/core/vehicle-tuning.ts#L581-L657), [src/core/tuning-snapshot.ts](src/core/tuning-snapshot.ts#L50-L130)

**Storage boundary pattern** ([src/core/vehicle-tuning.ts](src/core/vehicle-tuning.ts#L592-L642)):

```typescript
export function parseSavedTuning(raw: string | null): VehicleTuning | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) return null;
  // Require the structural keys, start from trusted defaults, copy known data.
}
```

Use the same raw-string API so tests run in Vitest's Node environment without `localStorage`. The browser composition root may call `localStorage.getItem`/`setItem`, but the parser/serializer must remain pure and never throw.

**Version and independence pattern** ([src/core/tuning-snapshot.ts](src/core/tuning-snapshot.ts#L50-L64), [src/core/tuning-snapshot.ts](src/core/tuning-snapshot.ts#L100-L130)):

```typescript
export const TUNING_SNAPSHOT_KIND = "heat-street.tuning-snapshot";
export const TUNING_SNAPSHOT_VERSION = 1;
```

Use a namespaced key and explicit schema/version. A saved result should contain stable `courseId`, best effective time, medal, and enough schema version to reject or migrate incompatible data. Unknown course IDs should be ignored, not treated as fake zero-time results. A corrupt entry must not wipe valid entries for other course IDs.

Do not reuse `parseTuningSnapshot` directly: its per-domain delegation is an analog, not the medal schema. Copy its sequencing: null guard, `JSON.parse` try/catch, plain-object guard, kind/version guard, field validation, then return a sanitized value. Reject non-finite, negative, or structurally incomplete result fields. Serialize only known fields so prototype/extra-key data cannot survive the boundary.

### `src/core/course.ts` and reference content (model/content)

**Analog:** [src/core/course.ts](src/core/course.ts#L3-L35, src/core/course.ts#L126-L228)

Stable identity is already explicit:

```typescript
export interface Course {
  readonly id: string;
  readonly name: string;
  readonly mode: CourseMode;
  readonly laps: number;
  readonly checkpoints: readonly CourseCheckpoint[];
  readonly start: CourseStart;
}
```

The parser rejects duplicate course IDs and duplicate checkpoint IDs, validates schema version, and returns copied named fields. If Phase 6 adds reference times to the course model, validate them in the same parser with finite-number checks and preserve `course.id` unchanged. Do not use display names as persistence keys.

**Content analog:** [public/maps/juliette-ga.routes.json](public/maps/juliette-ga.routes.json) is deterministic, hand-authored, and already contains the P2P/Circuit IDs and lap contract. The planner should choose one of:

- extend the route schema only if reference-run metadata is inseparable from course content; or
- create a separate versioned `public/maps/juliette-ga.medals.json`/equivalent reference artifact if the goal is to keep route schema and persisted-player schema independently migratable.

Reference runs are shipped designer content, not localStorage data. The artifact must not be populated from a player's best time.

### `src/core/race-state.ts` (extend pure state machine)

**Analog:** [src/core/race-state.ts](src/core/race-state.ts#L63-L177)

Preserve these existing semantics:

- P2P accepts any unvisited checkpoint and selects the lowest road-cost target ([src/core/race-state.ts](src/core/race-state.ts#L77-L96)).
- Circuit accepts only the authored next checkpoint, resets the visited list at lap transitions, and completes after exactly `course.laps` ([src/core/race-state.ts](src/core/race-state.ts#L118-L159)).
- Respawn adds the flat penalty without rewinding simulation time ([src/core/race-state.ts](src/core/race-state.ts#L168-L174)).
- Restart clears progress, penalty, anchor, and completion ([src/core/race-state.ts](src/core/race-state.ts#L176-L188)).
- Snapshots clone/freeze the visited list ([src/core/race-state.ts](src/core/race-state.ts#L58-L61)).

Add only the timing events/fields needed by Phase 6. Avoid making `RaceState` know about localStorage, DOM, reference-artifact loading, or medal-grid presentation. The state machine should remain directly testable with the existing four-node graph fixture.

### `src/gameplay/race-coordinator.ts` (extend fixed-tick event boundary)

**Analog:** [src/gameplay/race-coordinator.ts](src/gameplay/race-coordinator.ts#L14-L30, src/gameplay/race-coordinator.ts#L62-L145)

The coordinator already separates fixed-tick progression from render presentation:

```typescript
function onTickEnd(): void {
  const bodyPosition = deps.scene.vehicle.body.translation();
  // update progress, detect accepted checkpoint hits, then refresh
}

function refresh(): void {
  latest = deps.state.snapshot();
  // update minimap, arrow, objective view, and HUD from the snapshot
}
```

Capture timing exactly where `deps.state.hitCheckpoint(checkpoint.id)` returns true ([src/gameplay/race-coordinator.ts](src/gameplay/race-coordinator.ts#L98-L119)). This is the event boundary that prevents duplicate sectors from repeated sensor occupancy. Pass the fixed simulation time into the pure timing contract there. On completion, publish/retain a plain final-result snapshot for the HUD and persistence path; do not save from a render callback.

The existing `simTimeSec: () => number` dependency ([src/gameplay/race-coordinator.ts](src/gameplay/race-coordinator.ts#L14-L25)) is the intended injection point. Keep it fixed-clock-derived and do not replace it with frame `dtMs`.

### `src/hud/race-hud.ts` (extend DOM overlay)

**Analogs:** [src/hud/race-hud.ts](src/hud/race-hud.ts#L1-L46), [src/hud/minimap.ts](src/hud/minimap.ts#L22-L128)

Keep the factory/update/dispose interface and DOM-only ownership:

```typescript
export interface RaceHud {
  update(snapshot: RaceSnapshot): void;
  flashRestart(): void;
  dispose(): void;
}
```

The HUD should receive a plain timing/result snapshot and write text through `textContent` and direct DOM APIs. Preserve `pointer-events:none`, the existing top-left status placement, and Phase 5's reserved top-right speedometer/bottom-left minimap layout. The timer/threshold panel belongs in the top-right available race-HUD space, but should not move or duplicate the speedometer/minimap.

The render frame may refresh displayed values, but it must not advance timer state. Show the comparison source explicitly (`BEST`, `GOLD TARGET`, etc.), display unavailable bests as unavailable rather than `0`, and use the frozen completion result for post-run sectors/medal.

If a course-card/level-select surface is needed, reuse this direct-DOM pattern in a separate `results-view.ts`; do not turn `RaceHud` into a second game-state store.

### `src/loop.ts` and `src/main.ts` (extend wiring, preserve ownership)

**Analogs:** [src/loop.ts](src/loop.ts#L113-L132, src/loop.ts#L205-L257), [src/main.ts](src/main.ts#L150-L205, src/main.ts#L560-L595)

The loop's fixed-tick seam is already explicit:

```typescript
world.step();
deps.onTickEnd?.(tickIndex, null);
// one render after all fixed ticks
```

Do not add a medal timer to `render(alpha, dtMs)` or alter `SimClock`'s absolute-clock behavior. Extend `LoopDeps` only if a new fixed-tick event is genuinely needed; prefer the existing `onTickEnd` and `onRaceCommands` callbacks. Restart/respawn commands already arrive before the physics step, so timing reset must run through the same command path.

In `main.ts`, follow the existing load/parse/validate composition sequence: fetch artifact text, parse through a domain parser, validate area identity, construct the coordinator, then call `startLoop`. Inject storage/reference data into pure modules; keep browser APIs at the composition boundary. The current loop wiring already routes race commands, `onTickEnd`, render, and HUD updates in the correct order ([src/main.ts](src/main.ts#L560-L595)).

## Test Pattern Assignments

### Deterministic timing and medal math

**Sources:** [tests/sim-clock.test.ts](tests/sim-clock.test.ts#L49-L96), [tests/determinism.test.ts](tests/determinism.test.ts#L111-L170), [tests/race-state.test.ts](tests/race-state.test.ts#L66-L119)

Use synthetic absolute timestamps and fixed tick indices. The existing tests explicitly prove that `simTimeSec === tick * DT`, that 30/60/144 fps agree, and that a naive accumulator is discriminating ([tests/sim-clock.test.ts](tests/sim-clock.test.ts#L49-L96)). Phase 6 tests should add the same proof at the timing-contract boundary: feed identical checkpoint events at different render rates and assert identical final effective time, medal, and sector values.

Do not use sleeps, `performance.now()`, or browser rendering in pure medal tests. Test the meaningful-movement threshold with stationary ticks followed by a deterministic movement sample; verify setup ticks do not count.

### State-machine fixture

**Source:** [tests/race-state.test.ts](tests/race-state.test.ts#L5-L64)

Copy the compact in-memory `RoadGraph`, `checkpoint()` helper, and `course(mode)` helper. It makes P2P/Circuit behavior readable without Three.js/Rapier or real map data. Extend the helper only with the fields timing needs, and keep timing tests separate from route-artifact tests.

### Content identity and route artifact

**Sources:** [tests/course-data.test.ts](tests/course-data.test.ts#L1-L120), [tests/route-validation.test.ts](tests/route-validation.test.ts#L1-L15)

Use local fixture data for schema rejection and `?raw` imports for shipped artifacts:

```typescript
import routesRaw from "../public/maps/juliette-ga.routes.json?raw";
```

The real-artifact test should assert that reference data parses, every referenced course ID is stable, and all three shipped courses (Juliette, GA P2P, and Circuit as described by Phase 6 context) have valid reference times/thresholds. Keep route reachability and geometry validation in the existing route-validation path; do not duplicate it in medal tests.

### Persistence fixture/security shape

**Sources:** [tests/tuning-persist.test.ts](tests/tuning-persist.test.ts#L40-L149), [tests/tuning-snapshot.test.ts](tests/tuning-snapshot.test.ts#L32-L275)

Copy these test families:

- valid serializer/parser round trip;
- `null`, malformed JSON, non-object, missing-key, wrong-kind, and wrong-version rejection;
- hostile `NaN`/`Infinity`/string/negative values never throw and never propagate;
- valid data survives alongside a corrupt unrelated entry;
- unknown extra keys and prototype keys are dropped;
- no fake zero values for absent bests.

Use the existing `assertPresent` style from [tests/tuning-snapshot.test.ts](tests/tuning-snapshot.test.ts#L20-L29) when narrowing nullable parsed results; avoid non-null assertions.

### Coordinator/event-boundary coverage

**Source:** [src/gameplay/race-coordinator.ts](src/gameplay/race-coordinator.ts#L98-L119)

If a coordinator test is added, use a minimal fake scene/state/view/HUD and call `onTickEnd()` with a fixed body position. Assert that a checkpoint event is recorded once when occupancy changes from outside to inside, not once per tick while the car remains inside. Assert that Circuit sectors retain `lap` and `checkpointId`, and that completion emits one frozen result. Keep DOM and Three.js out of the pure timing suite.

## Shared Patterns

### Fixed simulation time

**Source:** [src/core/sim-clock.ts](src/core/sim-clock.ts#L13-L94) and [src/loop.ts](src/loop.ts#L205-L257)  
**Apply to:** all timing, split, medal, penalty, and completion code

`SimClock.simTimeSec` is the only authoritative run-time source. The loop may use wall-clock timestamps to schedule frames, but Phase 6 domain code must receive fixed simulation time/tick values and never read wall time itself.

### Pure snapshots and layering

**Sources:** [src/core/race-state.ts](src/core/race-state.ts#L9-L61), [src/gameplay/race-coordinator.ts](src/gameplay/race-coordinator.ts#L31-L60), [src/hud/race-hud.ts](src/hud/race-hud.ts#L1-L46)  
**Apply to:** timing core, coordinator, HUD, results

Core owns decisions and immutable snapshots; gameplay owns fixed-tick event capture; HUD consumes snapshots and owns only DOM presentation. No HUD module should import Three.js/Rapier or mutate race state.

### Safe persisted data

**Sources:** [src/core/vehicle-tuning.ts](src/core/vehicle-tuning.ts#L581-L657), [src/core/tuning-snapshot.ts](src/core/tuning-snapshot.ts#L100-L130)  
**Apply to:** medal bests and any result-grid data

Treat localStorage as untrusted input. Validate schema/version and finite values, ignore incompatible entries, preserve unrelated valid records, and keep parsing non-throwing. Store content/reference times separately from player bests.

### DOM overlay lifecycle

**Sources:** [src/hud/race-hud.ts](src/hud/race-hud.ts#L9-L46), [src/hud/minimap.ts](src/hud/minimap.ts#L59-L128)  
**Apply to:** timer, split, result, and course-card views

Construct once, append to `document.body`, update with plain snapshots, and expose `dispose()`. Use direct DOM APIs and `textContent`; preserve fixed positioning and `pointer-events:none` for the driving HUD.

### Stable content identity

**Sources:** [src/core/course.ts](src/core/course.ts#L26-L35, src/core/course.ts#L164-L228), [public/maps/juliette-ga.routes.json](public/maps/juliette-ga.routes.json), [tests/route-validation.test.ts](tests/route-validation.test.ts#L1-L15)  
**Apply to:** reference times, best-time keys, result cards, sector labels

Use `Course.id` and checkpoint `id` as stable machine keys. Display names are presentation only. Content-only UI changes must not change IDs or invalidate local bests.

## No Analog Found

No existing module owns medals, split intervals, or persistent per-course results. Those are genuinely new pure domains and should not be improvised inside `race-hud.ts`, `main.ts`, or `race-coordinator.ts`. There is also no existing event bus; Phase 6 does not need one because the fixed-tick checkpoint acceptance in `RaceCoordinator.onTickEnd()` is already the local event boundary. A future narrative bus remains Phase 8 scope.

## Extend Versus Create Summary

**Extend:**

- `src/core/race-state.ts` for attempt lifecycle and read-only timing state.
- `src/gameplay/race-coordinator.ts` for checkpoint-to-sector event capture.
- `src/hud/race-hud.ts` for live timer/split/result presentation.
- `src/core/course.ts` and route content only if reference metadata is included in that schema.
- `src/main.ts` for composition and persistence wiring.
- Existing race/course tests for regression coverage.

**Create:**

- one pure timing/medal/split contract (`src/core/medal-timing.ts` or equivalent);
- one validated best-result persistence module (`src/core/medal-persistence.ts` or equivalent);
- focused medal and persistence tests;
- a separate results view only if course cards cannot fit the existing race-HUD lifecycle;
- a coordinator test only if pure state tests cannot prove the fixed-tick event boundary.

## Metadata

**Analog search scope:** `src/core`, `src/gameplay`, `src/hud`, `src/loop.ts`, `src/main.ts`, `public/maps`, `tests`, `.planning/phases/05-objectives-navigation-race-modes`  
**Files scanned:** 15 source/content/test files plus Phase 5 research and Phase 6 canonical planning docs  
**Pattern extraction date:** 2026-09-21
