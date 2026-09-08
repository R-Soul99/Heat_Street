# Phase 2: Vehicle Feel Core - Pattern Map

**Mapped:** 2026-09-09
**Files analyzed:** 22 (16 new, 6 modified)
**Analogs found:** 20 / 22

> Every excerpt below is verbatim from the Phase 1 shipped codebase at the cited
> line numbers. Where a pattern must be *inverted* or *extended* rather than
> copied, that is called out explicitly.

---

## Blocking Finding — read this before planning file moves

**`src/physics/debug-scene.ts` MUST NOT be deleted.** RESEARCH.md's structure table
labels it `# REPLACED by vehicle-scene.ts`, but three Phase 1 test files import
`createDebugScene` directly and would fail to compile if it is removed:

| Importer | Lines |
|---|---|
| `tests/determinism.test.ts` | 4, 36, 85, 197, 215, 220, 234 |
| `tests/transform-cache.test.ts` | 3, 21 |
| `tests/loop.test.ts` | 8, 27 |

`tests/determinism.test.ts` is the VEH-03 proof (SC1 of Phase 1) and CLAUDE.md
project constraint #3 says it "must not regress". Same for
`src/render/debug-scene.ts`, which `src/main.ts:24` imports.

**Correct plan shape:** *supersede at the composition root only.* Add
`src/physics/vehicle-scene.ts` and `src/render/vehicle-view.ts` as new files,
repoint `src/main.ts`, and leave both `debug-scene.ts` files in place as the
regression fixtures they have become. Retire them (and rewrite the three tests
onto `vehicle-scene`) only as a deliberate, separately-planned task — not as a
side effect of this phase.

---

## File Classification

### New files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/core/vehicle-tuning.ts` | config / model (pure data) | static config | `src/core/frame-budget.ts` | exact |
| `src/input/keyboard.ts` | input adapter | event-driven (latch) | `src/debug/debug-gate.ts` (listener registration) | partial |
| `src/input/gamepad.ts` | input adapter | polled snapshot | *(none)* | **no analog** |
| `src/input/live-input.ts` | service (`InputSource` impl) | request-response per tick | `src/core/input-tape.ts` → `RecordingInput` | exact |
| `src/physics/vehicle.ts` | factory / service | per-tick transform | `src/physics/debug-scene.ts` → `createDebugScene` | exact |
| `src/physics/vehicle-assists.ts` | utility (pure-ish per-tick) | per-tick transform | `src/physics/debug-scene.ts` → `applyInput` body | role-match |
| `src/physics/vehicle-scene.ts` | scene factory | world construction | `src/physics/debug-scene.ts` | exact |
| `src/physics/telemetry/routines.ts` | model (pure data + predicates) | batch | `src/core/frame-budget.ts` + `src/core/input-tape.ts` (`InputSource`) | role-match |
| `src/physics/telemetry/run.ts` | service (harness) | batch | `tests/determinism.test.ts` → `stepScene` / `simulate` | exact |
| `src/render/vehicle-view.ts` | render view / component | read-only mirror of sim | `src/render/debug-scene.ts` | exact |
| `src/hud/speedometer.ts` | component (DOM/SVG) | render-loop push | `src/debug/profiler-hud.ts` → `createHud` | exact |
| `src/debug/tuning-panel.ts` | component (dev tool) | event-driven + persistence | `src/debug/profiler-hud.ts` + `src/debug/debug-gate.ts` | role-match |
| `src/debug/telemetry-hud.ts` | component (dev tool) | batch → DOM | `src/debug/profiler-hud.ts` | exact |
| `tests/vehicle-telemetry.test.ts` | test (integration, headless physics) | batch | `tests/determinism.test.ts` | exact |
| `tests/vehicle.test.ts` | test (integration, headless physics) | request-response | `tests/determinism.test.ts` (`describe("debug scene")` block) | exact |
| `tests/live-input.test.ts` | test (unit, pure) | request-response | `tests/input-tape.test.ts` | exact |
| `tests/speedometer.test.ts` | test (unit, pure formatter) | transform | `tests/profiler-hud.test.ts` | exact |
| `tests/tuning-persist.test.ts` | test (unit) | serialize / round-trip | `tests/debug-gate.test.ts` (hostile-input shape) | role-match |

### Modified files

| Modified File | Change | Analog for the change |
|---|---|---|
| `src/debug/debug-gate.ts` | add `onDebugKey(code, fn)` + focus guard; `onDebugToggle` becomes an alias | its own `onDebugToggle`, lines 48-56 |
| `tests/layering.test.ts` | add `src/input/**` and `src/hud/**` rule blocks | its own `src/render/` block, lines 117-130 |
| `src/main.ts` | repoint composition root at the vehicle scene; wire speedo + panels | its own current body, lines 34-80 |
| `tests/debug-gate.test.ts` | cover the new focus guard / keyed variant | its own body |
| `src/physics/debug-scene.ts` | **no edit** — see Blocking Finding | — |
| `src/render/debug-scene.ts` | **no edit** — see Blocking Finding | — |

---

## Pattern Assignments

### `src/core/vehicle-tuning.ts` (config, static data)

**Analog:** `src/core/frame-budget.ts` (40 lines — read in full)

`src/core/` is the purity tier. `tests/layering.test.ts:88-89` forbids
`from "three"`, `from "@dimforge/rapier3d"`, `document.`, `window.`,
`performance.` and `requestAnimationFrame` in every file here. A tuning object is
plain data, so it fits.

**Module-doc + doc-comment-per-field pattern** (`frame-budget.ts:1-24`):

```typescript
/**
 * The frame budget, in milliseconds at 60 fps.
 *
 * Mirrored in `docs/frame-budget.md`. `tests/frame-budget.test.ts` reads that
 * document and fails if any figure here is missing from it, so the budget the
 * profiler HUD checks against can never quietly drift from the budget that was
 * written down and agreed.
 *
 * D-04 locks `frameMs` at 16.6 and `physicsMs` at no more than 4.0. ...
 */
export const BUDGET = {
  /** Total frame. 60 fps. Locked by D-04. */
  frameMs: 16.6,
  /** All fixed physics steps executed in one frame, not per step. Locked by D-04. */
  physicsMs: 4.0,
  ...
} as const;
```

**Copy exactly:** the `export const X = { ... } as const` shape, one `/** */` per
field naming the deciding decision ID, and the module doc citing where the value
came from. For `DEFAULT_TUNING`, cite RESEARCH.md Config A/B per field.

**Deviate on one point:** `BUDGET` is `as const` (deeply readonly). `DEFAULT_TUNING`
must be **mutable at the leaves**, because `gui.add(tuning.wheels, "frictionSlip", …)`
writes through the object reference (RESEARCH.md lines 1003-1017). Use
`VehicleTuning` with `readonly` only on the *group* keys (as RESEARCH.md's
interface at lines 426-458 already does) and export a `defaultTuning()` **factory**
so the panel cannot mutate a frozen module singleton shared with the telemetry
runner's `DEFAULT_TUNING` baseline.

**Frozen-shared-reference precedent** for the immutable half (`input-tape.ts:28-34`):

```typescript
/** The all-zero frame. Frozen because it is handed out by reference as a gap filler. */
export const NEUTRAL: InputFrame = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
});
```

---

### `src/physics/vehicle.ts` (factory, per-tick transform)

**Analog:** `src/physics/debug-scene.ts` (158 lines — read in full)

This is the closest analog in the repo: same layer, same "build bodies into a
world, return a handle with per-tick methods" shape, same layering constraints.

**Layering doc-comment header to copy** (`debug-scene.ts:10-13`, echoed in
`world.ts:16-17` and `transform-cache.ts:16-17` — three files, identical wording,
so this is an established convention not a one-off):

