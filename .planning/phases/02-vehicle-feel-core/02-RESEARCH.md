# Phase 2: Vehicle Feel Core - Research

**Researched:** 2026-09-08
**Domain:** Rapier `DynamicRayCastVehicleController` tuning, arcade-assist layering, fixed-tick input ramping, DOM/SVG HUD gauges, scripted physics telemetry
**Confidence:** HIGH for the physics core (measured by execution against the pinned `@dimforge/rapier3d@0.20.0` in this session), MEDIUM for the assist-layer gains and the HUD/input conventions

> **How to read the confidence tags in this document.** Claims marked
> `[MEASURED]` were produced by building the actual vehicle in `@dimforge/rapier3d@0.20.0`
> under Vitest and stepping it — the numbers are outputs of this repo's own pinned
> engine, not recollection. Claims marked `[SOURCE: …]` were read out of the shipped
> package or the upstream Rust source. `[ASSUMED]` claims are training knowledge and
> are all listed in the Assumptions Log.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Drift & Oversteer Control Scheme**
- **D-01:** Dedicated handbrake input locks rear-wheel friction near-zero on press — a reliable, learnable drift-initiation trigger (Dukes of Hazzard/Bullitt-style handbrake turn). `InputFrame.handbrake` already exists from Phase 1 (currently ignored by design — see `src/physics/debug-scene.ts` comment) and should now be wired to the vehicle controller's rear-wheel side-friction-stiffness reduction.
- **D-02:** Handbrake is **binary** (on/off), not analog — simpler to tune, matches its role as a deliberate drift trigger rather than a fine-grained control. Keyboard: spacebar convention. Gamepad: a face button or bumper.
- **D-03:** A light arcade-assist layer helps the player catch/recover from a slide — a subtle stabilizing yaw torque proportional to `(desiredHeading − actualHeading)`, layered on top of the physics body per CLAUDE.md's documented mitigation. Not baked into friction values; a separate tunable assist strength.
- **D-04:** Late braking has a **visible** consequence: hard braking while turning reduces front grip and the car understeers/skids straight rather than merely lengthening stopping distance. This is a readable penalty for over-committing to a brake, not just a longer stopping distance.

**Feel Reference Anchor**
- **D-05:** Primary feel reference is **Bullitt's Mustang chase** (film) — heavy, momentum-driven, hard body-roll through corners. This anchors the human-playtest sign-off in Success Criterion 5 ("reads as a heavy muscle car").
- **D-06:** For this phase specifically (physics/handling only — no audio/camera/surfaces yet), the top priority is **visible body roll and weight transfer** under cornering, braking, and acceleration — the chassis should read as heavy even before any slide happens. Favor lower suspension stiffness for visible dive/squat/roll per CLAUDE.md's guidance, over prioritizing momentum/line-commitment alone.
- **D-07:** Jump landings use an **auto-level assist** — a gentle in-air torque nudges the chassis toward level/wheels-down as it approaches the ground, guaranteeing a driveable landing per Success Criterion 3 regardless of takeoff angle. This is a distinct tunable assist from the slide-catch assist (D-03).
- **D-08:** Rollover resistance at the full-lock 60mph turn (Success Criterion 3) comes from an **arcade-assist layer** — a speed-scaled downforce impulse and/or anti-roll torque on top of the physics body — rather than relying solely on physical tuning (CoM, track width, suspension). This guarantees the no-roll requirement holds even as other tuning parameters drift during iteration.
- **D-09:** **Vehicle controller architecture must be generic/reusable, not player-hardcoded.** NPC pursuers/racers (Phase 7/8) will reuse the same vehicle controller class and tuned handling parameters for consistency in a chase — but this phase does NOT build NPC AI or the kinematic/full-physics LOD-switching itself (that belongs to Phase 7/8, informed by CLAUDE.md's existing guidance to run distant pursuers as a simplified kinematic model and only promote to full vehicle-controller physics near the player). Concretely: design the controller to take a car config in and produce a controller out, without assuming "the player" as the only caller.

**Speedometer / HUD Gauge**
- **D-10:** Retro analog speedometer — a period-correct circular needle gauge (white numerals on black face, amber redline zone) with a small digital readout inset, matching the 60s-70s chase-cinema tone. (Corrected mid-discussion: an earlier turn recorded "modern neutral HUD gauge" by mistake — retro analog is the locked decision.)
- **D-11:** Units: **mph** (matches the American muscle-car setting and the mph figures already used in ROADMAP.md, e.g. "120mph ramp jump").
- **D-12:** Placement: **bottom-right corner**, needle range **0–160mph** (headroom above the 120mph ramp-jump target without pinning at redline during normal driving).
- **D-13:** The digital numeric readout uses **slight damping/smoothing** to avoid jitter from physics noise; the needle itself may move instantly/unsmoothed.

**Telemetry Targets & Tuning Panel**
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

### Deferred Ideas (OUT OF SCOPE)

- NPC/pursuer AI driving logic and the kinematic-vs-full-physics LOD switching for distant pursuers — belongs to Phase 7 (AI racers) and Phase 8 (Getaway/heat pursuers). Only the requirement that the vehicle controller be built generically (D-09) applies now.
- Player-facing handling/assist settings (e.g. an accessibility "assist strength" slider) — explicitly out of scope for v1 per REQUIREMENTS.md; the tuning panel stays dev-only (D-15).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **VEH-01** | Player can drive a car with weighty, momentum-driven handling — late braking has real consequences, understeer/oversteer are readable and controllable | §The Spike, Answered; §Tuning Reference (Config A hits 6.28 s 0-60 and 120 ft 60-0 [MEASURED]); Pattern 2 (per-wheel grip model); Pitfall 8 (D-04 understeer-on-brake emerges free from the friction circle **only** at low `frictionSlip`) |
| **VEH-02** | Player steers via smoothed/analog input on both keyboard and gamepad | Pattern 5 (fixed-tick input ramping); §Steering Ramp Numbers [MEASURED]; Pitfall 11 (a per-rAF lerp is framerate-dependent and breaks VEH-03) |
| **VEH-04** | Vehicle can go airborne off jumps/ramps and lands stably without the physics breaking | Pattern 4 (auto-level assist, D-07) — [MEASURED] without it the chassis tumbles to 127° tilt and lands inverted; with gain 0.15–1.0 it lands at 12–37° and settles to <5°. Pitfall 6 (CCD at 120 mph), Open Question 2 (ramp geometry) |
| **NAV-01** | Player sees a live speedometer (needle + digital readout) | Pattern 6 (SVG needle gauge via `createElementNS` — `innerHTML` is banned repo-wide by `tests/layering.test.ts`); Pitfall 1 (**do not** use `currentVehicleSpeed()` — its sign is numerical noise at the default forward axis and it includes vertical velocity [MEASURED]) |
</phase_requirements>

---

## Summary

This phase's stated spike risk — *"can Rapier's `DynamicRayCastVehicleController` reach an arcade-realistic hybrid feel, or is it stuck between on-rails and uncontrollable?"* — **is answered: yes, and the reason the community reports it as stuck is a specific, identifiable mis-tuning.** I built the vehicle in this repo's pinned Rapier 0.20.0 and swept the dials headlessly under Vitest. Three findings settle it:

1. **`frictionSlip` is a friction-circle radius scaled by wheel load, and it saturates.** Max lateral tire force per wheel is `wheelLoad × frictionSlip`; max longitudinal force is `2 × wheelLoad × frictionSlip` [SOURCE: rapier `ray_cast_vehicle_controller.rs`, `update_friction`]. Rapier's default is `10.5` and the official three.js example uses `1000.0` — both produce **identical** on-rails behaviour (3.48 g and 3.49 g on the same skidpad [MEASURED]), because above ~10 the circle is never the binding constraint. Everyone who "tries lowering friction slip from 1000 to 100 and nothing happens" is inside the saturated region. The *useful* range is **0.6 to 2.0**: 0.6 → 0.52 g, 1.0 → 0.84 g, 1.5 → 1.25 g [MEASURED]. A period-correct muscle car lives at ~1.0–1.2.
2. **`sideFrictionStiffness` is the slip-angle dial, and it is violently non-linear.** It scales the lateral-velocity-cancelling impulse *before* the friction-circle clamp. Dropping the two rear wheels from 1.0 → 0.3 does essentially nothing; 0.04 gives a 12° slide; 0.01 gives a **34–66° Bullitt-grade handbrake slide that recovers under counter-steer in 0.5–1.6 s**; 0.0 spins the car [MEASURED]. This is exactly D-01/D-02, and it works. The dial must be exposed logarithmically in lil-gui or it is untunable.
3. **The assists are not optional garnish — two of them are load-bearing, and the priorities in CONTEXT.md are partly inverted.** D-07's in-air auto-level is *essential*: without it a 120 mph launch tumbles to 127° and lands inverted every time; with it the car lands driveable [MEASURED]. D-06's body roll does **not** come for free — Rapier hardcodes `roll_influence = 0.1` and does not expose it to JS [SOURCE: rust source line 200], so lateral tire forces are applied almost at the CoM plane and produce only **1.5–2° of roll at 0.85 g** where a real car rolls 4–6°. Conversely **D-08's rollover risk does not exist**: full lock at 60 mph *and* at 110 mph produced ≤1.5° of tilt at every `frictionSlip` tested, and the car never came close to rolling [MEASURED]. The dangerous direction is too *little* roll, not too much — and the roll assist that fixes D-06 is itself the most unstable piece of code in the phase (gain 0.1 → a lovely 5.5°; gain 0.2 → the car flips onto its roof [MEASURED]). It must ship with a hard clamp and a telemetry stability gate.

Two secondary findings materially reduce scope: **the tuning panel needs zero new dependencies** — `three@0.185.1` ships lil-gui at `three/addons/libs/lil-gui.module.min.js` and `@types/three@0.185.4` ships its `.d.ts`, and `gui.save()/load()/reset()` map one-to-one onto D-17's localStorage persistence + reset button (verified: the import typechecks clean under `tsc --noEmit`). And **the telemetry track can be the same code in two runners** — a scripted routine driving `world.step()` in-process is bit-reproducible (two runs of a 600-tick scripted routine produced identical `takeSnapshot()` FNV hashes and identical float positions [MEASURED]), so one set of pure routines serves both an in-browser `?debug` run against live-tuned values (SC5's literal requirement) and a Vitest regression suite against committed defaults.

**Primary recommendation:** Build `src/physics/vehicle.ts` as a config-in/controller-out factory (D-09) with `frictionSlip ≈ 1.2`, front `sideFrictionStiffness = 1.0`, a permanent rear bias of `0.12`, handbrake dropping the rear pair to `0.01`, ~4000 N engine force per rear wheel and ~60 N·s brake per wheel — the measured combination that hits both of D-14's targets — then layer four independently-clamped per-tick assists (auto-level, body-roll, slide-catch yaw, downforce) applied via `chassis.applyTorqueImpulse` / `applyImpulse` **after** `updateVehicle(DT)` and **before** `world.step()`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Vehicle rigid body, wheels, per-wheel grip | `src/physics/` | — | Owns Rapier. Already covered by `tests/layering.test.ts`'s "no `three` in `src/physics/`" rule, so placing the vehicle here costs zero test changes. |
| Arcade assists (roll, auto-level, yaw-catch, downforce) | `src/physics/` | — | They read wheel telemetry from the controller and write impulses to the chassis. Pure physics; must be inside the fixed tick. |
| Tuning config type + defaults | `src/core/` | — | A plain data object with no engine dependency. `src/core/` purity rule holds. Both the physics layer and the dev panel import it; neither owns it. |
| Keyboard/gamepad → `InputFrame` | `src/input/` (new) | — | Touches `document` and `navigator`, so it cannot live in `src/core/` (the layering test forbids `document.`/`window.` there). Phase 1's `input-tape.ts` doc comment already reserves this: *"A real keyboard/gamepad source is Phase 2's job and lives outside `src/core/`."* |
| Keyboard analog ramping | `src/input/` | — | Must advance per **fixed tick** using `DT`, never per rAF frame. The existing layering rule (`performance.now()` only in `loop.ts` and `src/debug/`) mechanically enforces this — a wall-clock ramp is not expressible here. |
| Chassis + wheel meshes, wheel visual rig | `src/render/` | — | Owns `three`. Reads `wheelSuspensionLength`/`wheelSteering`/`wheelRotation` and writes only mesh transforms. |
| Speedometer gauge (NAV-01) | `src/hud/` (new) | `src/render/` | Player-facing, so **not** `src/debug/`. A new `src/hud/` needs a matching rule added to `tests/layering.test.ts` (same rule as `src/render/`: never writes sim state). Placing it in `src/render/` instead avoids the test edit but muddies "render = 3D scene". |
| lil-gui tuning panel (D-15/D-16/D-17) | `src/debug/` | — | `src/debug/**` may import anything but must never affect sim timing. Panel writes tuning values; the physics layer reads them next tick. |
| Telemetry routines (pure) | `src/physics/telemetry/` | — | Shared by both runners. No DOM, no `three`. |
| Telemetry browser runner | `src/debug/` | — | `?debug` gated, builds its own throwaway `RAPIER.World`. |
| Telemetry CI runner | `tests/` | — | Vitest; asserts against committed defaults. |

