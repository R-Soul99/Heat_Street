# ADR 0002 — Helicopter camera passes its SC4 go/no-go gate: GO

- **Status:** Accepted
- **Date:** 2026-09-12
- **Phase:** 03 surfaces-helicopter-camera (plan 03-08), satisfying ROADMAP Phase 3 success
  criteria SC3 and SC4
- **Deciders:** Project owner, via a live human playtest of the shipped build

## Context

`.planning/ROADMAP.md`'s Phase 5 "Hard ordering constraints" states the helicopter camera is
"prototyped early (Phase 3) with a go/no-go gate, not treated as late polish." CONTEXT.md's
**D-12** goes further: if the gate genuinely fails after real tuning effort, the low chase-cam
fallback *becomes the shipped camera*, reframing PROJECT.md's "permanent helicopter camera"
line as a target contingent on this playtest, not a foregone conclusion.

ROADMAP Phase 3's success criteria, verbatim:

- **SC3:** "Player views the game through a permanent high-angle helicopter camera that tracks
  velocity heading and stays stable through a full 40-degree drift"
- **SC4:** "Camera altitude and FOV shift with speed such that a human playtester can tell
  60mph from 110mph on sight (explicit go/no-go gate; a low chase-cam fallback remains
  selectable)"

Plan 03-07 wired the six-surface test scene and the helicopter camera rig (plan 03-04's
`helicopter-camera.ts`, built on plan 03-02's pure heading/framing math) into the composition
root. Automated evidence already in hand before this session: the altitude/FOV curve is
monotonic, clamps at both ends, is `NaN`-proof, and separates 60 mph from 110 mph by **7.0
degrees of FOV and 6.0 metres of altitude** on the shipped defaults (`tests/camera-tuning.test.ts`).
What no automated test can answer is whether that separation *reads* as faster to a human —
which is the entire reason this gate exists.

## Decision

**GO — the helicopter camera ships**, with no retuning required. Every camera default shipped
by plan 03-04 was judged correct on first playtest.

### Evidence (verbatim playtest answers)

1. **Speed legibility (SC4, the gate).** *"fov range, altitude and ground detail [carried the
   signal] — didn't retune anything."* The developer held ~60 mph, looked away from the gauge,
   accelerated to ~110 mph, and could tell the difference on sight using the world alone, with
   the shipped defaults, no sweep of `Camera > Framing` needed.
2. **Drift stability (SC3).** *"smooth — camera really does look like a chopper, except for
   when car is trying to do a doughnut and slows to a stop — then the camera tracks until car
   is near-stopped then smoothly pans around to the rear of the vehicle again."* No spin, hunt
   or snap was reported at low speed. The doughnut-to-stop behaviour is the documented
   near-zero-speed fallback in `blendedHeadingRad` (`src/render/camera/camera-math.ts`):
   below `Camera > Damping > headingLambda`'s blend threshold, the target heading deliberately
   shifts from (noisy) velocity heading to chassis-forward heading, landing behind the car
   rather than whipping around on raw velocity noise — exactly what CONTEXT.md's **D-11**
   ("no shake or jitter, with a smooth lag... not a rigid instant lock") asks for. The developer
   separately noted a preference that the camera "stay relatively still while the car
   manoeuvres within the view" during a doughnut specifically — a polish preference, not a
   failure against SC3/D-11, carried forward to plan 03-12's feel session below.
3. **Fallback comparison (D-12).** The developer drove the dense-building corridor (plan
   03-05's `DENSE_BUILDINGS` cluster) in both rigs via the `C` toggle: *"drove down the
   corridor between 2 rows of buildings and in both chase and helicopter cam it looked good."*
   No regression found in the helicopter rig relative to the chase-cam fallback.
4. **Frame cost (03-RESEARCH.md Pitfall 4).** The `#game.skin-police`/`#game.skin-sports` CSS
   filter's compositor cost was measured directly (`requestAnimationFrame`-based FPS sampling,
   3 s per condition, filter class toggled and restored): **120.1 FPS with the skin active vs.
   120.0 FPS without — a 0.0 FPS difference.** Not material.
5. **Skins (CAM-03 / D-14 / D-15).** *"skins definitely different, no change to behaviour, just
   colours and the corner label."* Matches the acceptance bar exactly: distinguishable
   presentation, zero effect on distance/damping/targeting.

### Deviation found and fixed during this session