```typescript
/**
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock. Meshes for these bodies
 * are built in `src/render/` (plan 01-05) in the same dense index order as
 * `bodies` below.
 */
```

**Imports pattern** (`debug-scene.ts:15-17`) — note `import * as RAPIER` (value
import, because it constructs) vs `transform-cache.ts:19`'s `import type * as RAPIER`
(type-only, because it only reads):

```typescript
import * as RAPIER from "@dimforge/rapier3d";
import type { InputFrame } from "../core/input-tape";
import { DT } from "../core/sim-clock";
```

`DT` comes from `src/core/sim-clock` and **nowhere else**. `world.ts:20,42` and
`debug-scene.ts:133` both take it from there; `world.ts:26-38` documents at length
why a second copy of `1/60` is forbidden. `vc.updateVehicle(DT)` uses this same
import.

**Named-constant-with-rationale pattern** (`debug-scene.ts:19-51`) — every magic
number is a `const` with a doc comment explaining *why that value*:

```typescript
/**
 * Spinner angular speed, radians per second.
 *
 * D-02 / 01-PATTERNS.md R2: the dynamic boxes sleep once settled, and a sleeping
 * body stops moving, so render judder becomes unobservable after roughly ten
 * seconds and SC2 can no longer be checked. ...
 */
const SPIN_RAD_PER_SEC = 1.5;

/** Newton-seconds of linear impulse applied at full throttle, per tick. */
const INPUT_IMPULSE_N = 0.12;

const GROUND_HALF_EXTENTS = { x: 50, y: 0.5, z: 50 };
```

For `vehicle.ts` the equivalent constants are the wheel indices
(`export const FL = 0, FR = 1, RL = 2, RR = 3;`) and the axis vectors
(`DIRECTION = {x:0,y:-1,z:0}`, `AXLE = {x:-1,y:0,z:0}`). Both need the same
"why this value" comment treatment — the `AXLE` sign in particular, because
RESEARCH.md lines 948-959 shows it silently inverts steering.

**Interface-then-factory pattern** (`debug-scene.ts:53-82`) — declare the returned
handle as an exported `interface` with a doc comment per member, then export one
`create*(world, …)` function that closes over its locals and returns an object
literal:

```typescript
export interface DebugScene {
  /**
   * Every body the render layer draws, in dense index order. Excludes the
   * ground. `src/render/` builds one mesh per entry and `TransformCache` keys on
   * the same indices, so this order is a contract.
   */
  readonly bodies: readonly RAPIER.RigidBody[];

  /**
   * Advance anything that is driven rather than simulated. Called once per fixed
   * tick, immediately before `world.step()`. ...
   */
  preTick(tick: number): void;

  /** Apply this tick's latched input. Called once per fixed tick. */
  applyInput(frame: InputFrame): void;
}

export function createDebugScene(world: RAPIER.World): DebugScene {
  ...
  return {
    bodies,
    spinnerIndex,
    preTick(tick: number): void { ... },
    applyInput(frame: InputFrame): void { ... },
  };
}
```

This is exactly RESEARCH.md's `Vehicle` / `createVehicle` contract (lines 461-475).
**D-09 (generic, not player-hardcoded) is satisfied by copying this shape verbatim
— `createDebugScene` already takes the world as a parameter and names nothing
"player".**

**Body-construction pattern** (`debug-scene.ts:91-104`) — chained `RigidBodyDesc`
builder, then a separate `world.createCollider(desc, body)` call:

```typescript
const box = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(i * 1.3 - 3, 4 + i * 0.9, 0)
    .setAngvel(BOX_INITIAL_ANGVEL)
    .setLinearDamping(BOX_LINEAR_DAMPING),
);
world.createCollider(
  RAPIER.ColliderDesc.cuboid(BOX_HALF_EXTENT, BOX_HALF_EXTENT, BOX_HALF_EXTENT).setRestitution(
    BOX_RESTITUTION,
  ),
  box,
);
```

RESEARCH.md's verified `createVehicle` (lines 891-943) uses this identical shape,
adding `.setCanSleep(false)` (Pitfall 9) and `.setCcdEnabled(true)` (Pitfall 6).

**Hand-built quaternion precedent** (`debug-scene.ts:133-141`) — the reason
`vehicle-assists.ts` may not import `three` for `Vector3.applyQuaternion`:

```typescript
const angle = tick * DT * SPIN_RAD_PER_SEC;
// Quaternion about +Y, built by hand: this layer may not import `three`.
spinner.setNextKinematicRotation({
  x: 0,
  y: Math.sin(angle / 2),
  z: 0,
  w: Math.cos(angle / 2),
});
```

Copy the **inline comment stating the layering reason** alongside the hand-rolled
maths. That comment is what stops a future editor "simplifying" it back into a
`three` import.

**Early-return no-op guard** (`debug-scene.ts:143-150`) — directly relevant to
Pitfall 7 (engine force must be zeroed when braking):

```typescript
applyInput(frame: InputFrame): void {
  // NEUTRAL must be a true no-op. A zero-magnitude impulse with wakeUp:true
  // would still clear sleeping flags, and that alone changes the snapshot.
  // `handbrake` is accepted and deliberately ignored in Phase 1; Phase 2
  // wires it to the vehicle controller's rear-wheel friction.
  if (frame.throttle === 0 && frame.brake === 0 && frame.steer === 0) {
    return;
  }
  ...
}
```

**Note for the planner:** line 146-147 is the D-01 forward reference CONTEXT.md
cites. If `debug-scene.ts` is left in place (per the Blocking Finding), that
comment should be left alone — it is accurate for that file.

---

### `src/physics/vehicle-assists.ts` (utility, per-tick impulses)

**Analog:** `src/physics/debug-scene.ts` `applyInput` body (lines 152-155) — same
layer, same "read state, write impulses" operation.

```typescript
const forward = -frame.throttle * INPUT_IMPULSE_N;
const rearward = frame.brake * INPUT_IMPULSE_N * BRAKE_IMPULSE_SCALE;
driven.applyImpulse({ x: 0, y: 0, z: forward + rearward }, true);
driven.applyTorqueImpulse({ x: 0, y: frame.steer * INPUT_TORQUE_NM, z: 0 }, true);
```

Confirms three conventions RESEARCH.md Pattern 3 assumes: object-literal vectors
(never `three` types), `applyImpulse`/`applyTorqueImpulse` (never `addForce`/
`addTorque`), and the `wakeUp: true` second argument.

**Deviate on one point:** `debug-scene.ts` is a free-standing closure. Make
`applyAssists` an **exported free function** taking `(body, vc, contacts, a, I)`
explicitly, following the `src/render/interpolator.ts` precedent for that choice
(`interpolator.ts:13-15`):

> *"a free function here rather than a method on `TransformCache`, so `src/physics/`
> stays free of any `three` import"*

Same reasoning applies: a free function with explicit parameters is directly
unit-testable from `tests/vehicle.test.ts` without constructing a whole scene.

---

### `src/physics/telemetry/run.ts` (harness, batch)

**Analog:** `tests/determinism.test.ts` `stepScene` (lines 33-45) and `simulate`
(lines 74-109). RESEARCH.md's `runRoutine` (lines 615-631) is this shape moved
into `src/`.

**Isolated-world-per-run pattern** (`determinism.test.ts:33-45`):