---

## The Spike, Answered

> This section exists because CONTEXT.md and STATE.md both flag this phase's core risk as *"whether Rapier's raycast vehicle can reach the arcade-realistic hybrid feel at all — a spike, not an assumption."* Everything below is measured output from `@dimforge/rapier3d@0.20.0` as installed in this repo, run under Vitest in Node.

### How Rapier's tire model actually works

`[SOURCE: dimforge/rapier src/control/ray_cast_vehicle_controller.rs, fn update_friction]`

Per wheel, per call to `updateVehicle(dt)`:

```
sideImpulse    = solveLateralConstraint(...)      // kills lateral velocity at the contact
sideImpulse   *= sideFrictionStiffness             // <-- dial 1, applied BEFORE the clamp
forwardImpulse = engineForce * dt                  // if engineForce != 0
                 OR rollingFriction(capped by brake)   // else

maxImpulse     = wheelSuspensionForce * dt * frictionSlip     // <-- dial 2 (the friction circle)
if ((0.5*forwardImpulse)^2 + (sideImpulse)^2 > maxImpulse^2):
    scale BOTH impulses down by maxImpulse / |(0.5*fwd, side)|
```

Four consequences the planner must design around:

| Consequence | Why it matters here |
|---|---|
| `maxImpulse` is proportional to **`wheelSuspensionForce`** — the live vertical load | Weight transfer automatically changes grip. Dive under braking genuinely unloads the rear; squat under power genuinely unloads the front. This is free realism and is why soft springs (D-06) also improve *feel*, not just looks. |
| Longitudinal capacity is **2×** lateral capacity (`fwd_factor = 0.5`, `side_factor = 1.0`) | Braking eats the friction budget, so **D-04's brake-while-turning understeer is emergent, not authored** — but only when the circle is actually reached, i.e. only at low `frictionSlip`. At the three.js example's `1000.0` it never binds and D-04 cannot happen. |
| The clamp scales *both* impulses by the same factor | Exceeding the circle with engine force does **not** produce oversteer; it produces proportional loss of everything. See "Power oversteer is not emergent" below. |
| `sideFrictionStiffness` multiplies **before** the clamp | At low `frictionSlip` the clamp re-binds and hides most of the change; at high `frictionSlip` it is the dominant lateral dial. This explains the "it does nothing / it does everything" contradiction in community reports. |

### Measured: the `frictionSlip` saturation cliff

Steady-state skidpad, 45 mph, 15° steer, Config A. Lateral g computed as `yawRate × speed / 9.81`.

| `frictionSlip` | lat. g | Reads as |
|---|---|---|
| 0.6 | 0.52 | Sloppy, washes out |
| **1.0** | **0.84** | **Period-correct muscle car** |
| **1.5** | **1.25** | Modern sports car |
| 3.0 | 2.48 | Arcade on-rails |
| 10.5 *(Rapier default)* | 3.48 | On-rails |
| 1000 *(three.js example)* | 3.49 | On-rails — **identical to 10.5** |

`[MEASURED]` **The dial is dead above ~10.** Anything in the CLAUDE.md tuning table's `1000.0` neighbourhood is outside the control region entirely.

### Measured: `sideFrictionStiffness` is the slip-angle dial

Handbrake test — 60 mph entry, 0.45 rad steer, rear pair dropped for the hold duration, then restored to a 0.12 baseline, with a proportional counter-steer standing in for a human. Config B.

| rear `sideFrictionStiffness` | hold | max slip angle | recovery after release | end speed |
|---|---|---|---|---|
| 0.04 | 0.75 s | 12° | 0.18 s | 91 mph |
| 0.02 | 0.75 s | 23° | 0.37 s | 88 mph |
| **0.01** | **0.75 s** | **34°** | **0.53 s** | 85 mph |
| **0.01** | **1.5 s** | **66°** | **1.57 s** | 50 mph |
| 0.004 | 0.75 s | 56° | 1.95 s | 59 mph |
| 0.004 | 1.5 s | 179° (full spin) | 2.33 s | 27 mph |
| 0.0 | 0.75 s | 101° | 2.60 s | 30 mph |

`[MEASURED]` **`0.01` is the target.** It produces a large, held, speed-scrubbing slide that counter-steer reliably catches — the Bullitt/Dukes handbrake turn, recoverable rather than terminal. Note the shape of the curve: the entire useful range is `0.004 → 0.04`, a 10× span inside the bottom 4% of a naive `0..1` slider. **The lil-gui control for this must be logarithmic or bounded to `0 .. 0.05`.**

Rear-only beats all-four decisively `[MEASURED]`: rear-only at 0.01 → 59° slide; all-four at 0.02 → 26°; all-four at 0.05 → 9°. Rear-only preserves front steering authority, which is what makes counter-steer work. This validates D-01's rear-wheel-only design.

A **permanent** rear bias also works as a baseline RWD-loose character `[MEASURED]`, 45 mph, 0.3 rad steer, 5000 N/wheel:

| permanent rear `sideFrictionStiffness` | max slip |
|---|---|
| 1.0 | 0.9° |
| 0.25 | 0.4° |
| 0.12 | 2.2° |
| 0.06 | 6.5° |

Recommend **0.12** as the baseline (mild looseness without instability), reserving `0.01` for the handbrake.

### Measured: power oversteer is NOT emergent — it must be authored

Engine-force sweep at 0.3 rad steer, Config B:

| engine force / rear wheel | `frictionSlip` | max slip angle |
|---|---|---|
| 4 000 N | 1.2 | 1.8° |
| 8 000 N | 1.2 | 0.8° |
| 15 000 N | 1.2 | 0.5° |
| 25 000 N | 0.9 | 0.4° |

`[MEASURED]` Throttle cannot break the rear loose at *any* engine force, because the friction-circle clamp scales the side impulse down proportionally rather than releasing it — the car understeers and accelerates in a wider arc instead of rotating.

**Consequence for SC1** ("*provoke oversteer with throttle **or** handbrake*"): the handbrake half works out of the box; the throttle half must be **explicitly authored** as a game-logic term — e.g.
`rearSfs = lerp(baseline, handbrakeValue, powerOversteerGain × throttle × |steer|)`. Add this as a tunable (it is squarely within D-16's "expose all knobs" and within Claude's discretion on assist mechanism). The planner should not write a task that assumes throttle-oversteer emerges from tuning alone; it will not.

### Measured: rollover is a non-risk; body roll is the real problem

`roll_influence` is hardcoded to `0.1` in Rapier and carries a `// TODO: make this public?` comment; it is **not** exposed through the JS bindings `[SOURCE: rust source, `Wheel::new`]`. Its effect: the lateral tire impulse is applied at a point moved 90% of the way from the contact patch up to the CoM plane, so lateral forces generate almost no roll moment.

| Test | Result |
|---|---|
| Full lock (π/4) at 60 mph, `frictionSlip` 1.0 / 1.5 / 3.0 | min chassis-up·world-up = **1.000 / 1.000 / 0.999** — i.e. ≤2.6° tilt, no rollover in any case |
| Full lock at **110 mph** | max tilt **1.2°** |
| Steady 45 mph corner at 0.85 g, CoM at −0.25, k=18 | roll **1.05°** |
| Same, CoM raised to 0.0, k=10 (very soft) | roll **3.42°** |
| Same, CoM raised to +0.25, k=10 | roll 13.5° — but this configuration is at the edge of instability |
| Braking dive, 60-0, k=30 / 18 / 10 | pitch **2.0° / 2.9° / 6.7°** |

`[MEASURED]` Two conclusions:

- **D-08 (anti-rollover assist) is solving a problem that does not occur.** SC3's "full-lock 60mph turn without the car rolling" passes with no assist at all. Keep the downforce/anti-roll knob (D-16 requires exposing it, and Phase 3's surfaces or Phase 4's uneven terrain may reintroduce the risk), but **default it to zero** and do not spend implementation effort tuning it now. Report this to the user — it inverts the stated priority.
- **D-06 (visible body roll) does not come free and is the genuinely hard part.** Dive/squat *does* work out of the box (pitch scales cleanly with softness — 6.7° at k=10) because longitudinal impulses are not roll-reduced. Roll does not. Getting Bullitt-grade roll requires an explicit assist.

### Measured: the assist layer

All assists applied as `chassis.applyTorqueImpulse(...)` / `applyImpulse(...)` **after** `vc.updateVehicle(DT)` and **before** `world.step()`. Gains are expressed as multiples of the chassis principal inertia so they stay meaningful when mass/geometry are retuned.

**D-07 auto-level (gate: apply only when zero wheels are in contact).** 120 mph launch with a nose-up pitch and off-axis spin injected:

| level gain | max air tilt | tilt at touchdown | final tilt |
|---|---|---|---|
| **0 (none)** | 127° | — never landed on its wheels — | **129° (inverted)** |
| 0.15 | 124° | 37° | 1.7° |
| 0.4 | 95° | 21° | 4.4° |
| 1.0 | 111° | 12° | 2.0° |

`[MEASURED]` **Without D-07 the car is guaranteed to land inverted.** VEH-04 and SC3 are unachievable without it. Gain 0.4 (with a 0.6× derivative term) is a good default — high enough to land shallow, low enough to keep the jump readable.

**D-06 body-roll assist — works, with a cliff.** Open-loop torque about the chassis forward axis, magnitude `gain × I_x × lateralAccel`, minus a `1.2 ×` roll-rate damping term. 45 mph, 0.26 rad steer:

| roll gain | max roll |
|---|---|
| 0 | 1.55° |
| 0.02 | 2.28° |
| 0.05 | 3.43° |
| **0.10** | **5.46°** ← Bullitt range |
| 0.20 | **89° — car flips onto its roof** |

`[MEASURED]` This is positive feedback: rolling the body shifts the suspension load, which changes lateral force, which feeds the torque. **It must ship with (a) a hard cap on applied torque magnitude, (b) an absolute cutoff that disables the assist above ~15° of roll, and (c) a telemetry gate asserting no scripted routine ever produces >15° tilt.**

I also tried the more elegant-looking formulation — a PD controller driving actual roll toward a *clamped target* roll angle — expecting it to be inherently safe. **It flipped the car at every gain and cap I tried (4°/g, 8°/g, 20°/g, caps 7° and 12°; all reached ~85° roll and inverted).** `[MEASURED]` Reported honestly: do **not** plan a task that assumes clamped-PD-toward-target is the safe formulation. The open-loop-plus-damping form above is what measured well.

**D-03 slide-catch yaw assist — near-inert at the recommended tuning.** Yaw torque `gain × I_y × (−slipAngle)` minus `0.35 ×` yaw-rate damping, applied after a handbrake slide is released:

| yaw gain | max slip | recovery after release |
|---|---|---|
| 0 | 13.0° | 0.47 s |
| 0.05 | 12.9° | 0.47 s |
| 0.15 | 12.8° | 0.45 s |
| 0.35 | 12.4° | 0.42 s |

`[MEASURED]` At a 0.04 handbrake the tires already recover the car in ~0.45 s regardless, so the assist has nothing to do. It also (correctly) does **not** kill the drift while the handbrake is held — 12.8° vs 13.0° with the assist on. Implement it as D-03 and D-16 require, default it low (0.1), and set expectations: **the thing that makes slides catchable is restoring `sideFrictionStiffness` on handbrake release, not the yaw torque.** The assist becomes meaningful only at the deeper `0.01`/`0.004` handbrake settings where slides persist for 1.5–2.5 s — which is where the recommended tuning actually sits, so it is worth having.

### Residual risk (honest)

The one thing headless measurement cannot settle is **whether 34–66° of slip angle reads on screen as a Bullitt slide**. It is the right number physically, but SC5's human playtest sign-off is the only real test, and the helicopter camera that will frame it does not exist until Phase 3. Plan the human-verification checkpoint accordingly, and expect the tuning session — not the implementation — to be the long pole.

---

## Standard Stack

