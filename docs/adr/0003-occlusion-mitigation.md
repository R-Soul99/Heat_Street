# ADR 0003 — CAM-04 occlusion mitigation: fade ships, steepen deferred

- **Status:** Accepted
- **Date:** 2026-09-13
- **Phase:** 03 surfaces-helicopter-camera (plan 03-12), satisfying ROADMAP Phase 3 success
  criterion SC6
- **Deciders:** Project owner, via a live human playtest of the shipped build, plus a
  test-anchored code investigation (quick task 260913-epf) into why one arm read as inert

## Context

CAM-04's own requirement text refuses to pre-commit to an approach: *"Exact approach resolved
by prototyping during Phase 3, not fixed in advance … Decided by human playtest feel, not on
paper."* Plan 03-09 implemented all three candidates behind one `O` toggle in
`src/render/camera/occlusion-controller.ts` — fade occluding buildings to translucent, steepen
the camera pitch toward near-overhead in dense clusters, and a no-mitigation `off` baseline —
specifically so this decision would be a real comparison, not a forced pick between two
untested options.

03-RESEARCH.md's Open Question 2 flagged that neither technique was designed for this exact
camera shape: third-person occlusion-fade normally assumes a much closer follow camera, and the
GTA1/2 steepen-on-approach precedent solved the reverse framing problem. That is precisely why
the answer was meant to be empirical rather than reasoned from precedent.

## Decision

**Fade ships as the default occlusion mitigation.** `src/main.ts` constructs
`createOcclusionController(..., "fade")` — unchanged from plan 03-09's shipped default, but no
longer provisional.

Steepen is **not rejected on its merits** — it is currently **unevaluated**, because a confirmed
implementation bug prevents it from doing anything in the only test scene available. `off` was
never explicitly driven as a distinct comparison arm this session. This ADR is explicit about
that gap rather than presenting a three-way comparison that didn't fully happen (see Evidence).

### Evidence

1. **Fade — verified working.** The developer drove into the dense-building canyon, got a
   building to occlude the car, and confirmed it faded to translucent as expected: *"Building
   went translucent, I was able to get a building to obscure the car then pressed o to change
   mode."* No depth-fighting, flicker, or "looks like a bug" complaint was raised. This
   satisfies CAM-04's core requirement — the car is never hidden — on its own.
2. **Steepen — blocked by a confirmed bug, not evaluated.** Cycling `O` into steepen mode
   produced no visible change: *"I didn't notice any difference on subsequent presses."* This
   was tested inside the actual `DENSE_BUILDINGS` canyon (not a single isolated building), so
   the flat result was investigated rather than dismissed as a bad test location. Quick task
   260913-epf's investigation (`tests/occlusion.test.ts`, `.planning/STATE.md`) found the root
   cause with worked arithmetic: `occludedFanRayCount`'s ±30° fan rays originate ~8 m lateral of
   the car, but the corridor's drivable half-width is only 5 m, so those ray origins land
   *inside* a building. `src/render/surface-view.ts`'s building material is `FrontSide`-only, so
   a ray originating inside a box exits through a culled back face and silently reports no hit.
   Every ray that stays within the corridor genuinely has nothing to hit either way. Density
   therefore measures **exactly 0/5 in every car position tried**, not merely low — steepen's
   pitch math (`steepenPitchRad`, now permanently anchored in `tests/occlusion.test.ts` at all
   five achievable fan densities) was never actually exercised above its baseline. **This is a
   measurement bug upstream of the mitigation, not evidence that steepening the camera reads
   badly** — there is no evidence either way yet.
3. **Off — not explicitly driven as a comparison arm.** The session's `O`-cycle testing covered
   fade (confirmed) and attempted steepen (blocked by the bug above); the plan's third arm,
   `off`, was not separately driven and judged this session. Recorded here rather than silently
   assumed.