```typescript
/** Step a fresh scene a fixed number of ticks, bypassing the clock entirely. */
function stepScene(ticks: number, input?: (tick: number) => InputFrame) {
  const world = createWorld();
  const scene = createDebugScene(world);
  for (let t = 0; t < ticks; t++) {
    scene.preTick(t);
    if (input) {
      scene.applyInput(input(t));
    }
    world.step();
  }
  return { world, scene, hash: fnv1a(world.takeSnapshot()) };
}
```

Copy the ordering exactly: `preTick` → `applyInput` → `world.step()`. It matches
`src/loop.ts:194-199` and is the same order RESEARCH.md Pattern 2 requires
(`vehicle.tick(frame, tuning)` → `world.step()`).

**Add one thing the analog lacks:** `world.free()` after each routine
(RESEARCH.md Pitfall 13). The tests get away without it because each Vitest file
is a fresh process; a browser tuning session is not.

**Non-cryptographic-hash disclaimer** (`determinism.test.ts:18-31`) — CLAUDE.md /
RESEARCH.md ASVS V6 requires carrying this comment forward verbatim in shape:

```typescript
/**
 * FNV-1a, 32-bit. A NON-CRYPTOGRAPHIC fingerprint used only to compare two
 * snapshots for equality inside this test file. It is not a checksum, it provides
 * no integrity guarantee, and nothing outside this file may treat it as one
 * (01-RESEARCH.md "Security Domain", ASVS V6).
 */
function fnv1a(bytes: Uint8Array): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}
```

Copy this function body **verbatim** into `tests/vehicle-telemetry.test.ts` for
the `-t reproducible` case. Do **not** hoist it into `src/` — the comment's own
"inside this test file" scoping is the control.

---

### `src/input/live-input.ts` (InputSource impl, per-tick)

**Analog:** `src/core/input-tape.ts` → `RecordingInput` (lines 42-78)

The interface it must implement is already exported (`input-tape.ts:36-40`):

```typescript
/** Anything the fixed tick can ask for a frame: live hardware, a tape, or a script. */
export interface InputSource {
  /** Resolve this tick's immutable frame. Must be stable for a given tick index. */
  sampleForTick(tick: number): InputFrame;
}
```

**Idempotence-guard pattern** (`RecordingInput.sampleForTick`, lines 57-72) — the
same defect class RESEARCH.md Pattern 5's `lastTick` guard solves:

```typescript
sampleForTick(tick: number): InputFrame {
  if (tick < 0) {
    return NEUTRAL;
  }
  if (tick < this.tape.length) {
    return this.tape[tick];
  }
  // A skipped tick is recorded as NEUTRAL rather than shifting the tape, so a
  // frame's index always equals its tick index on replay.
  while (this.tape.length < tick) {
    this.tape.push(NEUTRAL);
  }
  const frame = this.live.sampleForTick(tick);
  this.tape.push(frame);
  return frame;
}
```

Two things to carry over: the `tick < 0` early return, and the explicit handling of
a **skipped** tick index. RESEARCH.md's `MAX_CATCHUP` loop is the ramp equivalent
of the `while (this.tape.length < tick)` fill.

**Class-with-private-fields shape** (`input-tape.ts:49-56`) — `implements InputSource`,
`private readonly` deps assigned in the constructor. Copy it; CLAUDE.md mandates
plain TS classes, not an ECS.

**Layering note the planner must honour:** `input-tape.ts:12-13` reserves this file
explicitly —

> *"Pure by construction: no renderer, no physics engine, no DOM, no wall clock.
> A real keyboard/gamepad source is Phase 2's job and lives outside `src/core/`."*

So `src/input/` is a **new** directory and `src/core/input-tape.ts` needs **no
edit at all** — `InputFrame` already carries `handbrake` (line 25).

---

### `src/input/keyboard.ts` (adapter, event-driven)

**Analog:** `src/debug/debug-gate.ts:48-56` — the only listener-registration site
in the repo.

```typescript
export function onDebugToggle(fn: () => void): void {
  if (!DEBUG_ENABLED) return;
  addEventListener("keydown", (e) => {
    if (e.code === "Backquote" && !e.repeat && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      fn();
    }
  });
}
```

**Copy:** bare `addEventListener` (not `window.addEventListener` — `window.` is
banned in `src/core/` and this convention keeps the codebase uniform), `e.code`
(physical key, layout-independent — correct for WASD), and the
`!e.metaKey && !e.ctrlKey` guard so browser shortcuts survive.

**Deviate:** the driving keys need `keydown` **and** `keyup` to latch a boolean,
and must NOT use `!e.repeat` (a held key must stay latched). `preventDefault` on
`Space` is required (page-scroll) — D-02 assigns Space to handbrake.

**Also copy the `typeof` DOM guard** (`debug-gate.ts:32-34`), so
`tests/live-input.test.ts` can import the module under Vitest's `node` environment
without a jsdom dependency:

```typescript
export const DEBUG_ENABLED: boolean =
  typeof location !== "undefined" ? parseDebugFlag(location.search) : false;
```

`tests/debug-gate.test.ts:4-11` documents exactly why this matters.

---

### `src/input/gamepad.ts` (adapter, polled)

**No analog.** Nothing in the repo touches `navigator`. Use RESEARCH.md Pattern 5
(lines 679-684) and Assumption A1 (line 1125) as the source, and note A1 is
`[ASSUMED]`, LOW confidence.

**Constraints that still apply from the codebase:**
- `tests/layering.test.ts:140-149` bans `performance.now(` / `Date.now(` outside
  `src/loop.ts` and `src/debug/`. Polling must therefore be driven from
  `advance()` inside the fixed tick, never from a self-scheduled timer.
- Follow the `typeof location !== "undefined"` guard shape for `navigator` so the
  module imports cleanly in Node.
- Design for **injection**: RESEARCH.md's test map (line 1204) requires
  `tests/live-input.test.ts -t gamepad` to run against an *injected pad snapshot*.
  Take a `readPad: () => PadSnapshot | null` parameter, mirroring how
  `src/loop.ts:131-132` injects `LoopScheduler`:

```typescript
/** Defaults to a browser implementation wrapping rAF / performance.now / visibilitychange. */
scheduler?: LoopScheduler;
```

and `loop.ts:80-83`:

```typescript
 * Injecting this is what makes `startLoop` testable in Node with no jsdom — the
 * default implementation is built lazily INSIDE `startLoop`, never at module
 * scope, so importing this module never touches `document` or `window`.
```

**Copy that pattern exactly** — lazy default construction *inside* the factory, an
optional injected override on the deps object.

---

### `src/render/vehicle-view.ts` (render view)

**Analog:** `src/render/debug-scene.ts` (151 lines — read in full)

**Layering header** (`debug-scene.ts:17-19`):

```typescript
/**
 * Layering: `src/render/` reads simulation state and never writes it. Nothing
 * here touches Rapier at all.
 */
```

**Caution:** `vehicle-view.ts` *does* need to read the Rapier vehicle controller
(`wheelSuspensionLength`, `wheelSteering`, `wheelRotation`, `wheelAxleCs`), so the
"nothing here touches Rapier at all" clause weakens to "reads Rapier, never
writes". `tests/layering.test.ts:119` enforces only the write ban:

```typescript
const FORBIDDEN = /\b(world\.step|applyImpulse|setTranslation|setRotation|setNextKinematic)\b/;
```

None of the wheel getters match that pattern, so a read-only `vehicle-view.ts`
passes as written. Prefer `import type * as RAPIER` here (the
`transform-cache.ts:19` precedent) since it only reads.

**Index-contract doc block to copy** (`debug-scene.ts:9-16`) — the wheel mesh array
inherits the identical hazard:

```typescript
/**
 * THE INDEX CONTRACT. `meshes` MUST be built in the same dense index order as
 * `DebugScene.bodies`, because `applyAllInterpolated` maps target index `i` onto
 * buffer offset `i * XFORM_STRIDE`. A mismatch draws every body at another
 * body's transform, which reads as "the physics is broken" and is painful to
 * diagnose after the fact (threat T-01-16).
 *
 * `bodyCount` and `spinnerIndex` are parameters rather than an import from
 * `src/physics/`, so this module stays a pure render concern and the ordering
 * contract is stated explicitly at the composition root in `src/main.ts`.
 */
```

Restate it for `FL/FR/RL/RR = 0/1/2/3`, and pass wheel geometry in **as parameters**
rather than importing `VehicleTuning` from `src/physics/` — same reasoning.

**Validate-parameters-and-throw pattern** (`debug-scene.ts:67-74, 146-148`):

```typescript
if (!Number.isInteger(bodyCount) || bodyCount < 1) {
  throw new RangeError(`bodyCount must be a positive integer, got ${bodyCount}`);
}
...
if (meshes.length !== bodyCount) {
  throw new Error(`mesh/body count mismatch: ${meshes.length} meshes for ${bodyCount} bodies`);
}
```

**Shared-geometry/material pattern** (`debug-scene.ts:96-106`) — one geometry and
one material reused across the four wheels, to stay inside
`PHASE1_DEBUG_SCENE_TARGETS.drawCalls = 20`:

```typescript
// One shared geometry and one shared material across all six identical boxes,
// keeping the scene inside the Phase 1 targets of under 20 draw calls and
// under 10,000 triangles (docs/frame-budget.md).
const boxGeometry = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
const boxMaterial = new THREE.MeshStandardMaterial({ color: COLOUR_BOX, roughness: 0.6 });
```

**Do-not-seed-a-pose rule** (`debug-scene.ts:117-120`) — applies to the chassis mesh,
which `applyAllInterpolated` owns. It does **not** apply to the wheel meshes, whose
local transform `vehicle-view.ts` itself owns each frame (RESEARCH.md lines 970-983);
call that exception out in the doc comment.

```typescript
// No pose is set here. Every body mesh transform is owned by
// `applyAllInterpolated` and written on the first rendered frame; seeding a
// pose would be overwritten immediately and would hide an ordering bug on
// frame one behind a plausible-looking layout.
```

---

### `src/hud/speedometer.ts` (component, DOM/SVG)

**Analog:** `src/debug/profiler-hud.ts` (148 lines — read in full)

**The split that makes it testable** (`profiler-hud.ts:9-13`) — this is the single
most important pattern to copy, because UI-SPEC.md line 266 explicitly demands
"exactly the split `profiler-hud.ts` established with `formatHudText`":

```typescript
/**
 * The two halves are kept deliberately separate: `formatHudText` is pure and
 * Node-testable (see `tests/profiler-hud.test.ts`), `createHud` is the DOM/
 * renderer/world-touching half that only plan 01-07's browser checkpoint can
 * exercise.
 */
```

So export **pure functions** — `mphFromGroundSpeed(ms)`, `needleAngleDeg(mph)`,
`dampStep(damped, mph, dtMs)` — plus the `createSpeedometer()` DOM half.
`tests/speedometer.test.ts` imports only the pure ones.

**Overlay element pattern** (`profiler-hud.ts:81-88`):

```typescript
const el = document.createElement("div");
// `pointer-events:none` keeps the overlay out of the input path entirely.
// `display:none` is the default; `debug-gate`'s hotkey is what shows it.
el.style.cssText =
  "position:fixed;top:8px;left:8px;z-index:10;pointer-events:none;" +
  "font:11px/1.45 ui-monospace,monospace;color:#e8e8e8;background:rgba(0,0,0,.62);" +
  "padding:6px 9px;border-radius:4px;white-space:pre;display:none";
document.body.appendChild(el);
```

**Copy:** inline `style.cssText` as a `+`-concatenated string literal,
`pointer-events:none`, `document.body.appendChild`. **No stylesheet, no
`index.html` edit** (UI-SPEC.md line 214 confirms).

**Deviate on three points:**
1. `createElementNS("http://www.w3.org/2000/svg", …)` not `createElement`
   (UI-SPEC.md Speedometer Geometry Contract).
2. `z-index:5` not `10`, `right:16px;bottom:16px` not `top:8px;left:8px`
   (UI-SPEC.md layer + spacing contract; the 8px inset is grandfathered for the
   profiler HUD only).
3. **No `display:none`** — the speedometer is player-facing and always on.

**Handle-interface pattern** (`profiler-hud.ts:65-73`):

```typescript
/** The live overlay's public surface. */
export interface Hud {
  /** Flip the overlay between hidden and visible. Wired to `onDebugToggle`. */
  toggle(): void;
  /** Feed one frame's stats in. Throttled internally — safe to call every rAF. */
  update(stats: FrameStats, dtMs: number): void;
  /** Remove the overlay element from the DOM. */
  dispose(): void;
}
```

`Speedometer` gets `update(groundSpeedMs, dtMs)` and `dispose()`, no `toggle()`.

**`textContent`-only writes** (`profiler-hud.ts:125`) — `el.textContent = …`.
`tests/layering.test.ts:151-155` fails on any non-comment `innerHTML` under `src/`.

**Deliberately DO NOT copy the throttle** (`profiler-hud.ts:33-34, 108-110`):

```typescript
/** How long the overlay stays visible between throttled DOM writes. */
const THROTTLE_MS = 150;
...
// ~7 Hz DOM writes, not 144 Hz — RESEARCH.md is explicit that writing the
// DOM every frame is itself a frame-budget cost.
if (accMs < THROTTLE_MS) return;
```

UI-SPEC.md Interaction & Motion Contract: *"Do not throttle to ~7 Hz like
`profiler-hud.ts` does — a needle updating 7×/sec reads as broken hardware."*
Write a counter-comment at that spot saying so, or the next reader will "fix" it.

**`dtMs` arrives as a parameter** (`profiler-hud.ts:70, 102`) — `update(stats, dtMs)`,
sourced from `loop.ts:175` and passed through `loop.ts:226-236`. The gauge never
reads a clock; that is what keeps the exponential damping framerate-independent
*and* keeps `src/hud/**` clean under the new layering rule.

---

### `src/debug/tuning-panel.ts` (dev tool, event-driven + persistence)

**Analogs:** `src/debug/debug-gate.ts` (gating) + `src/debug/profiler-hud.ts` (shape)

**Gate-at-construction pattern.** Note the split of responsibility — the
*module* does not check `DEBUG_ENABLED`; `src/main.ts:61` does
(`profiler-hud.ts:75-79`):

```typescript
/**
 * Create the DOM overlay. Hidden by default (`display:none`) — `debug-gate`'s
 * `onDebugToggle` is what flips it, and this module never checks `DEBUG_ENABLED`
 * itself so it stays independently testable and reusable.
 */
```

```typescript
// src/main.ts:59-64
// The HUD is constructed only when `?debug` is present, so a normal build
// adds zero DOM overlay and zero listeners.
const hud = DEBUG_ENABLED ? createHud(renderer, world) : null;
if (hud) {
  onDebugToggle(() => hud.toggle());
}
```

**Conflict to resolve in the plan:** RESEARCH.md line 995 and UI-SPEC.md line 360
both put `if (!DEBUG_ENABLED) return null;` *inside* `createTuningPanel`, which
inverts the shipped convention. Both are defensible; pick one and say so. The
shipped convention (gate at `main.ts`) keeps the module Node-importable for
`tests/tuning-persist.test.ts`, which matters here — recommend keeping the gate at
the composition root and having `createTuningPanel` be gate-free like `createHud`.

