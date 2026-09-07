# Heat Street

## What This Is

A browser-based driving/chase game built around the feel of 1960s-70s car
chase cinema (Bullitt, The French Connection, Dukes of Hazzard, Starsky &
Hutch, Smokey and the Bandit, The Italian Job, Mad Max). Players race, evade
police-style pursuers, or survive escalating chases across real-world-derived
road layouts, viewed through a permanent high-angle "helicopter cam" that's
contextually reskinned (police/news chopper for chase modes, sports
broadcast chopper for race modes). Story emerges from the action itself —
mission briefs and radio chatter, not cutscenes.

## Core Value

The driving itself must feel weighty, cinematic, and replayable — big
slides, tire smoke, jumps, and a heavy rear-wheel-drive-loose feel — with
medal-time chasing (bronze/silver/gold) giving every route long-term replay
value.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Player can drive a muscle car with arcade-realistic handling (weighty, momentum-driven, controllable oversteer/understeer)
- [ ] Player can complete Point-to-Point races (unordered checkpoints, any route)
- [ ] Player can complete Circuit races (ordered checkpoint loop, AI racers present)
- [ ] Player can play Getaway mode (escape AI police-style pursuers using the heat system)
- [ ] Player can play Survival mode (continuous escalating pursuit, no escape condition)
- [ ] Every mode instance uses a persistent high-angle "helicopter" camera, contextually skinned (police/news chopper for chase modes, sports broadcast chopper for race modes)
- [ ] Player earns a medal (bronze/silver/gold) per level based on completion time, gold requiring near-perfect execution
- [ ] Completing levels in the current area unlocks the next area/map
- [ ] Once an area is unlocked, all its modes are freely replayable for medal-time chasing
- [ ] Best times are tracked and visible to the player
- [ ] Light narrative framing delivered via mission briefs and radio chatter (no cutscenes/dialogue trees/characters)
- [ ] Surfaces (tarmac/gravel/grass/mud/sand/dirt road) affect grip and are visually/audibly distinct
- [ ] Vehicle and pursuer damage affects performance, with a destruction end-state for Survival/Getaway

### Out of Scope

- Procedurally generated maps — ruled out from the start; always hand-authored or derived from real-world data
- Licensed/exact car reproductions — original stylized designs inspired by muscle car silhouettes only, no manufacturer names/logos
- Multiplayer — not in v1, may revisit later
- Full narrative (cutscenes, dialogue trees, characters) — deliberately excluded in favor of light framing; matches the player's own low patience for story
- Mobile support — desktop browser first (keyboard + gamepad)

## Context

- Solo/hobby project, built entirely through Claude Code with no Unity install — the code-driven stack (Three.js + Rapier + TypeScript/Vite) was chosen specifically to fit this workflow.
- The player already has a custom-built tool ("Map Heightmap & 3D GLTF Generator") that extracts real-world areas into game-map-usable data — the preferred pipeline for map creation. Checked its source directly (2026-09-08): roads and buildings are already sourced from OpenStreetMap via the Overpass API, and elevation gracefully falls back to open data (AWS Terrarium/SRTM tiles, then Open-Meteo) with no Google key required — none of the exported game data is Google-sourced. The tool does proxy Google satellite/Street View imagery for on-screen preview only (never baked into exports), which is a low-risk use but worth re-confirming at export time. One small obligation: OSM's ODbL license requires crediting "Map data © OpenStreetMap contributors" somewhere in the shipped game (e.g. a credits screen). Whether v1 ships as one large mixed-terrain map or several smaller maps is still undecided and deliberately deferred to implementation; the tool works either way.
- No 3D modelling experience. Research (2026-09) surfaced a workable pipeline: Kenney.nl's free CC0 "Car Kit" for wheel-rig/technical base, plus a muscle-car-styled low-poly source (e.g. T Allen Studios' free itch.io model, AI generation via Meshy/Tripo3D, or a freelance commission) reskinned to match. IP research confirmed stylized/unbranded muscle-car homages (silhouette/proportion only, no logos or exact reproductions) are legally safe — same precedent as GTA's approach for decades.
- Reference touchstones for tone: Bullitt, Vanishing Point, The French Connection, The Seven-Ups, Gone in 60 Seconds (1974), Mad Max, The Italian Job, The Blues Brothers, Dukes of Hazzard, Starsky & Hutch, Smokey and the Bandit, The Cannonball Run.
- Handling target is "arcade-realistic hybrid" — not full sim, not arcade-floaty. Open research item: benchmark against Driver/Burnout/The Crew once prototyping starts.
- A detailed technical breakdown of core shared systems (vehicle physics, surface friction, camera rig, damage/destruction, NPC driving AI, checkpoint system) already exists in `heat-street-design-doc.md` and the original project draft — useful input for research and roadmap phases.

## Constraints

- **Tech stack**: Three.js (WebGL) + Rapier (rapier3d/WASM) + TypeScript + Vite — entirely code-driven, no visual editor dependency, to fit a Claude-Code-only workflow
- **Platform**: Desktop browser first (keyboard + gamepad); mobile not a launch requirement
- **Art pipeline**: Low-poly/stylized glTF models favoring silhouette and color over surface detail (camera is mid-to-far distance most of the time) — matches zero in-house modelling skill
- **IP**: No real manufacturer names, logos, or exact vehicle reproductions in shipped assets

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Helicopter-style high-angle chase camera used throughout all modes, contextually reskinned | Signature visual identity from chase cinema/news coverage; avoids building and maintaining two separate camera systems | — Pending |
| Car assets sourced via free CC0 base kit (Kenney) + muscle-car-silhouette source (free asset / AI-gen / commission), reskinned | No modelling experience; fastest path to game-ready glTF models without building a full art pipeline | — Pending |
| Progression: hybrid area-unlock + freeform medal-time replay within unlocked areas | Balances a structured sense of progress with the MGS-VR-mission-style replayability the player wants | — Pending |
| Narrative kept light — mission briefs + radio chatter only, no cutscenes/dialogue | Matches player's own low patience for story and the chase-movie tone; costs nothing extra to build on top of planned heat-system feedback | — Pending |
| Map scale (one large mixed-terrain map vs. several smaller maps) left open | Not critical to decide now; the player's own Google Maps extraction tool can produce either, decision deferred to implementation | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-08 after confirming map data source is clean*
