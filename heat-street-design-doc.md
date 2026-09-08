# Heat Street — Design Doc (Draft v0.1)

*Working title. Racing / getaway / survival driving game.*

## 1. Concept

A driving game built around the feel of classic 1960s–70s car chase cinema —
Bullitt, The French Connection, The Seven-Ups, Smokey and the Bandit, The
Blues Brothers, Dukes of Hazzard, Starsky & Hutch, The Italian Job, The
Cannonball Run, Mad Max. Minimal story: the player is either racing, evading
pursuers, or surviving relentless pursuit. The narrative comes from the
driving itself, not cutscenes or dialogue.

## 2. Tone & Reference

- Cinematic, muscle-car-era chase energy — not modern hypercar racing, not
  military-grade tactical driving.
- Should feel dangerous and weighty, with room for big stunts (jumps,
  drifts, destructible obstacles) in the spirit of the reference films.
- Visual/tonal touchstones: Bullitt, Vanishing Point, The French
  Connection, The Seven-Ups, Gone in 60 Seconds (1974), The Man with the
  Golden Gun, Mad Max, The Italian Job, The Blues Brothers, Dukes of
  Hazzard, Starsky & Hutch, Smokey and the Bandit, The Cannonball Run.

## 3. Vehicles

- Core roster: 1960s–70s American muscle cars.
- Secondary roster: European compacts of the era (Minis, Fiats, etc.) for
  variety and different handling profiles (nimble/light vs. heavy/powerful).
- Vehicle handling should differentiate cars meaningfully — a big V8 muscle
  car should feel and drive differently to a small European compact.

## 4. Handling & Physics

**Target: "arcade-realistic hybrid."** Not full simulation (no deep tire
slip-curve modelling, no granular suspension sim), and not fully arcade
either. The car should:
- Feel weighty and powerful — momentum matters, braking late has real
  consequences, understeer/oversteer are readable and controllable.
- Reward skillful driving (controlled drifts, weight transfer through
  corners) without demanding sim-level precision.
- Stay forgiving enough to support cinematic stunts (jumps, sliding
  through gaps, controlled chaos) without cars feeling floaty or arcadey
  in the Mario Kart sense.

*Open research item: reference a small number of existing games as
handling benchmarks (e.g. Driver, Burnout, The Crew) to anchor "where
between arcade and sim" more concretely once prototyping starts.*

## 5. Maps & Locations

- **No procedurally generated maps** — ruled out from the start.
- Map data is compiled **offline from OpenStreetMap plus an open DEM**
  (USGS 3DEP inside the US, Copernicus DEM GLO-30 globally) into a road
  graph plus geometry. This is the preferred pipeline for recreating
  real-world locations. The decision, its licences and its required
  attribution are frozen in `docs/adr/0001-map-data-source.md`, which
  supersedes any earlier description of this pipeline in this document.
- If real-map recreation proves impractical for a given area/mode, hand-
  built maps are an acceptable fallback — but always hand-authored or
  derived from real data, never procedurally generated.
- Map variety: cities, towns, and rural areas, to support different mode
  styles (tight urban chases vs. wide-open rural pursuit).

## 6. Camera

- Primary: zoomable/free chase camera, following the player's car.
- **Getaway and Survival modes specifically should support (or default to)
  an aerial "news/police helicopter" camera view** — evoking the
  news-chopper shots seen in Heat, Bullitt-era chase sequences, and real
  televised police pursuits. This is a signature feature, not a minor
  toggle.
- Open question: is the helicopter view player-selectable at will, or
  triggered automatically at certain heat/tension thresholds (e.g. cutting
  to chopper cam once heat is maxed)? Worth prototyping both.

## 7. Game Modes

1. **Point-to-Point Race** — race from A to B along roads within a map.
2. **Circuit Race** — traditional lap-based circuit built from a map's roads.
3. **Checkpoint Hunt** — hit checkpoints scattered across a map in any
   order, via any route.
4. **Getaway** — reach an escape point while pursued by police/gang NPCs.
   Uses the heat system (see below). Helicopter camera available.
5. **Survival** — relentless NPC pursuit; last as long as possible before
   the car is destroyed or the player is surrounded/boxed in. Escalation
   is central to this mode's design. Helicopter camera available.

## 8. Pursuit / Heat System (Getaway & Chase modes)

**Approach chosen: simple heat meter (Option A).**

- A heat level (e.g. 1–5 stars) rises based on player behaviour: being
  spotted, speeding past patrols, ramming pursuers, prolonged proximity
  to cops/gangs.
- Higher heat tiers increase pursuer count and aggression, and may
  introduce roadblocks or additional pursuer types at higher tiers.
- Heat decays when the player breaks line of sight / evades for a
  sustained period.
- Must be paired with clear player-facing feedback: sirens, radio
  chatter, minimap/heat indicator, so escalation never feels arbitrary.

**Survival mode** is treated separately — escalation there is continuous
and open-ended by design (the mode's entire premise is "how long can you
last"), rather than governed by the same discrete heat tiers.

## 9. Open Questions / Research Items

- Car body research (visual asset pipeline / how vehicle models get built
  or sourced).
- Handling benchmark games to anchor the arcade↔sim target more precisely.
- Helicopter camera: player-toggled vs. auto-triggered by heat/tension.
- Roadblock and higher-tier pursuer behaviour (only sketched, not designed).
- Scoring/progression (not yet discussed) — is there meta-progression
  across modes, or is each run self-contained?

## 10. Build Context

- No Unity — building as a browser-based game.
- Development via Claude Code using the GSD (Get Shit Done) spec-driven
  workflow.
- This document is intended as input into that GSD spec process, not a
  replacement for it.