**Layering header** (`profiler-hud.ts:14-17`, near-identical in `debug-gate.ts:6-9`):

```typescript
/**
 * Layering: `src/debug/**` may import anything but must never affect
 * simulation timing — no `world.step`, no impulses, no body writes. This file
 * only reads `renderer.info` and iterates active rigid bodies.
 */
```

Restate the final sentence for the panel: *"This file only writes plain numbers
into a `VehicleTuning` object which the physics layer reads on the next tick."*

**Hostile-input handling.** The strongest precedent is `debug-gate.ts:11-23`:

```typescript
/**
 * Pure presence check: does `search` contain a `debug` key at all?
 *
 * This is the ONLY externally-influenced input in the whole of Phase 1
 * (01-RESEARCH.md "Security Domain", ASVS V5). Reading the parameter's VALUE
 * instead of checking presence would be a V5 violation ...
 */
export function parseDebugFlag(search: string): boolean {
  return new URLSearchParams(search).has("debug");
}
```

The localStorage blob is Phase 2's second such input. Follow the same shape:
a **pure exported function** (e.g. `parseSavedTuning(raw: string | null): SavedTuning | null`)
that does `try { JSON.parse } catch { return null }` **and range-clamps every
numeric field**, with a doc comment naming the ASVS category and the specific
failure (a `NaN` mass corrupting `world.step()` — RESEARCH.md line 1255). Keeping
it pure is what lets `tests/tuning-persist.test.ts` hammer it in Node, exactly as
`tests/debug-gate.test.ts` hammers `parseDebugFlag`.

---

### `src/debug/telemetry-hud.ts` (dev tool, batch → DOM)

**Analog:** `src/debug/profiler-hud.ts` — UI-SPEC.md line 378 requires the surface
styling be *"deliberately identical to `profiler-hud.ts` so the two read as one
tool family"*. Copy `profiler-hud.ts:84-87`'s `style.cssText` string and change
only `top`/`right`/`z-index`.

Same pure/impure split: export a pure `formatTelemetryRow(result)` (mirroring
`formatHudText`) tested in Node, plus the DOM half.

**Padded-string column alignment** (`profiler-hud.ts:50-63`) — `formatHudText`
already aligns columns with literal spacing inside template strings and
`toFixed(2)` for byte-stability:

```typescript
const lines = [
  `frame   ${avgFrameMs.toFixed(2)}ms / ${BUDGET.frameMs}ms${over(avgFrameMs, BUDGET.frameMs)}`,
  `physics ${stats.physicsMs.toFixed(2)}ms / ${BUDGET.physicsMs}ms${over(stats.physicsMs, BUDGET.physicsMs)}  (${stats.steps} step/f)`,
  ...
];
return lines.join("\n");
```

UI-SPEC.md line 382: *"Column alignment via padded strings, not DOM tables."*
Same technique.

**Pass/fail marker helper** (`profiler-hud.ts:36-39`) — the direct analog of
`PASS`/`FAIL`:

```typescript
/** Trailing marker appended to a line whose measured value exceeds its budget. */
function over(value: number, budget: number): string {
  return value > budget ? " !" : "";
}
```

---

### `src/debug/debug-gate.ts` (MODIFY)

**Analog:** itself.

**Extend, don't replace** (lines 48-56, quoted above). UI-SPEC.md Architecture
Call 1 requires `onDebugKey(code, fn)` as the general form with `onDebugToggle`
retained as `onDebugKey("Backquote", fn)`, so `src/main.ts:63` and
`tests/debug-gate.test.ts` need no change.

**The standing TODO this closes** is already written into the file (lines 44-46) —
quote it in the plan as the justification:

```typescript
 * NOTE: this guard will need extending once a text input exists in a later
 * phase (Backquote while typing in a chat/console field would fire the toggle
 * unless focus is checked there too).
```

The lil-gui numeric fields are that text input. Add the focus guard from
UI-SPEC.md lines 244-247 and **update the NOTE comment to say it is now handled**,
so the file doesn't carry a stale TODO.

---

### `tests/layering.test.ts` (MODIFY)

**Analog:** its own `src/render/` block, lines 117-130 — UI-SPEC.md line 259 says
"model it on the existing `src/render/` block, but make it *stronger*".

```typescript
describe("layering — src/render never writes simulation state (T-01-15)", () => {
  const renderFiles = FILES.filter((f) => f.path.startsWith("src/render/"));
  const FORBIDDEN = /\b(world\.step|applyImpulse|setTranslation|setRotation|setNextKinematic)\b/;

  it("scanned at least one src/render file", () => {
    expect(renderFiles.length).toBeGreaterThan(0);
  });

  for (const file of renderFiles) {
    it(`${file.path} contains none of world.step / applyImpulse / setTranslation / setRotation / setNextKinematic`, () => {
      expect(format(findHits(file, FORBIDDEN))).toBe("");
    });
  }
});
```

**Copy the whole three-part shape:** (1) a `FILES.filter` by path prefix,
(2) a **`scanned at least one file` guard** so an empty directory cannot make the
block trivially green, (3) a per-file `it()` inside a `for`. The guard at line
121-123 is not optional — `src/hud/` and `src/input/` will each contain few files
and the whole point is to fail if the glob misses them.

For `src/hud/**` the forbidden pattern is the `src/core/` pattern (line 88-89)
narrowed:

```typescript
const FORBIDDEN =
  /from\s+["'](three|@dimforge\/rapier3d)["']|\bdocument\.|\bwindow\.|\bperformance\.|\brequestAnimationFrame\b/;
```

Take the `from\s+["'](three|@dimforge\/rapier3d)["']` half plus the `src/render/`
write-ban half; **drop `\bdocument\.`** (the HUD legitimately calls
`document.createElementNS`). `performance.` is already covered repo-wide by
lines 140-149, so do not duplicate it.

For `src/input/**`: ban `from "three"`, ban `performance.now(`/`Date.now(`
(already covered repo-wide), and ban the sim-write set — an input source must
never write a body.

Also note the file-count floor at lines 76-80 (`toBeGreaterThanOrEqual(10)`) will
still pass; consider raising it since this phase adds ~10 source files.

---

### `src/main.ts` (MODIFY — composition root)

**Analog:** itself, lines 34-80.

**Explicit-contract-at-the-call-site pattern** (lines 40-47):

```typescript
// `scene.bodies.length` and `scene.spinnerIndex` are passed explicitly rather
// than hardcoded, so the mesh-to-body index contract (threat T-01-16) stays
// visible at this call site instead of relying on two separately-authored
// files agreeing by convention alone.
const { scene: threeScene, meshes } = createDebugRenderScene(
  scene.bodies.length,
  scene.spinnerIndex,
);
```

**The Phase 2 hook is already written into the file** (lines 49-57) — quote it:

```typescript
// Phase 1 has no keyboard or gamepad source yet, so every tick is fed the
// all-zero NEUTRAL frame. Phase 2 replaces this with a live source wrapped in
// `RecordingInput`; the `applyInput` path this exercises is already covered
// by `tests/determinism.test.ts`.
const input: InputSource = { sampleForTick(_tick) { return NEUTRAL; } };
```

**`startLoop` deps-object wiring** (lines 66-80) — add nothing to `LoopDeps`; the
existing fields already cover it:

```typescript
startLoop({
  world,
  input,
  transforms,
  applyInput: scene.applyInput,
  onTickBegin: scene.preTick,
  render(alpha: number): void {
    // Interpolate first, then submit — this ordering is load-bearing. The
    // HUD reads `renderer.info` only after `renderer.render()` returns, and
    // that read is valid only because this is the sole per-frame draw call.
    applyAllInterpolated(meshes, transforms, alpha);
    renderer.render(threeScene, camera);
  },
  hud: hud ? (stats, dtMs) => hud.update(stats, dtMs) : undefined,
});
```

`applyInput: vehicleScene.applyInput` is where `vehicle.tick(frame, tuning)` +
`applyAssists` land, and `src/loop.ts:196-197` guarantees `applyInput` runs
immediately before `world.step()` — which is exactly the ordering RESEARCH.md
Pattern 2 requires. **No change to `src/loop.ts` is needed for this phase.**

The speedometer feed goes inside `render(alpha)`. Note the load-bearing ordering
comment above — `speedo.update(...)` must not sit between
`applyAllInterpolated` and `renderer.render`; put it before the interpolation or
after the draw. `dtMs` is not currently a `render(alpha)` parameter, so the plan
must either add it to `LoopDeps.render` or route the speedometer through the
existing `hud` callback (which already receives `dtMs`, `loop.ts:226-236`).
**Flag this as a real decision — it is the one signature gap between UI-SPEC.md's
contract (`speedo.update(groundSpeedMs, dtMs)` called "once per rAF from main.ts's
render callback") and the shipped loop.**

---

### `tests/vehicle-telemetry.test.ts` / `tests/vehicle.test.ts`

**Analog:** `tests/determinism.test.ts` (278 lines — read in full)

**Rapier-under-Node import** (`determinism.test.ts:1-5`, `rapier-smoke.test.ts:1-2`)
— nothing special is needed; `vitest.config.ts` already handles resolution:

```typescript
import { describe, expect, it } from "vitest";
import { type InputFrame, type InputSource, NEUTRAL, ReplayInput } from "../src/core/input-tape";
import { DT, SimClock } from "../src/core/sim-clock";
import { createDebugScene } from "../src/physics/debug-scene";
import { createWorld } from "../src/physics/world";
```

**Closed-form, never-random scripted input** (`determinism.test.ts:56-72`) — the
telemetry routines' `drive()` must obey this:

```typescript
/**
 * A 600-frame tape whose values are a closed-form function of the frame index.
 * No random source appears anywhere in this file: every run of this suite, on
 * every machine, drives the world with byte-identical input.
 */