### Core — already installed, nothing to add

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dimforge/rapier3d` | `0.20.0` (pinned) | `world.createVehicleController(chassis)` + per-wheel setters/getters | Already a project dependency. Its `DynamicRayCastVehicleController` is the reason CLAUDE.md chose Rapier. `[VERIFIED: node_modules, `RAPIER.version() === "0.20.0"` asserted in `tests/rapier-smoke.test.ts`]` |
| `three` | `0.185.1` (pinned) | Chassis + wheel meshes, wheel visual rig | Already a project dependency. |
| `@types/three` | `0.185.4` (pinned) | Types for both `three` and its bundled addons | Already a project dependency. Ships `examples/jsm/libs/lil-gui.module.min.d.ts` and maps `three/addons/*` → `examples/jsm/*` in its exports. `[VERIFIED: read from `node_modules/@types/three/package.json`]` |
| `vitest` | `5.0.0` (pinned) | Telemetry regression harness | Rapier already runs headless under the existing `vitest.config.ts`. |

### Supporting — the tuning panel needs NO new package

| Choice | Where it comes from | Notes |
|--------|--------------------|-------|
| **lil-gui 0.17.0** | `three/addons/libs/lil-gui.module.min.js` — **bundled inside `three@0.185.1`** | `[VERIFIED: file exists at `node_modules/three/examples/jsm/libs/lil-gui.module.min.js`, header says `@version 0.17.0`]`. Typed by `@types/three`. `import GUI from "three/addons/libs/lil-gui.module.min.js"` compiles clean under `tsc --noEmit` with `typescript@7.0.2`, including `gui.add/addFolder/onChange/save/load/reset/domElement` — **I ran this check in this session.** |
| Gamepad input | `navigator.getGamepads()` — browser built-in | No package. Must be **polled**, not event-driven. |
| Persistence | `localStorage` + `gui.save()`/`gui.load()` | `gui.save(true)` returns a plain nested object; `gui.load(obj, true)` restores it; `gui.reset(true)` restores initial values — an exact one-to-one fit for D-17. `[VERIFIED: read from `@types/three`'s lil-gui `.d.ts`]` |
| Gauge rendering | SVG built with `document.createElementNS` | See Pitfall 12 — `innerHTML` is banned repo-wide by `tests/layering.test.ts`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| three-bundled lil-gui 0.17.0 | `npm i -D lil-gui@0.21.0` | Newer, own `.d.ts`, `gui.controllersRecursive()` improvements. **Rejected:** adds a dependency for a dev-only panel when a typed, working copy already ships with `three`. Phase 1's threat model deliberately resisted new packages. If a 0.21-only feature is ever needed, this is a clean single-package upgrade. |
| lil-gui | `tweakpane@4.0.5` | Nicer aesthetics, better numeric input. **Rejected:** new dependency; last published 2024-11 vs lil-gui 2025-10; three does not bundle it. |
| SVG needle gauge | Canvas 2D gauge | Canvas needs manual redraw scheduling and DPR handling. SVG gets a rotating needle from one `transform` attribute write per frame and scales for free. **SVG recommended.** |
| SVG needle gauge | CSS `transform: rotate()` on a `<div>` | Fewer nodes, but tick marks and the arced redline band are far more awkward. Viable if the design stays minimal. |
| Rapier vehicle controller | Hand-rolled 4-raycast suspension | Explicitly rejected by CLAUDE.md's "What NOT to Use", and this session's measurements confirm the built-in model already gives load-sensitive grip, a friction circle and full per-wheel telemetry. |
| `applyTorqueImpulse` for assists | `addTorque` (persistent force) | `addTorque` persists across steps until `resetTorques()` — a missed reset silently accumulates. Impulses are consumed by each `world.step()`. **Use impulses.** |

**Installation:** none. `npm install` is not required for this phase.

---

## Package Legitimacy Audit

The only package considered for addition was `lil-gui`, and the research concluded it is **not needed** (three bundles it). The audit is recorded anyway because the decision could be revisited.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `lil-gui` | npm | created 2019-09-15, latest `0.21.0` published 2025-10-12, 36 versions | 149 794 / week | `github.com/georgealways/lil-gui` | **[OK]** (`slopcheck install lil-gui` run in this session) | **NOT ADDED** — superseded by the copy bundled in `three@0.185.1` |

`npm view lil-gui scripts` shows **no `postinstall` script** `[VERIFIED: npm registry]`.

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.
**Net dependency change for this phase: zero.**

---

## Architecture Patterns

### System Architecture Diagram

```
 ┌────────── browser event stream (async, unordered w.r.t. ticks) ──────────┐
 │  keydown / keyup            navigator.getGamepads()                      │
 └───────────┬───────────────────────────┬──────────────────────────────────┘
             │                           │
             ▼                           ▼
      ┌──────────────────────────────────────────┐
      │  src/input/  LiveInputSource              │   latches raw key state; polls pads
      │    · sampleForTick(tick) -> InputFrame    │   ramp advances by DT ONCE per new tick
      │    · keyboard analog ramp (DT-driven)     │   (idempotent: guards on lastTick)
      └──────────────────┬───────────────────────┘
                         │  InputFrame {steer, throttle, brake, handbrake}
                         ▼
  ══════════ src/loop.ts  FIXED TICK (DT = 1/60, existing Phase 1 loop) ══════════
                         │
      transforms.captureAsPrevious()
                         │
      onTickBegin(tick) ─┤
                         ▼
      applyInput(frame) ─►┌────────────── src/physics/vehicle.ts ───────────────┐
                          │ 1. map InputFrame -> controller setters             │
                          │      setWheelSteering(0..1, -steer * maxLock)       │
                          │      setWheelEngineForce(2,3)  [0 when braking!]    │
                          │      setWheelBrake(0..3)                            │
                          │      setWheelSideFrictionStiffness(2,3)             │
                          │         = handbrake ? 0.01 : rearBias(throttle,steer)│
                          │ 2. vc.updateVehicle(DT)   ◄── raycasts, suspension, │
                          │                               tire impulses -> body │
                          │ 3. read wheel telemetry:                            │
                          │      wheelIsInContact / SuspensionForce /           │
                          │      SideImpulse / SuspensionLength                 │
                          │ 4. assists -> chassis.applyTorqueImpulse/applyImpulse│
                          │      · auto-level   (0 wheels in contact)  D-07     │
                          │      · body roll    (>=3 wheels, clamped)  D-06     │
                          │      · slide-catch yaw                     D-03     │
                          │      · downforce / anti-roll (default 0)   D-08     │
                          └─────────────────────────┬───────────────────────────┘
                                                    │  accumulated impulses
                         world.step()  ◄────────────┘
                         │
      onTickEnd(tick, events)
                         │
      transforms.captureAsCurrent()
  ═══════════════════════╪═══════════════════════════════════════════════════════
                         │  (once per rAF, alpha = clock.alpha(now))
             ┌───────────┴────────────┬─────────────────────────┐
             ▼                        ▼                         ▼
   src/render/interpolator     src/render/vehicle-view   src/hud/speedometer
     chassis mesh (lerp/slerp)   wheel meshes read          reads chassis.linvel()
                                 wheelSuspensionLength      -> hypot(x,z) -> mph
                                 wheelSteering              needle: instant
                                 wheelRotation              digits: damped (D-13)

  ── dev-only, ?debug gated, never inside the tick ──────────────────────────────
   src/debug/tuning-panel  ──writes──►  VehicleTuning object ──read next tick──►
        lil-gui  ·  gui.save() -> localStorage  ·  gui.reset() -> defaults
   src/debug/telemetry-runner ──builds a SEPARATE throwaway RAPIER.World──►
        src/physics/telemetry/routines.ts  (pure, shared)  ◄── tests/vehicle-telemetry.test.ts
```

### Recommended Project Structure

```
src/
├── core/
│   ├── input-tape.ts              # EXISTING — InputFrame unchanged, no edits needed
│   ├── sim-clock.ts               # EXISTING — DT is the only timestep
│   └── vehicle-tuning.ts          # NEW  VehicleTuning type + DEFAULT_TUNING (pure data)
├── input/                         # NEW DIRECTORY
│   ├── keyboard.ts                #   raw latched key state
│   ├── gamepad.ts                 #   navigator.getGamepads() polling + deadzone
│   └── live-input.ts              #   InputSource impl; DT-driven analog ramp
├── physics/
│   ├── world.ts                   # EXISTING — unchanged
│   ├── transform-cache.ts         # EXISTING — unchanged
│   ├── debug-scene.ts             # REPLACED by vehicle-scene.ts (see Integration below)
│   ├── vehicle.ts                 # NEW  createVehicle(world, tuning) -> Vehicle  (D-09)
│   ├── vehicle-assists.ts         # NEW  the four clamped assists
│   ├── vehicle-scene.ts           # NEW  flat plane + ramp + one Vehicle
│   └── telemetry/
│       ├── routines.ts            # NEW  pure scripted routines + pass/fail targets
│       └── run.ts                 # NEW  buildWorld(tuning) -> run(routine) -> Result
├── render/
│   ├── interpolator.ts            # EXISTING — unchanged
│   ├── renderer.ts                # EXISTING — unchanged
│   └── vehicle-view.ts            # NEW  chassis + 4 wheel meshes, wheel rig
├── hud/                           # NEW DIRECTORY (player-facing, not debug)
│   └── speedometer.ts             # NEW  SVG needle gauge (NAV-01, D-10..D-13)
└── debug/
    ├── debug-gate.ts              # EXISTING — reuse DEBUG_ENABLED + onDebugToggle
    ├── profiler-hud.ts            # EXISTING — the DOM-overlay pattern to copy
    ├── tuning-panel.ts            # NEW  lil-gui (D-15/16/17)
    └── telemetry-hud.ts           # NEW  runs routines, prints the results table

tests/
├── layering.test.ts               # MODIFY — add src/input/ and src/hud/ rules
└── vehicle-telemetry.test.ts      # NEW  the CI regression half of SC5
```

**Why `src/physics/vehicle.ts` and not `src/vehicle/`:** `tests/layering.test.ts` already enforces "no `three` import" on every file under `src/physics/`. Putting the vehicle there gets that guarantee for free; a new top-level `src/vehicle/` would need a new rule added to the test or it would be silently unpoliced.

---

### Pattern 1: Config-in / controller-out vehicle factory (D-09)

**What:** One pure factory that takes a tuning object and a world and returns an opaque handle. No reference to "the player" anywhere.
**When to use:** Always. Phase 7/8 constructs pursuers through this same call.

```ts
// src/core/vehicle-tuning.ts — pure data, no engine import
export interface VehicleTuning {
  readonly chassis: {
    mass: number;                     // kg
    comOffset: { x: number; y: number; z: number };
    halfExtents: { x: number; y: number; z: number };
    linearDamping: number;
    angularDamping: number;
  };
  readonly wheels: {
    halfTrack: number; halfWheelbase: number; connectionY: number;
    radius: number; suspensionRestLength: number; maxSuspensionTravel: number;
    suspensionStiffness: number;      // MASS-NORMALISED — see Pitfall 3
    suspensionCompression: number; suspensionRelaxation: number;
    maxSuspensionForce: number;       // N — scale with mass, see Pitfall 4
    frictionSlip: number;             // friction-circle radius multiplier
    frontSideFriction: number;
    rearSideFriction: number;         // baseline RWD-loose bias
  };
  readonly drive: {
    engineForcePerRearWheel: number;  // N
    brakeImpulsePerWheel: number;     // N*s
    maxSteerLock: number;             // rad
    steerRampPerSec: number; steerReturnPerSec: number;
    handbrakeRearSideFriction: number;
    powerOversteerGain: number;       // authored throttle-oversteer, see The Spike
  };
  readonly assists: {
    autoLevelGain: number; autoLevelDamping: number;
    bodyRollGain: number; bodyRollDamping: number; bodyRollMaxDeg: number;
    slideCatchGain: number; slideCatchDamping: number;
    downforcePerSpeed2: number;       // D-08 — default 0, see The Spike
  };
}

// src/physics/vehicle.ts
export interface Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  /** Called once per fixed tick, before world.step(). */
  tick(frame: InputFrame, tuning: VehicleTuning): void;
  /** Live-retune without rebuilding — every setter is per-frame safe. */
  applyTuning(tuning: VehicleTuning): void;
  dispose(): void;
}