4. **Relax-in-open-areas (CAM-04's second half) — not meaningfully tested.** The developer
   reported the camera "smoothly turned to the car again" on driving out of the canyon, but
   since steepen never actually engages (density stuck at 0), there was no steepened pose to
   relax *from* — this observation reflects normal heading-tracking behaviour, not the
   mitigation's relax path. Genuinely open until the density bug is fixed.

## Consequences

- **CAM-04's requirement is satisfied for v1 as shipped**: fade alone already guarantees
  buildings "never permanently block the view of the car or road," which is the requirement's
  hard bar. Steepen is a richer future option, not a gap in current coverage.
- **`src/main.ts`'s occlusion mitigation initialiser stays `"fade"`** — no code change to the
  shipped behaviour, only the removal of plan 03-09's "provisional" comment, now pointing here.
- **Steepen and `off` both remain fully implemented and live behind the `O` toggle** — nothing
  was deleted. A future session can re-run the comparison cheaply once the fan-ray bug is fixed.
- **The fan-ray/back-face bug is tracked as an open item**, not fixed by this ADR or by quick
  task 260913-epf (deliberately out of scope for that task — occlusion tuning is this plan's own
  human-judgement territory). See `.planning/STATE.md`'s Blockers/Concerns.
- **No `src/core/camera-tuning.ts` occlusion values changed** — `basePitchDeg`, `maxPitchDeg`,
  `fanRayCount`, `fadeLambda`, `fadeFloorOpacity`, `nearTargetMarginM` all remain `[ASSUMED]`,
  unretuned. Retuning steepen before its input bug is fixed would be tuning noise.

## Status update (plan 04-11, 2026-09-15)

The fan-ray/back-face bug's fix landed in plan 04-09 — `src/render/surface-view.ts`'s
(now `src/render/map-view.ts`'s) building materials moved to `DoubleSide`, exactly the
mitigation this ADR's "what would justify revisiting" section names below. Plan 04-11's own
feel session tried to use that fix to finally judge steepen on the real compiled area, per
this plan's Task 1 step 8. **The re-run did not happen.** The developer's own report: *"I tried
this but to be honest it's hard to tell what it's doing — the only way to hide the car from
view is to drive under a floating building/road, at which point I can't tell if it's the
occlusion type or general jank."* The floating-road/floating-building defect this same
session's Task 2 fixed (road shoulder grounding, `src/core/road-geometry.ts`'s
`buildRoadShoulders`) was itself confounding the only way the developer had found to trigger
occlusion, so the observation could not be attributed to steepen versus the unrelated defect.

**The fade-vs-steepen-vs-off comparison still has not been fairly run on real geometry.** The
`DoubleSide` fix is confirmed shipped and is no longer the blocker; the blocker this session was
the now-fixed floating geometry. `src/main.ts`'s mitigation initialiser stays `"fade"`,
unchanged, per this plan's own instruction not to change shipped camera behaviour here. A future
session should re-attempt the `O`-toggle comparison now that both known blockers are cleared.

## What would justify revisiting this decision

- ~~**The fan-ray/back-face bug gets fixed**~~ **Done (plan 04-09, `DoubleSide` materials).** See
  "Status update" above — fixed, but the re-run itself still hasn't happened, now for an
  unrelated reason (the floating-geometry defect, fixed by plan 04-11).
- **Phase 4's real city geometry** lands at a scale these fourteen placeholder boxes cannot
  represent (CONTEXT.md D-03). A dense real city block may make fade's "large translucent area"
  concern (noted as a con in this plan's own options list) material in a way the placeholder
  scene never could — worth a fresh look once real geometry exists.
- **Raycast cost becomes measurable** at real building density — CLAUDE.md's own
  `three-mesh-bvh` trigger condition for non-physics raycasts would apply to
  `occlusion-probe.ts`'s queries at that point.

## Enforcement

| Guarantee | Mechanism |
|---|---|
| The occlusion decision cannot be lost | This ADR's `## Decision` section names the outcome (`fade`) explicitly |
| `src/main.ts` cites this ADR at its mitigation initialiser | `grep -c "0003-occlusion-mitigation" src/main.ts` |
| Steepen's density-to-pitch curve doesn't silently regress once the input bug is fixed | `tests/occlusion.test.ts`'s five-density anchor against `steepenPitchRad` |
| The fan-ray bug isn't forgotten before a future re-run | `.planning/STATE.md` Blockers/Concerns entry tagged `[Quick 260913-epf]` |

## References

- `.planning/ROADMAP.md` Phase 3 Success Criterion 6
- `.planning/phases/03-surfaces-helicopter-camera/03-12-PLAN.md` Task 1 step 9, Task 2
- `.planning/phases/03-surfaces-helicopter-camera/03-RESEARCH.md` Open Question 2
- `.planning/quick/260913-epf-add-reverse-gear-and-a-temporary-debug-f/260913-epf-SUMMARY.md`
  ("Steepen Arm Investigation — Verdict")
- `src/render/camera/occlusion-controller.ts`, `src/render/camera/occlusion.ts`,
  `src/render/camera/occlusion-probe.ts`
- `tests/occlusion.test.ts`