function buildVaryingTape(): ReplayInput {
  const frames: InputFrame[] = [];
  for (let i = 0; i < TAPE_FRAMES; i++) {
    frames.push({ steer: Math.sin(i / 37), throttle: (i % 120) / 120, brake: 0, handbrake: false });
  }
  return new ReplayInput(frames);
}
```

**Anti-trivially-green assertions** — the strongest convention in this file, and
directly required by RESEARCH.md's test map entry *"Auto-level assist disabled ⇒
the test above fails (proves the assist is load-bearing, not decorative)"*
(line 1207). Two shipped examples:

```typescript
// determinism.test.ts:129-134
it("has a snapshot hash sensitive enough to detect a one-tick difference", () => {
  // Not padding. Without this, a takeSnapshot() that returned a constant — or a
  // hash that collapsed everything to one value — would make the entire suite
  // trivially green while proving nothing at all.
  expect(stepScene(600).hash).not.toBe(stepScene(601).hash);
});

// determinism.test.ts:158-166
it("proves the input tape is load-bearing rather than a no-op", () => {
  // 01-PATTERNS.md R3: without this assertion the test above would pass even if
  // applyInput did nothing, because both runs would then be identical for
  // reasons that have nothing to do with the tape.
  const varying = simulate(30, 10, buildVaryingTape());
  const neutral = simulate(30, 10, NEUTRAL_TAPE);
  expect(varying.hash).not.toBe(neutral.hash);
});
```

Write `-t "ramp without assist"` in exactly this shape.

**`it.each` for parameter sweeps** (`determinism.test.ts:112-123`) — reuse for the
`frictionSlip` / `sideFrictionStiffness` sweep assertions:

```typescript
it.each([30, 60, 75, 90, 120, 144, 165, 240])(
  "produces an identical tick count and end state at %ifps",
  (fps) => { ... },
);
```

Note the deliberate choice at lines 47-48: *"The eight refresh rates are written
inline at each `it.each` rather than hoisted into a constant, so the list a reader
sees is the list that runs."*

**Version-pin assertion** (`rapier-smoke.test.ts:25-29`) — RESEARCH.md line 1333
says a Rapier pin bump invalidates every measured number. That guard already
exists; reference it rather than duplicating it:

```typescript
it("resolves the pinned non-compat build under Node", () => {
  // Catches both a resolver failure and accidental version drift. A patch bump
  // can alter solver behaviour and silently invalidate recorded medal times.
  expect(RAPIER.version()).toBe("0.20.0");
});
```

**Structural-assertion style for `tests/vehicle.test.ts`** (`determinism.test.ts:195-208`):

```typescript
it("builds one ground body, six dynamic boxes and one spinner", () => {
  const world = createWorld();
  const scene = createDebugScene(world);
  // 8 = ground + 6 boxes + spinner. `scene.bodies` excludes the ground because
  // the render layer in plan 01-05 builds one mesh per entry, in this order.
  expect(world.bodies.len()).toBe(8);
  expect(scene.bodies.length).toBe(7);
  expect(scene.spinnerIndex).toBe(6);
  expect(scene.bodies[scene.spinnerIndex].isKinematic()).toBe(true);
});
```

Use this for the wheel-index / steer-sign assertions.

---

### `tests/live-input.test.ts`

**Analog:** `tests/input-tape.test.ts` (159 lines — read in full)

**Scripted deterministic stand-in** (`input-tape.test.ts:11-24`) — note the comment
literally names this phase:

```typescript
/** A deterministic stand-in for the Phase 2 keyboard/gamepad source. */
class ScriptedInput implements InputSource {
  calls = 0;

  sampleForTick(tick: number): InputFrame {
    this.calls++;
    return {
      steer: Math.sin(tick * 0.1),
      throttle: (tick % 7) / 6,
      brake: tick % 13 === 0 ? 1 : 0,
      handbrake: tick % 17 === 0,
    };
  }
}
```

Invert it for `live-input`: script the *key/pad state*, then assert the emitted
`InputFrame`. The `calls` counter is how the idempotence test proves the live
source was not re-queried — copy that technique for `-t idempotent`:

```typescript
// input-tape.test.ts:78-93
it("is idempotent per tick: a repeated sample returns the same frame reference", () => {
  ...
  const callsAfterFirstPass = live.calls;
  const first = recorder.sampleForTick(7);
  const second = recorder.sampleForTick(7);
  expect(second).toBe(first);
  expect(live.calls).toBe(callsAfterFirstPass);
});
```

**Framerate-independence harness** (`input-tape.test.ts:35-53`) — reuse verbatim for
VEH-02's "independent of call pattern" requirement; it drives a real `SimClock`
and mirrors `src/loop.ts`'s `clock.tick - steps + s` index maths:

```typescript
function consumeAtFps(tape: readonly InputFrame[], fps: number, seconds: number): InputFrame[] {
  const clock = new SimClock();
  clock.start(0);
  const replay = new ReplayInput(tape);
  const consumed: InputFrame[] = [];
  for (let f = 1; f <= fps * seconds; f++) {
    const steps = clock.stepsFor((f / fps) * 1000);
    for (let s = 0; s < steps; s++) {
      consumed.push(replay.sampleForTick(clock.tick - steps + s));
    }
  }
  return consumed;
}
```

---

### `tests/speedometer.test.ts`

**Analog:** `tests/profiler-hud.test.ts` (141 lines — read in full)

**Scope-limiting header** (lines 6-11) — restate it for the speedometer:

```typescript
/**
 * Only `formatHudText` is exercised here — it is the pure half of the module.
 * `createHud` needs a DOM, a `THREE.WebGLRenderer` and a `RAPIER.World`, none of
 * which exist in Vitest's `node` environment; the plan's `<human-check>` covers
 * it once plan 01-07 wires `main.ts`.
 */