export function createVehicle(
  world: RAPIER.World,
  tuning: VehicleTuning,
  spawn: { x: number; y: number; z: number },
): Vehicle { /* ... */ }
```

`applyTuning` is what makes D-16/D-17's "no code edit" retuning work: every Rapier wheel property has a per-index setter that is safe to call every frame `[SOURCE: `ray_cast_vehicle_controller.d.ts`]`. Mass and CoM are the exception — see Pitfall 10.

---

### Pattern 2: The per-tick order is fixed and load-bearing

```ts
// inside applyInput(frame), called by src/loop.ts once per fixed tick
function tick(frame: InputFrame, t: VehicleTuning): void {
  // 1. INPUT -> CONTROLLER SETTERS
  const steer = -frame.steer * t.drive.maxSteerLock;   // see Pitfall 2 for the sign
  vc.setWheelSteering(FL, steer);
  vc.setWheelSteering(FR, steer);

  const braking = frame.brake > 0;
  // MUST be 0 when braking — a non-zero engine force makes Rapier ignore the
  // brake entirely on that wheel (Pitfall 7).
  const ef = braking ? 0 : -frame.throttle * t.drive.engineForcePerRearWheel;
  vc.setWheelEngineForce(RL, ef);
  vc.setWheelEngineForce(RR, ef);

  const bk = frame.brake * t.drive.brakeImpulsePerWheel;
  for (let i = 0; i < 4; i++) vc.setWheelBrake(i, bk);

  const rearSfs = frame.handbrake
    ? t.drive.handbrakeRearSideFriction
    : lerp(t.wheels.rearSideFriction, t.drive.handbrakeRearSideFriction,
           t.drive.powerOversteerGain * frame.throttle * Math.abs(frame.steer));
  vc.setWheelSideFrictionStiffness(RL, rearSfs);
  vc.setWheelSideFrictionStiffness(RR, rearSfs);

  // 2. SOLVE THE VEHICLE — writes suspension + tire impulses onto the chassis body
  vc.updateVehicle(DT);

  // 3. READ FRESH TELEMETRY (valid only after updateVehicle)
  let contacts = 0;
  for (let i = 0; i < 4; i++) if (vc.wheelIsInContact(i)) contacts++;

  // 4. ASSISTS — impulses accumulate onto the same buffer world.step() consumes
  applyAssists(body, vc, contacts, t.assists);

  // 5. src/loop.ts then calls world.step()
}
```

**Why this order.** `updateVehicle` raycasts, computes suspension and tire forces, and calls `apply_impulse_at_point` on the chassis `[SOURCE: rust `update_vehicle`]`. Everything it writes is consumed by the next `world.step()`. Assists applied *after* `updateVehicle` can read this tick's real wheel-contact and suspension-load state; assists applied *before* it are reading last tick's. Both land in the same impulse accumulator, so there is no double-application risk.

---

### Pattern 3: Clamped, gated arcade assists

**What:** Four independent per-tick torque/impulse terms, each with a gate, a gain expressed in multiples of chassis inertia, a damping term, and a hard clamp.
**When to use:** Every tick, after `updateVehicle`.

```ts
// src/physics/vehicle-assists.ts   (no `three` import — build vectors by hand)
export function applyAssists(
  body: RAPIER.RigidBody,
  vc: RAPIER.DynamicRayCastVehicleController,
  contacts: number,
  a: VehicleTuning["assists"],
  I: { x: number; y: number; z: number },   // principal inertia, cached at build time
): void {
  const q = body.rotation();
  const up = rotateVec(q, 0, 1, 0);
  const fwd = rotateVec(q, 0, 0, -1);
  const w = body.angvel();
  const v = body.linvel();

  // ---- D-07 AUTO-LEVEL: airborne only -------------------------------------
  if (contacts === 0 && a.autoLevelGain > 0) {
    // torque axis = up_local x world_up  =  (up.z, 0, -up.x)
    const kp = a.autoLevelGain * I.x;
    const kd = a.autoLevelGain * a.autoLevelDamping * I.x;
    body.applyTorqueImpulse({
      x: (up.z * kp - w.x * kd) * DT,
      y: (-w.y * kd * 0.2) * DT,          // light yaw damping only; don't fight the driver
      z: (-up.x * kp - w.z * kd) * DT,
    }, true);
  }

  // ---- D-06 BODY ROLL: grounded only, CLAMPED --------------------------------
  if (contacts >= 3 && a.bodyRollGain > 0) {
    const rollDeg = Math.asin(clamp(rotateVec(q, 1, 0, 0).y, -1, 1)) * 180 / Math.PI;
    // SAFETY CUTOFF — this assist is positive feedback (see The Spike).
    if (Math.abs(rollDeg) < a.bodyRollMaxDeg) {
      const latAccel = w.y * dot(v, fwd);                 // yawRate * forwardSpeed
      const rollRate = dot(w, fwd);
      const m = a.bodyRollGain * I.x * (latAccel - a.bodyRollDamping * rollRate);
      const capped = clamp(m, -a.bodyRollGain * I.x * 30, a.bodyRollGain * I.x * 30);
      body.applyTorqueImpulse(
        { x: fwd.x * capped * DT, y: fwd.y * capped * DT, z: fwd.z * capped * DT }, true);
    }
  }

  // ---- D-03 SLIDE CATCH: grounded, above a speed floor -----------------------
  const groundSpeed = Math.hypot(v.x, v.z);
  if (contacts >= 2 && groundSpeed > 2 && a.slideCatchGain > 0) {
    const slip = Math.atan2(dot2(v, rotateVec(q, 1, 0, 0)), dot2(v, fwd)); // rad, signed
    const kp = a.slideCatchGain * I.y;
    const kd = a.slideCatchGain * a.slideCatchDamping * I.y;
    body.applyTorqueImpulse({ x: 0, y: (-slip * kp - w.y * kd) * DT, z: 0 }, true);
  }

  // ---- D-08 DOWNFORCE: default gain 0, kept for later phases -----------------
  if (a.downforcePerSpeed2 > 0) {
    const f = a.downforcePerSpeed2 * groundSpeed * groundSpeed;
    body.applyImpulse({ x: 0, y: -f * DT, z: 0 }, true);
  }
}
```

Measured starting gains: `autoLevelGain 0.4` / damping `0.6`; `bodyRollGain 0.10` / damping `1.2` / `bodyRollMaxDeg 15`; `slideCatchGain 0.10` / damping `0.35`; `downforcePerSpeed2 0`.

---

### Pattern 4: Telemetry routines as pure data, two runners

**What:** One set of scripted routines; a browser runner for SC5's live-tuned verification and a Vitest runner for CI regression.

```ts
// src/physics/telemetry/routines.ts   — pure, no DOM, no `three`
export interface RoutineResult {
  id: string; label: string;
  value: number; unit: string;
  target: string; pass: boolean;
}
export interface Routine {
  id: string; label: string;
  /** Input for this tick given the current state; return null to end the routine. */
  drive(tick: number, s: VehicleSample): InputFrame | null;
  /** Accumulate measurements each tick. */
  sample(tick: number, s: VehicleSample, acc: Record<string, number>): void;
  evaluate(acc: Record<string, number>): RoutineResult;
}

// src/physics/telemetry/run.ts
export function runRoutine(routine: Routine, tuning: VehicleTuning): RoutineResult {
  const world = createWorld();                 // isolated — never the live game world
  buildTelemetryScene(world);                  // flat plane + slalom cones + ramp
  const vehicle = createVehicle(world, tuning, SPAWN);
  const acc: Record<string, number> = {};
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const s = sampleVehicle(vehicle);
    const frame = routine.drive(tick, s);
    if (frame === null) break;
    vehicle.tick(frame, tuning);
    world.step();
    routine.sample(tick, sampleVehicle(vehicle), acc);
  }
  const result = routine.evaluate(acc);
  world.free();                                 // WASM memory — see Pitfall 13
  return result;
}
```

Both runners import `runRoutine`. The browser runner passes the **live-tuned** object from the lil-gui panel; the Vitest runner passes `DEFAULT_TUNING`. That is what makes SC5's "retuned live … and re-verified … with no code edit" literally true.

**This is bit-reproducible.** `[MEASURED]` Two in-process runs of an identical 600-tick scripted routine (varying steer, cycling handbrake) produced identical `world.takeSnapshot()` FNV-1a hashes (`a9d2a6a`) and identical float positions to all printed digits. So the Vitest routines can assert exact values, not ranges — the same discipline `tests/determinism.test.ts` already established.

**It is fast enough to run in a frame or two.** `[MEASURED]` A four-config sweep totalling ~4 000 ticks completed in 47 ms; a 24-config sweep of ~30 000 ticks in 163 ms. A five-routine suite is ~100–300 ms — run it synchronously behind a hotkey and show a spinner, or chunk one routine per frame.

**Routine definitions (targets from D-14):**

| id | Routine | Measure | Target |
|----|---------|---------|--------|
| `accel` | Full throttle from rest, straight | sim time to 60 mph forward speed | 6.0–7.0 s |
| `brake` | Accelerate to 60 mph, then full brake, zero throttle | distance travelled to standstill | 110–135 ft |
| `skidpad` | Hold 45 mph and a fixed steer angle 4 s | steady-state `yawRate × speed / g` | 0.75–1.05 g |
| `slalom` | Alternate steer at a fixed period at 50 mph | max \|slip angle\|; must not exceed 90° and must return below 5° | no spin |
| `ramp` | 120 mph into the ramp | chassis tilt 0.5 s after touchdown | < 20° and forward speed > 40 mph |
| `stability` | Full lock at 60 mph, 5 s, roll assist ON | max chassis tilt | **< 15°** (guards the roll-assist cliff) |

---

### Pattern 5: Fixed-tick analog input ramping (VEH-02)

**What:** Keyboard produces an analog-equivalent axis by ramping toward the held direction at a fixed rate **per fixed tick**, never per rAF frame. Gamepad axes pass through with a deadzone.

```ts
// src/input/live-input.ts
export class LiveInputSource implements InputSource {
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private lastTick = -1;

  sampleForTick(tick: number): InputFrame {
    // sampleForTick must be idempotent per tick (input-tape.ts contract), and the
    // ramp is stateful — so only advance when the tick index actually moves on.
    if (tick > this.lastTick) {
      const steps = Math.min(tick - this.lastTick, MAX_CATCHUP);
      for (let i = 0; i < steps; i++) this.advance();
      this.lastTick = tick;
    }
    return { steer: this.steer, throttle: this.throttle, brake: this.brake,
             handbrake: this.rawHandbrake };
  }

  private advance(): void {
    const pad = readGamepadAxes();                      // null when no pad connected
    if (pad !== null) {
      // Analog source: pass through with a deadzone; NO ramp.
      this.steer = deadzone(pad.steer, 0.12);
      this.throttle = triggerDeadzone(pad.throttle);
      this.brake = triggerDeadzone(pad.brake);
      return;
    }
    // Keyboard: ramp toward the held target at a fixed rate per second.
    const target = (this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0);
    // Faster when reversing direction or returning to centre — this is what makes
    // counter-steer feel responsive without making the ramp itself twitchy.
    const rate = (target === 0 || Math.sign(target) !== Math.sign(this.steer))
      ? STEER_RETURN_PER_SEC : STEER_RAMP_PER_SEC;
    this.steer = approach(this.steer, target, rate * DT);
    this.throttle = approach(this.throttle, this.keyUp ? 1 : 0, THROTTLE_RATE * DT);
    this.brake = approach(this.brake, this.keyDown ? 1 : 0, BRAKE_RATE * DT);
  }
}
```

**Measured ramp timings** `[MEASURED]` (a linear rate `r` means `r` full-lock-units per second):

| form | time to full lock |
|---|---|
| linear rate 1.6 /s | 0.633 s |
| **linear rate 2.5 /s** | **0.400 s** ← recommended `steerRampPerSec` |
| linear rate 4.0 /s | 0.250 s ← recommended `steerReturnPerSec` |
| exponential lerp k = 0.25/tick (the three.js example's value) | 0.183 s to 95% |
| exponential lerp k = 0.12/tick | 0.400 s to 95% |

**Prefer the linear form.** An exponential lerp never actually reaches full lock, so "hold left" asymptotes just short of the steering limit — measurable in lap times and confusing to tune. A linear ramp with a faster return rate is the standard arcade-racer shape.

**Gamepad notes** `[ASSUMED — standard Gamepad API knowledge, not verified in this session]`: `navigator.getGamepads()` returns a snapshot array that must be **polled** (there is no per-frame event); entries may be `null`; browsers require a button press before a pad becomes visible; the standard mapping puts steer on `axes[0]` and the triggers on `buttons[6]`/`buttons[7]` as analog `.value`. Reading it inside `advance()` (i.e. once per fixed tick) is correct and keeps VEH-03 intact.

---

### Pattern 6: SVG needle speedometer (NAV-01, D-10 – D-13)

**What:** A fixed-position SVG built once with `document.createElementNS`, updated by writing one `transform` attribute and one `textContent` per frame.
**Why not `innerHTML`:** `tests/layering.test.ts` fails on **any** occurrence of `innerHTML` anywhere under `src/`. This is a hard, automated constraint.

```ts
// src/hud/speedometer.ts
const SVG_NS = "http://www.w3.org/2000/svg";
const MS_TO_MPH = 2.2369362920544;

