---
title: Off-road point-to-point stages with off-road vehicles
trigger_condition: Surface when VEH-05 (additional cars) is being planned, or once the world builder / terrain editor is stable enough to author a full course end-to-end. Best picked up after Phase 6 (medals) so off-road stages can ship with medal times from day one.
planted_date: 2026-11-11
---

## The idea

The world builder (terrain editor, sculpting, road lock/re-grade) is turning
out to be fun to build in, and it is well suited to hand-authored off-road
courses: dirt tracks, washes, dune fields, hill climbs, jumps and creek
crossings. Pair those with a new class of off-road vehicles that have
suspension built for it, and run them as point-to-point races.

Period fit is good: Baja 1000 desert racing, dune buggies, 4x4 pickups and
rally cars all belong to the late 60s and 70s, and the dirt-road chases in
Smokey and the Bandit and The Dukes of Hazzard are already in the project's
reference list. The sports-broadcast chopper camera (CAM-03) suits a desert
stage as-is.

## What it needs

- **Off-road vehicle class (VEH-06).** Long-travel, soft suspension (longer
  rest length and max travel, lower stiffness, more damping), bigger wheels,
  higher ride height, and grip curves that favour loose surfaces over tarmac.
  Candidate archetypes: dune buggy (light, twitchy), Baja truck (heavy, long
  travel, big jumps), rally coupe (planted, AWD-ish). Original designs only,
  no real models.
- **Heavy vehicle class (VEH-07).** Trucks and monster trucks: anything
  with serious suspension and power. Examples: a 4x4 pickup, a big-rig cab or
  flatbed, a lifted crew-cab, and a monster truck with huge wheels and very
  long suspension travel. All original designs. They need a lot of mass with a
  high centre of mass (body roll, rollover risk), slow steering, plenty of
  torque, and landings that soak up big drops. A monster truck should be able
  to drive over obstacles a car can't, so the courses are built around that.
  Watch out for: Rapier stability with very heavy, very tall bodies; wheel
  radius much bigger than today's (the raycast suspension and wheel visuals
  need to scale); and how they collide with lighter cars (mass ratio).
- **Surface particle FX upgrade (SURF-03).** Today
  `src/render/surface-fx.ts` is a deliberately simple first version: flat
  square `THREE.Points` sprites and a skid-decal pool. In play it reads as
  blocky skid marks on tarmac and not much else. Off-road racing needs:
  soft textured particles (round, soft-edged, fading, growing over their
  life) instead of square points; continuous dust trails on dry dirt/sand
  while moving, not just when sliding; roost (dirt kicked up behind driven
  wheels) on dirt and gravel; mud spray and clods; water splashes at creek
  crossings; a landing-impact dust burst after jumps; and smooth continuous
  tyre-track ribbons that follow the terrain instead of blocky decals,
  with ruts on soft ground. Effects scale with vehicle size, so a monster
  truck throws far more dirt than a buggy. Dust clouds tie into
  `seeds/dust-cloud-los-evasion.md`. That module's header already lists
  physics-based debris as deferred. Needs a particle budget check, since
  several vehicles on loose ground could get expensive.
- **Drivetrain per car.** A 4x4 or AWD truck needs the configurable drivetrain
  from the pending todo
  `todos/pending/2026-09-20-support-configurable-drivetrain-type-per-car-class.md`.
- **Off-road P2P mode (MODE-04).** Point-to-point stage from start to finish
  across open terrain. Today P2P (P2P-01) and the navigation arrow lean on the
  road graph, so an off-road stage needs checkpoints placed freely on the
  terrain and route guidance that doesn't need a road under it (gate markers,
  flags, or an authored racing line for the arrow).
- **Course authoring in the world builder.** Placing start, finish and
  checkpoint gates on terrain; maybe "track" painting that sets the surface
  type (dirt/gravel/sand/mud) so grip varies along the stage.
- **Surfaces.** Reuses the existing per-wheel surface grip; may need sand and
  mud tuned harder (sinking, drag) for off-road cars, and kept punishing for
  muscle cars.
- **Medal integrity.** Medal times depend on the terrain staying fixed. A
  stage's terrain must be locked or versioned once its medal times are set,
  like the road lock already does for roads; editing the terrain should flag
  the stage's medal times as stale.

## Open questions

- Can Rapier's raycast vehicle give convincing long-travel suspension and big
  landings without bouncing or bottoming out? Worth a short spike when VEH-06
  is planned (same tuning-panel approach as Phase 2).
- Terrain heightfield resolution: is the current grid fine enough for bumpy
  off-road surfaces, or does it need finer cells in course areas?
- Do muscle cars race these stages too (as a harder challenge), or are
  off-road stages locked to off-road vehicles? Medal times would be per stage
  and per vehicle class either way.
- Should off-road stages also host Getaway chases later (Dukes of Hazzard
  style dirt-road pursuits)? That would need the pursuer AI to drive off the
  road graph; the stack notes already flag a graph+navmesh hybrid for this.

## Breadcrumbs

- `.planning/REQUIREMENTS.md`: MODE-04, VEH-06, VEH-07, SURF-03 (v2), VEH-05, SURF-02, P2P-01, CAM-03
- `src/render/surface-fx.ts`: current particle and skid-decal system (the SURF-02 first version)
- `.planning/seeds/dust-cloud-los-evasion.md`: dust clouds as gameplay
- `.planning/todos/pending/2026-09-20-support-configurable-drivetrain-type-per-car-class.md`
- `.planning/phases/04.2-*` and `04.3-*`: driveable terrain work the course editor builds on
- `CLAUDE.md` stack notes: `@recast-navigation/three` as the off-road AI option
