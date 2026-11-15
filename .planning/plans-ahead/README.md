# Plans ahead

Written 2026-11-15 from a survey of the code on branch `ai/circuit-race-finish`.
These are implementation plans for the larger pieces of work still to do. Each
one is written so a smaller model can execute it without re-deriving the design.

They are briefs, not GSD `PLAN.md` files. To run one through GSD, add the phase
to `.planning/ROADMAP.md` and hand the brief to `/gsd-plan-phase` as its context
(the same way `.planning/gsd-brief-driveable-terrain.md` fed Phase 04.2). Or
execute a brief directly, stage by stage, with `/gsd-quick`.

## The plans, in recommended order

| # | File | What it delivers | Size | Depends on |
|---|------|------------------|------|------------|
| 1 | `01-start-points.md` | Named start points placed in the terrain editor; test drives start where you chose, facing the way you chose | Small | nothing |
| 2 | `02-scenery-palette.md` | Buildings, trees, hedges, fences, bushes and ramps placed from an editor palette, visible and solid in the game (roadmap Phase 07.1.3) | Large | 1 (shares the placement tool) |
| 3 | `03-vehicle-types.md` | A vehicle registry and four new vehicles: buggy, rally car, 4x4 truck, monster truck, each with its own suspension (VEH-06, VEH-07) | Large | nothing |
| 4 | `04-off-road-stages.md` | Point-to-point stages across open terrain with free-placed gates, authored in the terrain editor (MODE-04) | Medium | 1, and 3 for the vehicles |
| 5 | `05-art-pass.md` | Shaped car bodies in place of boxes, soft particles, dust trails, continuous tyre tracks (SURF-03) | Large | 3 (bodies are per vehicle) |

Why this order: 1 is small and fixes a daily annoyance. 2 unblocks map building,
which is how new content gets made. 3 and 4 together make off-road racing. 5 is
last because the bodies and effects depend on the vehicle list being settled.

Not covered here: Phase 8 (Getaway: heat tiers, damage, radio chatter). It
already has roadmap success criteria and a working prototype (`?pursuers=N`,
bust meter), so it should go through the normal `/gsd-discuss-phase 8` route.

## Rules that apply to every plan

Read these before starting any stage. They come from `CLAUDE.md`, project
memory and the existing code.

1. **Start through GSD.** `CLAUDE.md` says file edits go through a GSD command
   (`/gsd-quick`, `/gsd-execute-phase`).
2. **Branch per piece of work**, named by area: `map/...`, `car/...`, `art/...`,
   `ai/...`. `main` only gets work the user has driven and approved. Tag a
   rollback point before merging. Never push or merge without being asked.
3. **`npm run check` must pass** (typecheck, biome, vitest) before every commit.
4. **Layering is enforced by `tests/layering.test.ts`.** `src/core/` is pure: no
   three, rapier or DOM imports. `src/render/` never imports rapier and never
   writes simulation state. Put logic in `src/core/` and test it there.
5. **Tests first for pure logic.** Tests live in `tests/` (game) or beside the
   source in `tools/` (editors). Do not try to unit-test driving feel.
6. **Fixed timestep.** Anything that affects physics runs inside the fixed tick.
   No wall-clock reads in `src/core/`.
7. **Saved browser tuning hides new defaults.** The `?debug` tuning panel saves
   to `localStorage` per vehicle class. After changing a default, test with a
   clean profile or clear the key, or the change will appear to do nothing.
8. **Medal times depend on handling.** Any change to the shipped `rwd` car's
   behaviour invalidates recorded medals. Plans 3 and 5 must leave the `rwd`
   car's physics bit-identical; each says how to prove it.
9. **Fix the car, not the terrain.** Do not reshape maps or ramps to hide a
   handling problem.
10. **Keep human checks short.** The user dislikes re-driving the same long
    track. Measure headlessly, then ask for one short drive about feel.
11. **Editor UI:** group related tools behind one button, put option values in
    the left sidebar, keep controls next to what they affect, lay grids out in
    even rows. Show the user a layout sketch before building editor UI.
12. **No real car makes, logos or exact reproductions** in names or shapes.
13. **Don't spawn subagents or start the dev server** unless the user asks. The
    user runs the dev server at `http://localhost:5173/`.
14. **Stage files by explicit path.** `public/maps/arena-test.terrain.*` often
    has the user's unsaved editor work in it; never stage or revert it.

## How each plan is laid out

- **Goal** and **what the user sees when it is done**.
- **Current state**: what exists today, with file paths. Line numbers were
  correct on 2026-11-15; re-read the file before relying on one.
- **Decisions**: design choices already made. Ones marked **ASK** need the
  user's answer before the stage that uses them; a default is given so work
  can continue if they don't mind.
- **Stages**: ordered, each one commit-sized, with files, steps, tests and a
  "done when" check. Do them in order. Stop and report if a "done when" fails
  twice; do not work around it.
- **Human check**: the short browser check to ask the user for at the end.
- **Traps**: mistakes that are easy to make in this codebase.