export function createSpeedometer(): Speedometer {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.style.cssText =
    "position:fixed;right:18px;bottom:18px;width:180px;height:180px;" +
    "z-index:5;pointer-events:none";
  // face, tick marks, numerals, amber redline arc: build with createElementNS + appendChild
  const needle = document.createElementNS(SVG_NS, "line");
  const digits = document.createElementNS(SVG_NS, "text");
  // ...
  document.body.appendChild(svg);

  let dampedMph = 0;
  return {
    /** Called once per rAF from the render callback. dtMs comes from the loop. */
    update(groundSpeedMs: number, dtMs: number): void {
      const mph = groundSpeedMs * MS_TO_MPH;
      // D-13: needle instant, digits damped. Framerate-independent smoothing —
      // a plain `d += (mph-d)*0.2` per frame would smooth 2.4x harder at 144Hz.
      const alpha = 1 - Math.exp(-(dtMs / 1000) / DIGIT_TAU_SEC);
      dampedMph += (mph - dampedMph) * alpha;

      const t = Math.min(1, Math.max(0, mph / 160));            // D-12: 0..160 mph
      const angle = SWEEP_START_DEG + t * SWEEP_DEG;
      needle.setAttribute("transform", `rotate(${angle} 100 100)`);
      digits.textContent = String(Math.round(dampedMph));       // never innerHTML
    },
    dispose(): void { svg.remove(); },
  };
}
```

Feed it from the composition root's `render(alpha)` callback:

```ts
const v = vehicle.body.linvel();
speedo.update(Math.hypot(v.x, v.z), dtMs);   // ground speed — see Pitfall 1
```

Follow `src/debug/profiler-hud.ts`'s established conventions: inline `style.cssText`, `pointer-events:none`, `textContent` only. Unlike the profiler HUD, **do not throttle to 7 Hz** — a needle that updates 7 times a second reads as broken. Two attribute writes per frame is negligible.

---

### Anti-Patterns to Avoid

- **Copying `three/examples/physics_rapier_vehicle_controller.html` wholesale.** It is a useful math reference and this research read it verbatim, but it: uses `RapierPhysics.js` (which CLAUDE.md already bans for its CDN fetch of Rapier 0.17.3); is **front-wheel drive** (engine force on wheels 0/1, the `-Z` end); sets `frictionSlip` to `1000.0` (the dead zone); leaves suspension damping at Rapier's defaults while raising stiffness to 24, giving ζ ≈ 0.17 (bouncy); calls a `0.25` steering lerp per **render frame**; and contains an outright bug — `setWheelSteering(index, pos.z < 0)` passes a boolean where a number is expected.
- **Applying assists via `addForce`/`addTorque`.** Those persist until `resetForces`/`resetTorques`. Use `applyImpulse`/`applyTorqueImpulse`, which `world.step()` consumes.
- **Rebuilding the vehicle when a tuning slider moves.** Every wheel property has a live per-index setter; rebuilding loses the car's state mid-drive and makes the panel unusable.
- **Running the telemetry track in the live game world.** Build a throwaway world so a telemetry run does not perturb the play session (and cannot pollute a future medal time).
- **A per-render-frame steering lerp or digit smoothing.** Steering must be per fixed tick (VEH-03); display smoothing must use `1 - exp(-dt/τ)` or it varies with refresh rate.
- **Reading `renderer.info` before `renderer.render()`.** Already documented in Phase 1; the speedometer must not disturb the single-draw-per-frame invariant `profiler-hud.ts` depends on.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Suspension springs, ground detection, tire friction circle | 4 manual `world.castRay()` calls + custom spring/damper + your own slip model | `world.createVehicleController(chassis)` | Already banned by CLAUDE.md, and this session confirmed the built-in model gives load-sensitive grip, a coupled friction circle and full per-wheel telemetry — weeks of work reimplemented worse. |
| Dev tuning UI | Custom sliders / DOM inputs | `three/addons/libs/lil-gui.module.min.js` | Ships with `three`, typed by `@types/three`, and `save()`/`load()`/`reset()` are exactly D-17. |
| Tuning persistence + reset | Manual key-by-key `localStorage` read/write and a hand-written defaults diff | `JSON.stringify(gui.save(true))` / `gui.load(obj, true)` / `gui.reset(true)` | lil-gui already tracks initial values per controller; a hand-rolled version drifts the moment a control is added. |
| Deterministic replayable telemetry input | A new recording format | The existing `ReplayInput` / `InputFrame` from `src/core/input-tape.ts` | Already tested and tick-indexed; the telemetry routines are just scripted `InputSource`s. |
| Quaternion → forward/up/right vectors in `src/physics/` | Importing `three` for `Vector3.applyQuaternion` | ~10 lines of hand-written quaternion rotation | `src/physics/` may not import `three` (enforced by `tests/layering.test.ts`). `debug-scene.ts` already sets this precedent with its hand-built quaternion. |
| Fixed timestep, interpolation, stall handling | Anything | `src/core/sim-clock.ts` + `src/loop.ts` | Phase 1 built and regression-tested this. Do not introduce a second timing source. |

**Key insight:** the only thing genuinely worth writing by hand in this phase is the **assist layer** — and that is precisely because no library models "make a heavy 1968 car slide the way a movie does".

---

## Common Pitfalls

### Pitfall 1: `currentVehicleSpeed()` is unusable for the speedometer
**What goes wrong:** The needle flickers between +90 and −90 mph, and shows the wrong number during jumps.
**Why it happens:** Two independent defects. (a) `currentVehicleSpeed()` returns `|linvel|` — the **full 3D** magnitude including vertical velocity `[SOURCE: rust `update_vehicle`]`; measured: with `vy=12, vz=−20` it returned `−23.32` where the ground speed is `20.0` `[MEASURED]`. (b) Its **sign** is `linvel · forwardAxis`, where `forwardAxis` defaults to **X** (`indexForwardAxis = 0`) `[MEASURED: the getter reads 0 on a freshly built controller]`. For a car whose forward is −Z, that dot product is numerical noise: measured `currentVehicleSpeed() = −19.135` while the true forward speed was `+19.185`.
**How to avoid:** Compute it yourself — `Math.hypot(linvel.x, linvel.z) * 2.2369362920544`. If you also want `currentVehicleSpeed()` to be sane (for AI or debug), set the forward axis explicitly (see Pitfall 2).
**Warning signs:** A speedo that reads negative when driving forward; a speedo that spikes on landing.

### Pitfall 2: The forward-axis setter is misnamed in the shipped 0.20.0 bindings
**What goes wrong:** `vc.indexForwardAxis = 2` fails to compile ("read-only property") and developers conclude the axis cannot be set.
**Why it happens:** The shipped wrapper declares `get indexForwardAxis(): number` but `set setIndexForwardAxis(axis: number)` — a naming slip in `@dimforge/rapier3d@0.20.0` `[SOURCE: `control/ray_cast_vehicle_controller.d.ts` and `.js`]`.
**How to avoid:** Write `vc.setIndexForwardAxis = 2;` (an assignment to a write-only accessor). **Verified in this session:** it compiles under `tsc --noEmit` with `typescript@7.0.2`, and afterwards `vc.indexForwardAxis` reads back `2` `[MEASURED]`.
**Also note:** `index_forward_axis` affects **only** the sign of `currentVehicleSpeed()` — it does **not** determine which way the car drives. Driving direction comes entirely from the `axleCs` and `directionCs` you pass to `addWheel` `[SOURCE: the axis is referenced exactly once in the whole Rust file]`.

### Pitfall 3: Suspension stiffness is mass-normalised — the opposite of the intuition
**What goes wrong:** Someone raises the chassis mass to make the car feel heavy, then raises suspension stiffness "to compensate", and the car ends up on stilts.
**Why it happens:** Rapier computes `wheelSuspensionForce = (spring + damper) * chassisMass` `[SOURCE: rust `update_suspension`]`. Stiffness is therefore an *acceleration per metre of deflection*, not a force per metre — it is **independent of mass**.
**The derived relations** (all confirmed against the measured rest state):

| quantity | formula | check |
|---|---|---|
| static sag | `9.81 / (4 × stiffness)` m | k = 18 predicts 0.136 m; measured suspension length 0.319 vs a 0.45 rest length → sag **0.131 m** `[MEASURED]`, within 4% |
| heave frequency | `√stiffness / π` Hz | k = 14 → 1.19 Hz (a soft 70s car); k = 24 → 1.56 Hz |
| damping ratio | `damping / √stiffness` | Rapier's defaults 0.83/5.88 give ζ ≈ 0.34 — realistic. The three.js example raises k to 24 and leaves damping at 0.83 → ζ ≈ 0.17, i.e. **underdamped and bouncy.** |

**How to avoid:** Pick a target sag, derive stiffness, then derive damping as `ζ × √stiffness` with ζ ≈ 0.35. Retune damping every time you move stiffness — put both on the same lil-gui folder with a visible ζ readout.
**Warning signs:** The car pogos after a bump; ride height changes when you change mass.

### Pitfall 4: `maxSuspensionForce` defaults to 6000 N and will clip a real car
**What goes wrong:** A heavy chassis sags to the bump stops and the car "sits down" and handles like it is on its floorpan.
**Why it happens:** The default is `6000.0` N `[SOURCE: `WheelTuning::default`]`, but static per-wheel load for a 1600 kg car is `1600 × 9.81 / 4 = 3924` N and easily doubles under compression.
**How to avoid:** Set it to roughly `5 × mass × 9.81 / 4` (≈ 20 000 N at 1600 kg). Confirmed working: summed suspension force at rest equalled `0.9996 × mg` `[MEASURED]`.

### Pitfall 5: `maxSuspensionTravel` defaults to 5.0 — five metres
**What goes wrong:** The suspension length clamp is effectively absent, so on a hard landing the raycast reports a suspension length far outside any plausible range and the spring launches the car.
**Why it happens:** The default is `5.0` `[SOURCE: `WheelTuning::default`]` (inherited from Bullet's `btRaycastVehicle`, where the unit was centimetres).
**How to avoid:** Always call `setWheelMaxSuspensionTravel(i, 0.25 … 0.35)` explicitly on every wheel. Note the three.js example never sets it.

### Pitfall 6: 120 mph is 0.89 m of travel per fixed tick
**What goes wrong:** The car tunnels through a thin ramp or lands inside the ground collider.
**Why it happens:** 120 mph = 53.6 m/s; at `DT = 1/60` that is 0.894 m per step. Any collider thinner than that is a tunnelling candidate.
**How to avoid:** `RigidBodyDesc.setCcdEnabled(true)` on the chassis (or `setSoftCcdPrediction`), and keep ramp/ground colliders ≥ 1 m thick. Note this is a *chassis collider* concern — wheel **raycasts** cannot tunnel because they are rays.
**Warning signs:** The car disappears through geometry exactly once, at high speed.

### Pitfall 7: Engine force silently disables the brake on the same wheel
**What goes wrong:** Holding throttle and brake together **accelerates**. Player brake inputs are ignored whenever a stale non-zero engine force is left on a wheel.
**Why it happens:** The friction solver is `if engineForce != 0 { rollingFriction = engineForce * dt } else { …brake path… }` — the brake is only consulted in the `else` `[SOURCE: rust `update_friction`]`.
**Measured:** throttle + full brake together, from 40.1 mph → **41.1 mph after 2 s**. Brake alone: 40.1 → −0.2 mph `[MEASURED]`.
**How to avoid:** Explicitly `setWheelEngineForce(i, 0)` on every driven wheel whenever `frame.brake > 0`. Add a telemetry routine or unit test that asserts throttle+brake decelerates.

### Pitfall 8: D-04 cannot happen at high `frictionSlip`
**What goes wrong:** The plan says "braking while turning causes understeer" but the car brakes and turns simultaneously with no penalty.
**Why it happens:** The understeer is emergent from the friction circle, and the circle is never reached above `frictionSlip ≈ 10` `[MEASURED: 10.5 and 1000 produce identical cornering]`.
**How to avoid:** Keep `frictionSlip` in the 0.6–2.0 band. Verify with a dedicated telemetry check: cornering radius under braking must be measurably larger than cornering radius while coasting.

### Pitfall 9: A sleeping chassis stops responding
**What goes wrong:** The car is parked, the player presses throttle, and nothing happens for a moment.
**Why it happens:** Rapier only wakes the chassis when `engine_force > 0.0` — strictly positive `[SOURCE: rust `update_vehicle`]`. If your forward direction uses *negative* engine force (as it does when forward is −Z), the auto-wake never fires. The three.js example papers over this with a manual `chassis.wakeUp()`.
**How to avoid:** `RigidBodyDesc.setCanSleep(false)` on the chassis. This mirrors the reasoning behind Phase 1's never-sleeping kinematic spinner, and it costs one always-active body.

### Pitfall 10: Mass/CoM are not per-frame-safe the way wheel properties are
**What goes wrong:** Dragging the mass slider produces discontinuities or a launched car.
**Why it happens:** `setAdditionalMassProperties` overrides *all* previous additional mass properties and takes a `wakeUp` flag; it also invalidates the principal inertia the assists are scaled against.
**How to avoid:** Treat mass/CoM/inertia as a `onFinishChange` (drag-release) binding in lil-gui rather than `onChange`, recompute and cache the principal inertia at that moment, and zero the chassis velocity if the change is large. Keep every wheel property on `onChange` (live), since those genuinely are per-frame safe.

### Pitfall 11: A per-render-frame lerp breaks VEH-03
**What goes wrong:** Lap times differ between a 60 Hz and a 144 Hz machine even though the physics is fixed-step.
**Why it happens:** The three.js example's `MathUtils.lerp(current, target, 0.25)` runs in the rAF callback, so a 144 Hz player's steering reaches lock 2.4× faster.
**How to avoid:** All input smoothing lives inside `sampleForTick`. `tests/layering.test.ts` already helps here — `performance.now()` is banned outside `src/loop.ts` and `src/debug/`, so a wall-clock ramp in `src/input/` is not expressible.

### Pitfall 12: `innerHTML` is banned repo-wide by an existing test
**What goes wrong:** The speedometer or tuning panel is written with a template string and `tests/layering.test.ts` goes red.
**Why it happens:** `describe("layering — no innerHTML anywhere under src/ (T-01-28)")` scans every non-comment line of `src/**/*.ts`.
**How to avoid:** Build SVG/DOM with `createElement` / `createElementNS` + `appendChild`, set text with `textContent`. Note STATE.md already records that `src/main.ts:21` contains the literal substring inside a comment — comment lines are exempt from the scan.

### Pitfall 13: Telemetry worlds leak WASM memory if not freed
**What goes wrong:** Running the telemetry suite repeatedly in a long browser session grows memory until the 4 GB WASM ceiling.
**Why it happens:** Each `new RAPIER.World()` allocates in linear memory; JS GC does not reclaim it.
**How to avoid:** `world.free()` after each routine — it frees the world's bodies and colliders too `[SOURCE: `world.d.ts`: "…so there is no need to call their `.free()` methods individually"]`. A ~30-routine tuning session is otherwise 30 live worlds.

### Pitfall 14: The `sideFrictionStiffness` slider is unusable on a linear 0–1 range
**What goes wrong:** The tuning panel's most important dial appears to do nothing, because the entire useful range (0.004–0.04) occupies 4% of the track.
**How to avoid:** Bind the handbrake value on a `0 … 0.05` range with a `0.001` step, or expose `log10(value)`. Same treatment for the permanent rear bias (`0 … 0.3`, step `0.005`).

---

## Code Examples

### Building the vehicle (verified against `@dimforge/rapier3d@0.20.0`)

```ts
// src/physics/vehicle.ts — this exact construction was executed in this session
import * as RAPIER from "@dimforge/rapier3d";
import { DT } from "../core/sim-clock";