```

**`makeX(overrides)` builder pattern** (lines 13-35) — one default object plus a
`Partial<>` spread, so each `it` states only the field it varies:

```typescript
function makeInputs(overrides: Partial<HudInputs> = {}): HudInputs {
  return { stats: makeStats(), drawCalls: 5, triangles: 800, ..., ...overrides };
}
```

**Threshold pairs — one `it` under, one `it` over** (lines 58-66). The redline
threshold at 120 mph and the 0/160 needle clamp want exactly this treatment:

```typescript
it("does not mark frame under budget", () => {
  const text = formatHudText(makeInputs({ avgFrameMs: 4.0 }));
  expect(lineStartingWith(text, "frame")).not.toContain("!");
});

it("marks frame over its budget", () => {
  const text = formatHudText(makeInputs({ avgFrameMs: BUDGET.frameMs + 1 }));
  expect(lineStartingWith(text, "frame")).toContain("!");
});
```

**Assert the constant alongside the behaviour** (lines 73-77) so a silently-changed
constant fails loudly rather than moving the goalposts:

```typescript
it("marks physics over budget: 5.0ms against BUDGET.physicsMs 4.0ms", () => {
  const text = formatHudText(makeInputs({ stats: makeStats({ physicsMs: 5.0 }) }));
  expect(BUDGET.physicsMs).toBe(4.0);
  expect(lineStartingWith(text, "physics")).toContain("!");
});
```

Do the same for `SWEEP_START_DEG === -120`, `SWEEP_DEG === 240`, `MAX_MPH === 160`,
`DIGIT_TAU_SEC === 0.12`.

**Purity-is-the-proof assertion** (lines 135-140) — the exact template for
"`src/hud/` receives plain numbers, never engine handles":

```typescript
it("is pure: a plain HudInputs object is enough, no DOM/renderer/world needed", () => {
  // No `document`, no `THREE.WebGLRenderer`, no `RAPIER.World` exist in this
  // Node test environment at all — the fact that this runs and returns a
  // string is itself the proof formatHudText touches none of them.
  expect(typeof formatHudText(makeInputs())).toBe("string");
});
```

---

### `tests/tuning-persist.test.ts`

**Analog:** `tests/debug-gate.test.ts` (50 lines — read in full)

**Hostile-input case style** (lines 24-28) — one `it` per malicious/malformed
input, each asserting *both* the value and the type:

```typescript
it("is true and returns a boolean for a script-tag value, never the string itself", () => {
  const result = parseDebugFlag("?debug=<script>alert(1)</script>");
  expect(result).toBe(true);
  expect(typeof result).toBe("boolean");
});
```

Mirror with: truncated JSON, `{"wheels":{"mass":null}}`, `NaN`/`Infinity` values,
out-of-range values, a non-object top level, and `"[]"`. Each must return a clamped
default and never throw.

**Environment-scope header** (lines 4-11) — restate for `localStorage`, which also
does not exist in Vitest's `node` environment. That is precisely why the parse and
clamp logic must be a **pure exported function taking `raw: string | null`**, not
something that reads `localStorage` itself.

---

## Shared Patterns

### S1 — Layering doc-comment header (every `src/` file)

**Source:** `src/physics/world.ts:16-17`, `src/physics/debug-scene.ts:10-13`,
`src/physics/transform-cache.ts:16-17`, `src/render/debug-scene.ts:17-19`,
`src/render/interpolator.ts:17-21`, `src/debug/debug-gate.ts:6-9`,
`src/debug/profiler-hud.ts:14-17`
**Apply to:** all 13 new source files

Seven of the fourteen shipped `src/` files carry a `Layering:` paragraph as the
last block of the module doc comment, stating what the file may import and what it
may not touch. This is the repo's single most consistent convention.

```typescript
/**
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */
```

Per-tier wording to reuse:

| New file(s) | Header |
|---|---|
| `src/core/vehicle-tuning.ts` | *"Pure by construction: no renderer, no physics engine, no DOM, no wall clock."* (`input-tape.ts:12-13`) |
| `src/physics/vehicle*.ts`, `src/physics/telemetry/*` | *"may import `@dimforge/rapier3d` and `src/core/`. Must not import `three` and must not touch the DOM or any wall clock."* |
| `src/render/vehicle-view.ts` | *"`src/render/` may READ simulation state and must never write it."* (`interpolator.ts:17-18`) |
| `src/hud/speedometer.ts` | new wording — *"receives plain numbers; imports neither `three` nor Rapier; never writes simulation state; never reads a clock."* |
| `src/input/*` | new wording — *"touches `document`/`navigator`; may import `src/core/`; never writes simulation state; all smoothing advances by `DT` per fixed tick, never per frame."* |
| `src/debug/*` | *"`src/debug/**` may import anything but must never affect simulation timing — no `world.step`, no impulses, no body writes."* |

### S2 — `DT` has exactly one source

**Source:** `src/core/sim-clock.ts:13`
**Apply to:** `src/physics/vehicle.ts`, `src/physics/vehicle-assists.ts`,
`src/physics/telemetry/run.ts`, `src/input/live-input.ts`

```typescript
/** Fixed simulation timestep, in seconds. The physics world timestep must equal this. */
export const DT = 1 / 60;
```

`src/physics/world.ts:26-38` spells out the consequence of a second copy:

```typescript
/**
 * The timestep is assigned from the imported `DT` and is never re-declared here.
 * If the loop and the solver each carried their own copy of the fixed-step
 * literal they could silently drift apart, and the symptom would be inconsistent
 * medal times in Phase 6 rather than anything that looks like a physics bug.
 */
```

Every new file that needs a timestep writes `import { DT } from "../core/sim-clock";`.
No literal `1/60`, no `0.0167`, anywhere.

### S3 — Interface first, factory returning an object literal

**Source:** `src/physics/debug-scene.ts:53-82` (`DebugScene` / `createDebugScene`),
`src/debug/profiler-hud.ts:65-97` (`Hud` / `createHud`),
`src/loop.ts:135-146` (`LoopHandle` / `startLoop`)
**Apply to:** `createVehicle`, `createVehicleScene`, `createVehicleView`,
`createSpeedometer`, `createTuningPanel`, `createTelemetryHud`, `runRoutine`

Exported `interface` with a doc comment per member, then `export function create*()`
returning an object literal over closed-over locals. Never a `class` with public
fields for these. (`src/core/` is the exception — `SimClock`, `RecordingInput`,
`ReplayInput`, `TransformCache` are classes, because they hold identity/state.
`LiveInputSource` is a state machine, so it is a class too, per
`input-tape.ts:49`'s `implements InputSource` precedent.)

### S4 — `dispose()` on anything that touches the DOM

**Source:** `src/debug/profiler-hud.ts:71-72, 144-147`; `src/loop.ts:137-138, 243-248`

```typescript
/** Remove the overlay element from the DOM. */
dispose(): void;
...
dispose(): void {
  el.remove();
},
```

`src/loop.ts:243-248` adds the re-entrancy guard for the listener case:

```typescript
stop(): void {
  if (stopped) return;
  stopped = true;
  scheduler.cancelRaf(rafHandle);
  removeVisibilityListener();
},
```

Apply to `Speedometer`, `TuningPanel`, `TelemetryHud`, and `Vehicle` (whose
`dispose()` frees the controller). `runRoutine` calls `world.free()` (Pitfall 13).

### S5 — Dependency injection over module singletons, with a lazy default

**Source:** `src/loop.ts:77-105, 112-133, 147`

```typescript
/**
 * Everything the loop needs from the browser: scheduling a frame, wall time,
 * and the hidden-to-visible transition. Injecting this is what makes
 * `startLoop` testable in Node with no jsdom — the default implementation is
 * built lazily INSIDE `startLoop`, never at module scope, so importing this
 * module never touches `document` or `window`.
 */