The developer fell off the six-surface scene's drivable floor while the reference grid still
showed lines, reporting: *"the grid extends beyond the world's floor so i keep falling off,
thinking i'm still on tarmac."* Root cause: `src/render/vehicle-view.ts`'s reference grid was a
fixed 400 x 400 m `THREE.GridHelper` inherited from the Phase 2 flat-plane fixture, drawn far
wider (±200 m) than the six-surface scene's actual physics floor (±60 m in X). Fixed in this
session (commit `9a86186`, before the second playtest pass): `createVehicleView` gained a
`groundExtents` option, defaulting to the old 400 x 400 m square for every pre-Phase-3 call
site, and `src/main.ts` now sizes it from `src/physics/surface-scene.ts`'s own
`SURFACE_SCENE_FLOOR_HALF_EXTENTS` so render and physics floor extents cannot drift apart
again. Re-verified clean on the second pass (`npm run check`, 503/503 tests, `npm run build`).

### Not fully confirmed manually — automated evidence stands in

**Straight-line stability on loose surfaces (SC1 carry-forward, Phase 2's spin-out
regression).** The developer could not sustain a full-throttle run on the mud/sand bands
long enough to judge by hand: *"game area is too small to test full throttle anywhere"* — each
surface zone is only 80 m long. This is the same test plan 03-06's automated stability sweep
already proves headlessly: worst-case measured slip across all six surfaces is 8.8°, against a
30° spin-out threshold (`tests/surface-telemetry.test.ts`). The automated result is taken as
the evidence of record for this item; the scene's zone length is a known limitation of a
placeholder fixture (CONTEXT.md's **D-03**: this scene is explicitly superseded by Phase 4's
real map pipeline, not shipped content).

**Gamepad (Phase 2 SC2 carry-forward).** No hardware was available this session (*"no not
yet"*). Remains an open item, already tracked in `.planning/STATE.md`.

## Consequences

- **PROJECT.md's "permanent helicopter camera" line stands as written** — it is no longer a
  target contingent on this playtest, it is the confirmed shipped behaviour.
- **`src/main.ts`'s `activeRig` initialiser stays `helicopterRig`** — no code change was
  required, since the gate passed with the already-shipped default. The chase rig remains live
  behind the `C` toggle as a dev comparison tool and D-12's proven fallback path, not because
  it is needed for shipping.
- **No `camera-tuning.ts` defaults change provenance tag** — every value stays `[ASSUMED]`
  exactly as plan 03-04 shipped it, since nothing was retuned. `[ASSUMED]` here should be read
  as "shipped-default value, confirmed correct by a human playtest with zero changes," not
  "unverified."
- **Plan 03-09's occlusion mitigation work (CAM-04) stays meaningful** — it was contingent on
  the helicopter camera shipping, and the corridor comparison in this session found no reason
  to reconsider that.
- **Two items carry forward to plan 03-12's feel session**, per this plan's own instruction not
  to fix surface feel here: (1) the vehicle currently reads as "floaty" and not clearly
  interacting with the surface underneath it, compounded by a lack of visible ground detail
  texture; (2) a request to make the camera hold its position more during a doughnut, as a
  polish preference beyond D-11's minimum bar.
- **The reference-grid bug fixed in this session is a general render-tier correctness fix**,
  not scoped to the camera decision — it would have affected any future work using the
  six-surface scene, camera-related or not.

## Enforcement

| Guarantee | Mechanism |
|---|---|
| SC4's 60/110 mph separation cannot silently regress | `tests/camera-tuning.test.ts`'s monotonicity, clamp and NaN-proof assertions against the shipped defaults |
| The reference grid cannot silently drift wider than the physics floor again | `src/main.ts` sources `groundExtents` from `src/physics/surface-scene.ts`'s own `SURFACE_SCENE_FLOOR_HALF_EXTENTS`, a single source of truth for both tiers |
| This decision cannot be lost | This ADR, `## Decision` section names the outcome (`GO`) explicitly |

## Open Questions

Carried forward, neither blocks the rest of Phase 3:

1. **Vehicle "floaty" feel and lack of ground detail** — assigned to plan 03-12's feel session.
2. **Camera hold-still preference during a doughnut** — a polish idea for a future tuning pass,
   not a blocking requirement.
3. **Gamepad hardware verification** — still no hardware available; tracked in
   `.planning/STATE.md`.

## References

- `.planning/ROADMAP.md` Phase 3 Success Criteria 3 and 4
- `.planning/phases/03-surfaces-helicopter-camera/03-CONTEXT.md` D-11, D-12, D-14, D-15
- `.planning/phases/03-surfaces-helicopter-camera/03-08-PLAN.md`
- `tests/camera-tuning.test.ts`, `tests/surface-telemetry.test.ts`
- `src/render/camera/camera-math.ts` (`blendedHeadingRad`'s near-zero-speed fallback)
- Commit `9a86186` (reference-grid bound-to-floor fix)