export const FL = 0, FR = 1, RL = 2, RR = 3;   // front pair at -Z, rear pair at +Z

export function createVehicle(world: RAPIER.World, t: VehicleTuning, spawn: Vec3) {
  const c = t.chassis;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setCanSleep(false)                       // Pitfall 9
      .setCcdEnabled(true)                      // Pitfall 6
      .setLinearDamping(c.linearDamping)
      .setAngularDamping(c.angularDamping),
  );

  // Box principal inertia for the chassis extents. Cache this — the assists scale
  // their gains against it so they stay meaningful when mass/geometry change.
  const I = {
    x: (c.mass / 12) * (4 * c.halfExtents.y ** 2 + 4 * c.halfExtents.z ** 2),
    y: (c.mass / 12) * (4 * c.halfExtents.x ** 2 + 4 * c.halfExtents.z ** 2),
    z: (c.mass / 12) * (4 * c.halfExtents.x ** 2 + 4 * c.halfExtents.y ** 2),
  };
  body.setAdditionalMassProperties(c.mass, c.comOffset, I, { x: 0, y: 0, z: 0, w: 1 }, true);

  world.createCollider(
    RAPIER.ColliderDesc
      .cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z)
      .setFriction(0.8),
    body,
  );

  const vc = world.createVehicleController(body);
  vc.setIndexForwardAxis = 2;                   // Pitfall 2 — note the setter's name

  const w = t.wheels;
  const DIRECTION = { x: 0, y: -1, z: 0 };      // suspension raycast direction
  const AXLE = { x: -1, y: 0, z: 0 };           // flips the steering sign if changed
  const conn = [
    { x: -w.halfTrack, y: w.connectionY, z: -w.halfWheelbase },   // FL
    { x:  w.halfTrack, y: w.connectionY, z: -w.halfWheelbase },   // FR
    { x: -w.halfTrack, y: w.connectionY, z:  w.halfWheelbase },   // RL
    { x:  w.halfTrack, y: w.connectionY, z:  w.halfWheelbase },   // RR
  ];
  for (let i = 0; i < 4; i++) {
    vc.addWheel(conn[i], DIRECTION, AXLE, w.suspensionRestLength, w.radius);
    // EVERY one of these must be set explicitly. Rapier's defaults are wrong for a
    // car (Pitfalls 4 and 5) and the three.js example sets only two of them.
    vc.setWheelSuspensionStiffness(i, w.suspensionStiffness);
    vc.setWheelSuspensionCompression(i, w.suspensionCompression);
    vc.setWheelSuspensionRelaxation(i, w.suspensionRelaxation);
    vc.setWheelMaxSuspensionTravel(i, w.maxSuspensionTravel);
    vc.setWheelMaxSuspensionForce(i, w.maxSuspensionForce);
    vc.setWheelFrictionSlip(i, w.frictionSlip);
    vc.setWheelSideFrictionStiffness(i, i < 2 ? w.frontSideFriction : w.rearSideFriction);
  }
  return { body, controller: vc, inertia: I, /* tick, applyTuning, dispose */ };
}
```

`[MEASURED]` At rest on flat ground this configuration reports `wheelGroundObject(0)` = the **ground** collider, not the chassis; `wheelIsInContact` true on all four; and the summed suspension force equals `0.9996 × mg`. The wheel raycast does not self-hit the chassis even though the connection points sit inside the chassis cuboid — so no collision-group or filter-predicate workaround is needed for a single vehicle. (Re-verify in Phase 7/8 when several vehicles coexist; `updateVehicle` accepts `filterFlags` / `filterGroups` / `filterPredicate` if it becomes necessary.)

### Steering sign, derived and measured

```ts
// InputFrame.steer is -1 = full LEFT, +1 = full RIGHT (src/core/input-tape.ts).
// With forward = local -Z, up = +Y and axleCs = {-1,0,0}, a POSITIVE
// setWheelSteering angle produces a POSITIVE yaw rate about +Y, which turns LEFT.
// Measured: setWheelSteering(0..1, +0.2618) -> angvel.y = +0.25 rad/s.
const steerAngle = -frame.steer * tuning.drive.maxSteerLock;
vc.setWheelSteering(FL, steerAngle);
vc.setWheelSteering(FR, steerAngle);
```
Changing `AXLE` to `{1,0,0}` inverts this. Assert the sign in a unit test rather than discovering it in the browser.

### Wheel visual rig (render side — copied from the official example, which is correct here)

```ts
// src/render/vehicle-view.ts — this half of the three.js example IS worth copying
const wheelSteerQ = new THREE.Quaternion();
const wheelRollQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const axle = new THREE.Vector3();

for (let i = 0; i < 4; i++) {
  const a = vc.wheelAxleCs(i);                          // Vector | null
  const connY = vc.wheelChassisConnectionPointCs(i)?.y ?? 0;
  const susp = vc.wheelSuspensionLength(i) ?? 0;
  const steer = vc.wheelSteering(i) ?? 0;
  const roll = vc.wheelRotation(i) ?? 0;

  wheelMeshes[i].position.y = connY - susp;             // suspension travel
  wheelSteerQ.setFromAxisAngle(UP, steer);
  wheelRollQ.setFromAxisAngle(axle.set(a!.x, a!.y, a!.z), roll);
  wheelMeshes[i].quaternion.multiplyQuaternions(wheelSteerQ, wheelRollQ);
}
```
Wheel meshes are children of the chassis mesh, so the chassis interpolation from `src/render/interpolator.ts` carries them; only the local suspension/steer/roll needs updating. Note every getter returns `T | null` — Rapier returns `null` for an out-of-range index.

### lil-gui panel with localStorage persistence (D-15/16/17)

```ts
// src/debug/tuning-panel.ts
import GUI from "three/addons/libs/lil-gui.module.min.js";   // typechecks — verified
import { DEBUG_ENABLED, onDebugToggle } from "./debug-gate";

const STORAGE_KEY = "heat-street.tuning.v1";