export interface LoopScheduler { ... }

function createBrowserScheduler(): LoopScheduler { ... }

export function startLoop(deps: LoopDeps): LoopHandle {
  const scheduler = deps.scheduler ?? createBrowserScheduler();
```

Plus (`loop.ts:107-111`):

```typescript
/**
 * Dependency-injection object literal rather than constructor parameters or
 * module singletons. Later phases add fields here as the loop grows more
 * responsibilities — keep it an object, per 01-PATTERNS.md.
 */
```

**Apply to:** `src/input/gamepad.ts` (inject a pad reader),
`src/debug/tuning-panel.ts` (inject a storage reader/writer so
`tests/tuning-persist.test.ts` runs without `localStorage`), and
`src/physics/telemetry/run.ts` (inject the tuning object — that injection *is* how
one code path serves both the browser runner and Vitest, per RESEARCH.md line 634).

### S6 — DOM writes: `textContent` and `style.cssText` only

**Source:** `src/debug/profiler-hud.ts:81-88, 125`
**Enforced by:** `tests/layering.test.ts:151-155`
**Apply to:** `src/hud/speedometer.ts`, `src/debug/tuning-panel.ts`,
`src/debug/telemetry-hud.ts`

```typescript
const el = document.createElement("div");
el.style.cssText = "position:fixed;top:8px;left:8px;z-index:10;pointer-events:none;" + ...;
document.body.appendChild(el);
...
el.textContent = formatHudText({ ... });
```

No `innerHTML`, no template strings into the DOM, no stylesheet, no `index.html`
edit. `createElementNS` for SVG. Note the exemption at `layering.test.ts:49-52`:
comment lines are skipped, so a doc comment may name `innerHTML` when explaining
the ban.

### S7 — Explain the *decision*, not the code

**Source:** every shipped file; densest at `src/loop.ts:48-75`,
`src/core/sim-clock.ts:38-49`, `src/physics/world.ts:25-38`
**Apply to:** all new files

The house style is a doc comment that names the failure mode, the measurement that
proved it, and a warning against "improving" it:

```typescript
// src/core/sim-clock.ts:41-48
 * ABSOLUTE clock: the target is recomputed from `nowMs` on every call, so
 * floating-point error never accumulates. An `acc += frameDelta` rewrite loses a
 * tick at 144 fps (measured: 599 ticks / snapshot hash `e91b9ed3` versus 600 /
 * `e68ecce6`), which is a direct SC1 failure.
 *
 * There is deliberately no epsilon in the loop condition. Subtracting `DT * 0.5`
 * was tested at all eight refresh rates and changed nothing; an unexplained
 * epsilon here is a review smell, not a safety margin.
```

RESEARCH.md's `[MEASURED]` findings are the Phase 2 equivalents and belong in the
code as comments at the site they constrain. The highest-value placements:

| Site | Comment must say |
|---|---|
| `frictionSlip` default | dead above ~10; 10.5 and 1000 measured identical (3.48 g vs 3.49 g); useful band is 0.6–2.0 |
| `handbrakeRearSideFriction` | useful range 0.004–0.04; 0.0 spins the car; slider must be `0…0.05` |
| `bodyRollGain` + its clamp | 0.10 → 5.46°; 0.20 → **flips the car**; positive feedback, cutoff is not optional |
| `autoLevelGain` | without it a 120 mph launch lands inverted every time — this assist is load-bearing, not decoration |
| `downforcePerSpeed2 = 0` | measured: no rollover risk exists; knob retained for Phase 3/4, default zero deliberately |
| engine force zeroing on brake | Rapier's `if engineForce != 0 {} else { brake }` — throttle+brake measured 40.1 → 41.1 mph |
| `setIndexForwardAxis = 2` | write-only accessor misnamed in the shipped 0.20.0 bindings; not a typo |
| `AXLE = {x:-1,y:0,z:0}` | flipping this inverts steering; asserted in `tests/vehicle.test.ts -t "steer sign"` |

### S8 — Deliberate-deviation comments

**Source:** `vite.config.ts:4-24`

When this phase departs from RESEARCH.md, UI-SPEC.md, or CLAUDE.md, the repo's
convention is a comment beginning `DEVIATION from …` that names the document, the
claim, and the evidence that overrode it:

```typescript
// DEVIATION from 01-01-PLAN.md, which forbade this key on RESEARCH.md's claim
// that Vite 8.2.2 pre-bundles Rapier correctly. That claim was verified only at
// the "dev server serves the rewritten wasm import with a 200" level, not by
// executing it. Executing it in headless Chrome fails with ...
```

Known deviations this phase will need one for: CLAUDE.md's tuning table (mass 10,
stiffness 24, `frictionSlip` 1000, engine force ±30) is superseded by RESEARCH.md
Config A/B. RESEARCH.md line 1278 notes the fix belongs in
`.planning/research/STACK.md`, **not** `CLAUDE.md` — CLAUDE.md lines 28-219 are
generated and a regeneration silently reverts direct edits.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/input/gamepad.ts` | input adapter | polled snapshot | Nothing in the repo touches `navigator` or polls a device. Use RESEARCH.md Pattern 5 lines 679-684 (flagged `[ASSUMED]` / LOW confidence) plus the `LoopScheduler` injection shape (S5) for testability. |
| `src/debug/tuning-panel.ts` (lil-gui half) | dev tool | third-party widget tree | No third-party UI library has ever been imported in this repo. `three/addons/libs/lil-gui.module.min.js` is a first-in. Only the *gating*, *layering-comment*, *persistence-validation* and *dispose* patterns transfer; the `gui.addFolder`/`onChange`/`save`/`load`/`reset` calls come from RESEARCH.md lines 987-1041 and UI-SPEC.md's Dev Tooling Contract. |

Partial-analog note: `src/hud/speedometer.ts`'s **SVG** construction has no
precedent (`createElementNS` appears nowhere in `src/`). Its *structure* — pure
half + DOM half, `style.cssText`, `textContent`, handle interface with `dispose` —
is an exact copy of `profiler-hud.ts`; only the element-creation calls are new,
and UI-SPEC.md's Speedometer Geometry Contract specifies every one of them exactly.

---

## Metadata

**Analog search scope:** `src/**` (14 files, all read), `tests/**` (15 files; 6 read
in full, 9 identified by name/import graph), `package.json`, `vite.config.ts`,
`vitest.config.ts`
**Files scanned:** 32
**Files read in full:** 20
**Pattern extraction date:** 2026-09-09

**Verification commands available to the planner:**

| Purpose | Command |
|---|---|
| Full gate | `npm run check` (`tsc --noEmit && biome check . && vitest run`) |
| Typecheck only | `npm run typecheck` |
| Lint only | `npm run lint` (Biome 2.5.12) |
| Single test file | `npx vitest run tests/vehicle-telemetry.test.ts` |
| Single case | `npx vitest run tests/vehicle-telemetry.test.ts -t accel` |

> `--reporter=basic` does not exist in Vitest 5 and errors at startup
> (RESEARCH.md line 1190). Use the default reporter, or
> `--reporter=verbose --silent=false` when `console.log` output is needed.
