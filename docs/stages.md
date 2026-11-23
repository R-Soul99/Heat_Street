# Stages and routes

This guide covers the two kinds of authored courses on a terrain map: **stages** (gates across
open ground) and **road routes** (point to point or circuit, along the road network). Both are
authored with the one Route tool in the terrain editor and driven from the game by URL.

## 1. What a stage is

A stage is a start, an ordered list of gates, and a finish.

- Gates count strictly in order and only in the forward direction (along the gate's heading).
  After the last gate, the finish is crossed the same way.
- There is no wrong-way penalty or wrong-way detector.
- Respawn puts the car back at the last gate passed (or the start) and adds 5 s to the time.
- Your personal best is kept per area, per stage and per vehicle class.
- Medals are optional. A stage without medals runs time-only.

## 2. Files

All files live in `public/maps/` beside the terrain, with the map id as the prefix.

| File | Holds | Notes |
|---|---|---|
| `<id>.stages.json` | 0 to 20 stages | Format: [schemas/stage.v1.md](schemas/stage.v1.md). Medals are optional per stage. |
| `<id>.routes.json` | 0 to 20 road routes | Point to point and circuit routes. Each has an optional start `x`/`z` with a YAW `headingRad`. Checkpoints are bound to the nearest road node when the editor saves. |
| `<id>.medals.json` | Optional medal times per route | Only used on terrain maps; routes without an entry run time-only. |

A map can hold any number of stages and routes, including none. Absent files are fine.

Headings are YAW in radians (world forward = `(-sin h, -cos h)`), the same convention as terrain
start points.

## 3. URL parameters

| URL | Result |
|---|---|
| `?map=<id>&mode=stage` | Drive the first stage of the map |
| `?map=<id>&mode=stage&stage=<sid>` | Drive that stage |
| `?map=<id>&mode=p2p` or `mode=circuit` or `mode=circuit-race` | Race a road route of that kind (first one found) |
| `?map=<id>&mode=p2p&route=<courseId>` | Race exactly that route (any mode value is accepted; the route's own kind wins) |

Fallbacks, each logged as a console warning rather than an error:

- Stage mode on a map with no terrain, no stages file, a stages file for another area, or an empty
  stages file falls back to free drive.
- An invalid or unknown `stage=` id uses the first stage.
- An invalid `route=` id, or a mode with no matching route, uses the first available route.
- Missing or stale medals run the route time-only with a warning.

Spawn priority, highest first: stage start, route start, `?at=x,z` (with `?heading=` in degrees),
`?start=<id>`, then the sidecar's default start point.

## 4. Authoring in the terrain editor

Open the editor, then **Place > Route** (key `8`).

1. Pick a **Kind**: Stage, Point to point or Circuit. The two road kinds are disabled with the
   hint "This map has no roads; use Stage" when the map has no road nodes.
2. Drag on the map to set the start; the drag direction is the facing.
3. Click (or drag) to add gates, or checkpoints for road routes, in driving order.
4. Press **Enter** to place the finish at the pointer (the **Lap line** for a circuit).
5. **Backspace** removes the last item; **Esc** cancels a gesture or a pending New.

Other controls:

- Drag a marker to move it; drag the arrow tip of the start (or of any stage item) to turn it.
- The Routes panel lists everything on the map as "Stage: ...", "Point to point: ..." or
  "Circuit: ...". Use New, Rename and Delete, reorder items with the arrows, and set Width or
  Turn on the selected stage item. Circuits have a **Laps** box (1 to 20, default 3).
- Warnings appear in the info bar: gates more than 600 m apart, steep slope at a gate, and for
  road routes "Checkpoint N is off road" (a checkpoint farther than 30 m from any road node, also
  shown as an "off road" tag on the map). Checkpoints may sit anywhere; this is advice only.
- **Ctrl+S** saves the map and writes the stages and routes files. A route needs a start and a
  finish, and at least 2 checkpoints including the finish (3 for a circuit).
- **Test stage** / **Test route** saves, then opens the game on that stage or route.
- Every edit is an undo step.

Editing a route that already has medals rewrites `routes.json`. The medals file is not touched; if
the checkpoints changed, the game warns and runs that map's routes time-only until medals are
re-recorded. The editor shows a notice after saving in that case.

## 5. Recording medals

Medal times for new stages and routes are recorded later, with the project owner, by driving the
course at gold, silver and bronze pace. Re-record after changing the terrain or the vehicle
handling, because both change what a fair time is.

## 6. Personal bests

Stage personal bests are stored in the browser under the localStorage key
`heat-street.stage-bests.v1`, validated on load.