export function createTuningPanel(tuning: VehicleTuning, onApply: () => void) {
  if (!DEBUG_ENABLED) return null;                 // zero surface in a normal build
  const gui = new GUI({ title: "Vehicle Tuning" });

  const chassis = gui.addFolder("Chassis");
  // Pitfall 10 — mass/CoM on onFinishChange, not onChange.
  chassis.add(tuning.chassis, "mass", 800, 2600, 10).onFinishChange(onApply);

  const susp = gui.addFolder("Suspension");
  susp.add(tuning.wheels, "suspensionStiffness", 6, 40, 0.5);
  susp.add(tuning.wheels, "suspensionCompression", 0.2, 4, 0.05);
  susp.add(tuning.wheels, "suspensionRelaxation", 0.2, 4, 0.05);

  const grip = gui.addFolder("Grip");
  grip.add(tuning.wheels, "frictionSlip", 0.4, 3, 0.05);          // dead above ~10
  grip.add(tuning.wheels, "rearSideFriction", 0, 0.3, 0.005);     // Pitfall 14
  grip.add(tuning.drive, "handbrakeRearSideFriction", 0, 0.05, 0.001);

  const assists = gui.addFolder("Assists");
  assists.add(tuning.assists, "autoLevelGain", 0, 2, 0.05);
  assists.add(tuning.assists, "bodyRollGain", 0, 0.15, 0.005);    // >0.15 flips the car
  assists.add(tuning.assists, "bodyRollMaxDeg", 0, 25, 1);
  assists.add(tuning.assists, "slideCatchGain", 0, 0.6, 0.02);
  assists.add(tuning.assists, "downforcePerSpeed2", 0, 40, 0.5);

  // D-17: persist on any change, anywhere in the tree.
  gui.onChange(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gui.save(true)));
  });
  gui.add({ reset: () => {
    gui.reset(true);                                // lil-gui restores initial values
    localStorage.removeItem(STORAGE_KEY);
    onApply();
  } }, "reset").name("Reset to defaults");

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    try { gui.load(JSON.parse(saved) as object, true); onApply(); }
    catch { localStorage.removeItem(STORAGE_KEY); }  // corrupt blob must not brick dev
  }

  gui.hide();
  onDebugToggle(() => (gui.domElement.style.display === "none" ? gui.show() : gui.hide()));
  return gui;
}
```

`gui.save(true)` / `gui.load(obj, true)` / `gui.reset(true)` / `gui.onChange(cb)` all exist and typecheck in the three-bundled 0.17.0 build `[VERIFIED: `@types/three` `.d.ts` + a `tsc --noEmit` run in this session]`. Note `onDebugToggle` collides with the profiler HUD's own toggle on the same `Backquote` key — either share one toggle for all debug overlays or give the panel its own key (Phase 1 D-05 permits a dedicated key).

---

## Tuning Reference

### Config A — the measured telemetry baseline

This exact set produced **0-60 mph in 6.28 s** and **60-0 mph in 120 ft (36.6 m / 2.77 s)** `[MEASURED]`, hitting both of D-14's targets. Use it as the committed `DEFAULT_TUNING` starting point.

| Group | Parameter | Value | Note |
|---|---|---|---|
| Chassis | `mass` | 1600 kg | period muscle car |
| | `comOffset` | `{0, −0.25, 0}` | relative to chassis origin |
| | `halfExtents` | `{0.95, 0.5, 2.35}` | 1.9 × 1.0 × 4.7 m |
| | `linearDamping` / `angularDamping` | 0.05 / 0.3 | coast 40→33 mph in 4 s `[MEASURED]` |
| | principal inertia | box formula → `{3080, 3480, 512}` kg·m² | cache it; assists scale against it |
| Wheels | `halfTrack` / `halfWheelbase` | 0.85 / 1.55 m | track 1.70, wheelbase 3.10 |
| | `connectionY` | −0.30 | |
| | `radius` | 0.36 m | |
| | `suspensionRestLength` | 0.45 m | |
| | `maxSuspensionTravel` | 0.30 m | **must be set** — Pitfall 5 |
| | `suspensionStiffness` | 18 | sag 0.136 m, 1.35 Hz |
| | `suspensionCompression` / `Relaxation` | 1.5 / 1.6 | ζ ≈ 0.35 / 0.38 |
| | `maxSuspensionForce` | 20 000 N | ≈5× static load — Pitfall 4 |
| | `frictionSlip` | 1.2 | ≈1.0 g skidpad |
| | side friction front / rear | 1.0 / 1.0 | Config A is the *neutral* reference |
| Drive | `engineForcePerRearWheel` | 4000 N | → 6.28 s 0-60 |
| | `brakeImpulsePerWheel` | 60 N·s | → 120 ft 60-0 |
| | `maxSteerLock` | π/4 (45°) | |

### Config B — the feel deltas to start the tuning session from

Each delta below was measured independently; **the telemetry suite must be re-run after applying them**, because they will shift 0-60 and braking distance.

| Change | From → To | Measured effect |
|---|---|---|
| `suspensionStiffness` | 18 → **14** | sag 0.136 → 0.175 m, 1.19 Hz; braking dive 2.9° → ~4° (6.7° at k=10) |
| `suspensionCompression` / `Relaxation` | 1.5/1.6 → **1.3/1.4** | holds ζ ≈ 0.35 at the lower stiffness |
| `comOffset.y` | −0.25 → **−0.15** | roll 1.05° → ~1.4°; still far from rollover |
| `linearDamping` | 0.05 → **0.03** | less artificial coast-down, more momentum (D-05/D-06) |
| rear `sideFrictionStiffness` | 1.0 → **0.12** | max slip 0.9° → 2.2°; baseline RWD-loose |
| `handbrakeRearSideFriction` | — → **0.01** | 34–66° recoverable slide |
| `bodyRollGain` | 0 → **0.10** | roll 1.55° → **5.46°** — Bullitt range. Cap at 0.15. |
| `autoLevelGain` / damping | 0 → **0.4 / 0.6** | lands at 21° instead of inverted |
| `slideCatchGain` / damping | 0 → **0.10 / 0.35** | small at this tuning; matters at deep handbrake settings |
| `downforcePerSpeed2` | **0** | leave at zero — no rollover risk exists `[MEASURED]` |
| `powerOversteerGain` | **0.5** (starting guess, `[ASSUMED]`) | required for SC1's throttle-oversteer; not swept in this session |

### Unit reference

| Rapier parameter | Unit | Sanity anchor |
|---|---|---|
| `engineForce` | newtons | `F ≈ mass × (26.82 / target 0-60 seconds)` split over driven wheels |
| `brake` | newton-**seconds** (an impulse cap) | 1 g stop needs `mass × 9.81 × DT / 4` ≈ 65 N·s per wheel at 1600 kg |
| `frictionSlip` | dimensionless load multiplier | ≈ tire μ. Lateral cap = `load × slip`; longitudinal cap = `2 × load × slip` |
| `sideFrictionStiffness` | dimensionless 0–1 scale on the lateral impulse | 1.0 = full lateral-velocity cancellation per step |
| `suspensionStiffness` | s⁻² (mass-normalised) | `sag = 9.81 / (4k)` |
| `suspensionCompression`/`Relaxation` | s⁻¹ (mass-normalised) | `ζ = c / √k` |
| `maxSuspensionForce` | newtons (absolute, NOT normalised) | ≥ 4× static per-wheel load |
| speed | m/s | mph = m/s × 2.2369362920544; 60 mph = 26.8224 m/s; 120 mph = 53.6448 m/s |
| distance | metres | ft = m × 3.28084; 120 ft = 36.576 m |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `frictionSlip: 1000` as the "grip dial" (three.js example, most Rapier vehicle tutorials) | `frictionSlip` in 0.6–2.0; `sideFrictionStiffness` as the slip-angle dial | The example value dates to Bullet's `btRaycastVehicle` demos and has been copied forward ~15 years | Explains the entire "on-rails vs uncontrollable" community complaint. Verified in this session. |
| `three/addons/physics/RapierPhysics.js` as the integration layer | Direct `@dimforge/rapier3d` import + a project-owned wrapper | CLAUDE.md already mandates this; still true at three r185 | Avoids a runtime CDN fetch of Rapier 0.17.3 and a hardcoded internal 60 Hz. |
| `dat.GUI` | `lil-gui` (bundled in three since ~r140) | — | `dat.GUI` is unmaintained; three's examples all migrated. |
| Separate `lil-gui` npm dependency | `three/addons/libs/lil-gui.module.min.js` + `@types/three` | — | Zero net dependency for the tuning panel. |

**Deprecated / outdated for this phase:**
- Rapier's `WheelTuning` defaults (`suspension_stiffness 5.88`, `max_suspension_travel 5.0`, `max_suspension_force 6000`, `friction_slip 10.5`) are Bullet-era demo values. **Every one of them is wrong for a car of this mass** — set all seven explicitly.
- `three/examples/jsm/...` import paths — use `three/addons/...` (already the project convention).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Gamepad standard mapping puts steering on `axes[0]` and analog triggers on `buttons[6]`/`buttons[7]`; pads require a button press before appearing in `getGamepads()` | Pattern 5 | Gamepad support is miswired; caught immediately by the human playtest (SC2). Low risk, trivially fixed. |
| A2 | `powerOversteerGain = 0.5` is a sensible starting value for the authored throttle-oversteer term | Config B | Not swept in this session. Throttle-oversteer may be too eager or too weak on first run; the tuning session resolves it. |
| A3 | Real 60s–70s muscle cars corner at ~0.7–0.85 lateral g and roll 4–6° at the limit — the target the assist gains are aimed at | The Spike, Config B | If the target roll is wrong, the "Bullitt feel" gain is mis-set. This is a *feel* target that SC5's human playtest is the real arbiter of — the numbers just seed it. |
| A4 | `~120 ft` 60-0 and `6–7 s` 0-60 (from D-14) are the right period-correct figures | Telemetry targets | These come from CONTEXT.md as a locked decision, not from research; Config A was tuned to hit them. |
| A5 | SVG needle rendering is cheaper than canvas 2D for this gauge | Pattern 6 | Both are far inside the frame budget; the choice is ergonomic, not performance-driven. |
| A6 | `setCcdEnabled(true)` is sufficient for a 120 mph chassis and `setSoftCcdPrediction` is not needed | Pitfall 6 | Not tested in this session (my ramp geometry probe failed — see Open Question 2). If tunnelling occurs, soft CCD is the fallback. |
| A7 | The wheel raycast will continue to exclude only the *own* chassis when several vehicles coexist | Code Examples | Verified for one vehicle. Phase 7/8 must re-verify; `updateVehicle` accepts a `filterPredicate` if not. |

---

## Open Questions

1. **Does 34–66° of slip angle read as a "big readable slide" on screen?**
   - What we know: the physics produces it, it is recoverable under counter-steer, and it scrubs speed realistically `[MEASURED]`.
   - What's unclear: nothing headless can answer whether it *looks* like Bullitt, and the helicopter camera that will frame it does not exist until Phase 3.
   - Recommendation: budget the SC5 human-playtest checkpoint generously; expect the tuning session (not the implementation) to be the long pole. Consider a temporary fixed chase camera for this phase so the playtest is not judged through a placeholder view.

2. **Ramp geometry for the 120 mph jump (SC3 / VEH-04).**
   - What we know: the auto-level assist makes landings survivable regardless of launch attitude `[MEASURED]`, and 0.89 m/tick demands CCD and thick colliders.
   - What's unclear: my probe built the ramp as a rotated cuboid and the car hit its vertical leading edge instead of driving up it — **the ramp geometry itself is unsolved.** Candidates: a `ColliderDesc.convexHull` wedge; a rotated cuboid sunk far enough into the ground that its leading edge is below the surface; or `ColliderDesc.trimesh(verts, indices, TriMeshFlags.FIX_INTERNAL_EDGES)` (value 144, already documented in CLAUDE.md).
   - Recommendation: make this its own small task with a verification step, and give the `ramp` telemetry routine a **scripted-launch fallback** (set `linvel`/`angvel` directly, as PROBE M did) so VEH-04's assist can be regression-tested independently of ramp authoring.

3. **Does the roll assist stay stable at other speeds and steering angles?**
   - What we know: gain 0.10 is stable and gain 0.20 flips the car, at 45 mph / 0.26 rad `[MEASURED]`.
   - What's unclear: the margin at 110 mph, at full lock, mid-drift, and on landing.
   - Recommendation: the `stability` telemetry routine (max tilt < 15° across every routine) is the mitigation. Make it a hard CI gate, not an advisory.

4. **Should the profiler HUD and the tuning panel share the `Backquote` toggle?**
   - What we know: `onDebugToggle` registers an unconditional listener on `Backquote`; registering twice toggles both overlays together.
   - Recommendation: decide explicitly in the plan — either one "debug overlays" toggle, or extend `debug-gate.ts` with a keyed variant. Do not leave it to the implementer.

5. **Is `src/hud/` worth a new directory, or should the speedometer live in `src/render/`?**
   - Trade-off: a new directory needs a new rule in `tests/layering.test.ts` (small, one-time); `src/render/` needs no test change but blurs "render = 3D scene". Recommendation: create `src/hud/` and add the rule — Phases 5, 6 and 8 add a minimap, timer, splits and a pursuit HUD, and they should not all land in `src/render/`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@dimforge/rapier3d` | vehicle controller | ✓ | 0.20.0 (pinned) | — |
| `three` | meshes + bundled lil-gui | ✓ | 0.185.1 (pinned) | — |
| `@types/three` | lil-gui typings, `three/addons/*` mapping | ✓ | 0.185.4 (pinned) | — |
| `vitest` + `vitest.config.ts` Rapier resolver | headless telemetry | ✓ | 5.0.0; Rapier imports and steps under Node — re-confirmed in this session | — |
| `typescript` | `tsc --noEmit` | ✓ | 7.0.2; the lil-gui import and `setIndexForwardAxis` assignment both compile clean | — |
| `lil-gui` (npm) | tuning panel | ✗ (not installed) | — | **Bundled copy in `three` — no install needed** |
| Gamepad hardware | SC2 gamepad half | unknown | — | Keyboard half is independently verifiable; gate the gamepad half on a human checkpoint |
| `slopcheck` | package audit | ✓ (via `python -m slopcheck`) | the bare `slopcheck` shim is not on PATH in Git Bash | use `python -m slopcheck` |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `lil-gui` (npm) — superseded by the three-bundled copy.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@5.0.0` |
| Config file | `vitest.config.ts` (Rapier resolver settings already correct — do not change) |
| Quick run command | `npx vitest run tests/vehicle-telemetry.test.ts` |
| Full suite command | `npm run check` (`tsc --noEmit && biome check . && vitest run`) |

> Note: `--reporter=basic` does not exist in Vitest 5 and errors at startup; use the default reporter, or `--reporter=verbose --silent=false` when you need `console.log` output from a test.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VEH-01 | 0-60 mph in 6.0–7.0 s at default tuning | integration (headless physics) | `npx vitest run tests/vehicle-telemetry.test.ts -t accel` | ❌ Wave 0 |
| VEH-01 | 60-0 mph in 110–135 ft | integration | `… -t brake` | ❌ Wave 0 |
| VEH-01 | Skidpad 0.75–1.05 lateral g | integration | `… -t skidpad` | ❌ Wave 0 |
| VEH-01 | Handbrake produces >25° slip and recovers below 5° within 2.5 s | integration | `… -t handbrake` | ❌ Wave 0 |
| VEH-01 (D-04) | Cornering radius under braking > cornering radius while coasting | integration | `… -t brake-understeer` | ❌ Wave 0 |
| VEH-01 (Pitfall 7) | Throttle + brake together decelerates | unit | `npx vitest run tests/vehicle.test.ts -t "brake wins"` | ❌ Wave 0 |
| VEH-02 | Keyboard ramp reaches full lock in 0.40 s ± 1 tick, independent of call pattern | unit (pure) | `npx vitest run tests/live-input.test.ts` | ❌ Wave 0 |
| VEH-02 | `sampleForTick(n)` twice returns an identical frame (idempotence) | unit (pure) | `npx vitest run tests/live-input.test.ts -t idempotent` | ❌ Wave 0 |
| VEH-02 | Gamepad analog axes bypass the ramp; deadzone applied | unit (pure, injected pad snapshot) | `npx vitest run tests/live-input.test.ts -t gamepad` | ❌ Wave 0 |
| VEH-02 | Steering sign: `steer = +1` yields a negative yaw rate (right turn) | integration | `npx vitest run tests/vehicle.test.ts -t "steer sign"` | ❌ Wave 0 |
| VEH-04 | 120 mph launch lands with tilt < 20° and forward speed > 40 mph | integration | `… -t ramp` | ❌ Wave 0 |
| VEH-04 | Auto-level assist disabled ⇒ the test above fails (proves the assist is load-bearing, not decorative) | integration | `… -t "ramp without assist"` | ❌ Wave 0 |
| VEH-03 (regression) | Two identical scripted telemetry runs produce identical `takeSnapshot()` hashes | integration | `… -t reproducible` | ❌ Wave 0 |
| SC3 / D-08 | Full lock at 60 mph for 5 s: max tilt < 15° | integration | `… -t stability` | ❌ Wave 0 |
| D-06 | Body-roll assist at the default gain never exceeds 15° tilt in **any** routine | integration | `… -t "roll assist stability"` | ❌ Wave 0 |
| NAV-01 | mph conversion and needle-angle mapping are pure and correct at 0 / 60 / 160 / 200 mph (clamped) | unit (pure formatter, mirrors `formatHudText`) | `npx vitest run tests/speedometer.test.ts` | ❌ Wave 0 |
| NAV-01 | Digit damping is framerate-independent (same settle time at 16.7 ms and 6.9 ms steps) | unit (pure) | `… -t damping` | ❌ Wave 0 |
| D-17 | `gui.save()` round-trips through `JSON` and `gui.load()`; a corrupt blob is discarded not thrown | unit | `npx vitest run tests/tuning-persist.test.ts` | ❌ Wave 0 |
| Layering | `src/input/` and `src/hud/` obey their rules; no `innerHTML`; no `performance.now()` outside `loop.ts`/`src/debug/` | unit (source scan) | `npx vitest run tests/layering.test.ts` | ✅ exists — **MODIFY** |
| SC1 / SC2 / SC5 | Slide reads as a big recoverable drift; steering feels smooth on both devices; car "reads as a heavy muscle car" | **manual-only** | human playtest checkpoint | n/a — no automation possible |

**Manual-only justification:** SC1's "readable", SC2's "smooth" and SC5's "reads as a heavy muscle car" are perceptual judgements. Everything measurable underneath them (slip angle magnitude, recovery time, ramp rate, telemetry figures) is automated above; the checkpoint judges only the perceptual layer.

### Sampling Rate

- **Per task commit:** `npx vitest run tests/vehicle-telemetry.test.ts tests/live-input.test.ts` (measured: a comparable suite runs in ~1 s)
- **Per wave merge:** `npm run check`
- **Phase gate:** full suite green, then the browser telemetry run against live-tuned values, then `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/vehicle-telemetry.test.ts` — covers VEH-01, VEH-04, SC3, D-04, D-06 stability
- [ ] `tests/vehicle.test.ts` — covers the steering sign and the throttle-vs-brake exclusion
- [ ] `tests/live-input.test.ts` — covers VEH-02
- [ ] `tests/speedometer.test.ts` — covers NAV-01's pure half
- [ ] `tests/tuning-persist.test.ts` — covers D-17
- [ ] `tests/layering.test.ts` — **modify**: add `src/input/` and `src/hud/` rules
- [ ] `src/physics/telemetry/routines.ts` + `run.ts` — the shared harness both runners need; **this is the true wave-0 blocker**, because six of the tests above import it
- [ ] Framework install: none — Vitest and the Rapier resolver config already work

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-player, no accounts. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | **yes (narrow)** | D-15: the tuning panel must be unreachable without `?debug`. Reuse `DEBUG_ENABLED` — `createTuningPanel` returns `null` and registers zero listeners when it is false, matching `createHud`'s existing shape. A shipped build must expose no tuning surface, both for the medal-integrity reason in REQUIREMENTS.md and because it is attacker-controllable state otherwise. |
| V5 Input Validation | **yes** | Two untrusted inputs: (a) the `?debug` query parameter — **presence-check only** via `URLSearchParams.has`, never read the value (the rule `debug-gate.ts` already documents); (b) the localStorage tuning blob (D-17), which is user-editable via devtools. |
| V6 Cryptography | no | No secrets, no integrity requirement. FNV-1a in the telemetry reproducibility test is a **non-cryptographic fingerprint** — carry forward Phase 1's convention of saying so in a comment. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DOM XSS via HUD text | Tampering | `textContent` only; `innerHTML` is already banned repo-wide and enforced by `tests/layering.test.ts`. Build SVG with `createElementNS`. |
| Malformed / hostile `localStorage` tuning blob → `JSON.parse` throw at boot, or `NaN`/`Infinity` propagated into `world.step()` (which corrupts every body in the world, not just the car) | Tampering / DoS | Wrap `JSON.parse` in try/catch and `removeItem` on failure; then **range-clamp every numeric field** against the same min/max the lil-gui controls use before applying. `gui.load()` alone does not validate. This is the highest-value security control in the phase — a `NaN` mass is a hard physics failure, not a cosmetic one. |
| Debug surface shipped to production | Information disclosure / Tampering | `DEBUG_ENABLED` gate; a test asserting no `src/debug/` module is imported unconditionally from `src/main.ts`. |
| Query-parameter value reflected into the DOM | Tampering | Presence check only — already the established convention. |

---

## Project Constraints (from CLAUDE.md)

Directives extracted from `./CLAUDE.md` that this phase's plans must comply with:

1. **Use `@dimforge/rapier3d` (non-compat) directly**; never `three/addons/physics/RapierPhysics.js`. — the official vehicle example uses it, so the example may be read as a math reference only.
2. **`world.createVehicleController(chassis)`** — never a hand-built 4-raycast vehicle.
3. **Fixed-timestep physics, no variable `dt`.** Non-negotiable; VEH-03 is already complete and must not regress.
4. **Exact version pins, no `^`/`~`** — a Rapier or three patch bump can alter solver behaviour and invalidate medal times. This phase adds no dependencies, so the constraint is satisfied trivially.
5. **`lil-gui` for the live tuning panel; "essential, not optional"; gate behind `?debug`.** — satisfied via the three-bundled copy.
6. **HUD is absolutely-positioned HTML/CSS over the canvas with `pointer-events: none`** — never in-canvas text.
7. **Plain TypeScript classes, not an ECS.**
8. **`three/addons/...` import paths**, never `three/examples/jsm/...`.
9. **`WebGLRenderer`, not `WebGPURenderer`.**
10. **`ColliderDesc.trimesh` must use `TriMeshFlags.FIX_INTERNAL_EDGES` (144)** — relevant if the ramp is authored as a trimesh (Open Question 2).
11. **`optimizeDeps.exclude: ["@dimforge/rapier3d"]` in `vite.config.ts` is required and must not be removed** (STATE.md, Phase 01-01).
12. **The run clock is `SimClock.simTimeSec` and nothing else**; `src/core/` contains no wall-clock read.

CLAUDE.md's example tuning table (mass 10, stiffness 24, `frictionSlip` 1000, engine force ±30, wheel offsets ±1.0/±1.5) comes from the three.js demo and CLAUDE.md itself labels those values MEDIUM confidence and "demo values, not muscle-car values". **This research supersedes them with measured values** (Config A/B above). CLAUDE.md lines 28-219 are generated from `.planning/research/STACK.md` (STATE.md, 01-03) — if these numbers are ever propagated back, amend `STACK.md`, not `CLAUDE.md`, or a regeneration silently reverts the edit.

---

## Sources

### Primary (HIGH confidence — executed or read in this session)

- **`@dimforge/rapier3d@0.20.0`, as installed in this repo.** Built the full vehicle and stepped it headlessly under Vitest across ~20 configurations. All `[MEASURED]` claims come from these runs. Probe files were temporary and have been removed.
- `node_modules/@dimforge/rapier3d/control/ray_cast_vehicle_controller.d.ts` and `.js` — the complete shipped API surface; source of the `setIndexForwardAxis` naming defect.
- `node_modules/@dimforge/rapier3d/dynamics/rigid_body.d.ts` — `applyTorqueImpulse` / `applyImpulse` / `addForce` semantics, `setAdditionalMassProperties`, `setCanSleep`, `setCcdEnabled`.
- `node_modules/@dimforge/rapier3d/pipeline/world.d.ts` — `createVehicleController`, `free()` semantics.
- `node_modules/@dimforge/rapier3d/pipeline/query_pipeline.d.ts` — `QueryFilterFlags`.
- **https://raw.githubusercontent.com/dimforge/rapier/master/src/control/ray_cast_vehicle_controller.rs** — the full tire/suspension/friction model. Source for the friction-circle formula, `fwd_factor 0.5`, the `WheelTuning` defaults, `roll_influence = 0.1` (hardcoded, `TODO: make this public?`), the engine-force-vs-brake exclusion, the `engine_force > 0.0` wake condition, and the `chassis_mass` multiplication in `update_suspension`. Cross-checked against tags v0.22.0, v0.23.0, v0.26.0, v0.27.0 — `index_forward_axis` has defaulted to `0` throughout.
- **https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/physics_rapier_vehicle_controller.html** — downloaded and read verbatim (381 lines). Source for the wheel visual rig (which is correct and worth copying) and for the `frictionSlip 1000` / per-frame-lerp / FWD / boolean-steering issues catalogued above.
- `node_modules/three/examples/jsm/libs/lil-gui.module.min.js` — confirms three@0.185.1 bundles lil-gui 0.17.0.
- `node_modules/@types/three/examples/jsm/libs/lil-gui.module.min.d.ts` and `node_modules/@types/three/package.json` — confirms typings and the `./addons/*` exports mapping. Verified end-to-end with a throwaway `tsc --noEmit` run.
- `npm view lil-gui version time.modified scripts repository.url`; `https://api.npmjs.org/downloads/point/last-week/lil-gui`; `https://registry.npmjs.org/lil-gui` — package legitimacy data.
- `python -m slopcheck install lil-gui` — `[OK]`.
- Repo files read directly: `src/core/sim-clock.ts`, `src/core/input-tape.ts`, `src/loop.ts`, `src/main.ts`, `src/physics/world.ts`, `src/physics/debug-scene.ts`, `src/physics/transform-cache.ts`, `src/debug/debug-gate.ts`, `src/debug/profiler-hud.ts`, `tests/layering.test.ts`, `tests/rapier-smoke.test.ts`, `tests/determinism.test.ts`, `vite.config.ts`, `vitest.config.ts`, `package.json`.

### Secondary (MEDIUM confidence)

- `CLAUDE.md` — project stack canon; its Rapier API table is confirmed accurate by the shipped `.d.ts`, but its example tuning constants are three.js demo values and are superseded here.
- `.planning/phases/01-engine-foundation/01-PATTERNS.md` and `01-CONTEXT.md` — layering, seeding and debug-gate conventions this phase must inherit.
- `.planning/STATE.md` — Phase 1 decisions carried forward (Rapier `f32` timestep rounding, `optimizeDeps.exclude`, snapshot-byte determinism, the `?debug` + `Backquote` convention).

### Tertiary (LOW confidence — flagged, not relied on)

- Gamepad API standard-mapping details (Assumption A1) — training knowledge, not verified in this session.
- Real-world muscle-car lateral-g and body-roll figures (Assumption A3) — training knowledge used only to seed a feel target that a human playtest arbitrates.

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Rapier vehicle API surface | **HIGH** | Read from the shipped `.d.ts`/`.js` in this repo and exercised at runtime. |
| Tire/suspension/friction model semantics | **HIGH** | Read from upstream Rust source and independently confirmed by measurement (the predicted static sag matched the measured suspension length to within 4%). |
| Tuning values (Config A) | **HIGH** | Both D-14 targets hit by direct measurement (6.28 s, 120 ft). |
| Grip-dial behaviour and the saturation cliff | **HIGH** | 24-point sweep; the 10.5-vs-1000 equivalence is unambiguous. |
| Handbrake mechanism and slide magnitudes | **HIGH** | 10-point sweep with counter-steer, including recovery times. |
| Auto-level assist necessity and gains | **HIGH** | Without it, inverted landings every time; with it, driveable. |
| Body-roll assist gains and its instability cliff | **MEDIUM-HIGH** | Measured at one speed and one steering angle. The cliff is real and reproducible; the safe margin at other operating points is not yet characterised (Open Question 3). |
| Slide-catch yaw assist value | **MEDIUM** | Measured as near-inert at the shallow handbrake setting; not re-measured at the recommended deeper setting where it should matter more. |
| lil-gui / persistence approach | **HIGH** | Import, typings and full API surface verified by a real `tsc --noEmit` run. |
| Input ramping design | **MEDIUM-HIGH** | The maths and the framerate-independence argument are solid and the timings are computed; the *feel* of 2.5/4.0 per second is a starting guess. |
| Speedometer approach | **MEDIUM** | Constraint-driven (the `innerHTML` ban is verified); the SVG-vs-canvas choice is ergonomic judgement. |
| Ramp geometry | **LOW** | My probe's ramp did not work. Explicitly listed as Open Question 2. |
| Gamepad specifics | **LOW** | Training knowledge only (A1). |

**Research date:** 2026-09-08
**Valid until:** 2026-10-08 for the ecosystem claims. The `[MEASURED]` findings are pinned to `@dimforge/rapier3d@0.20.0` and `three@0.185.1` specifically and remain valid for as long as those pins hold — which, per Phase 1's exact-pin decision, is the life of the project unless a pin is deliberately bumped. **A Rapier pin bump invalidates every number in this document and must trigger a full telemetry re-run.**
