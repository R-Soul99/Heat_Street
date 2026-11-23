---
phase: 10
slug: off-road-stages
status: approved
reviewed_at: 2026-11-23
shadcn_initialized: false
preset: none
created: 2026-11-23
---

# Phase 10 - UI Design Contract

> Visual and interaction contract for: (A) the terrain editor Route tool (off-road stages and road race routes), Stages/Routes sidebar panel and Test button; (B) ramps as built objects (shape picker, angle/curve, material, snapping); (C) the in-game stage HUD (gates, arrow, timer, splits, results).
> Source tags: [D-nn] = locked in 10-CONTEXT.md; [brief] = `.planning/plans-ahead/04-off-road-stages.md`; [07.1.3] = carried from the approved 07.1.3 UI-SPEC and shipped editor shell; [Existing] = existing game HUD code in `src/hud/`; [Assumed] = gap filled non-interactively, repeated under "Assumptions".
> States only what is NEW. Everything else keeps the 07.1.3 / 07.1.2 / 07.1.1 contract: sidebar 240px, title/subtitle/divider/options body, value box, tooltip tiers, `menu` top-bar items, swatch rule, `details.section`, info bar, undo-per-gesture, hotkey audit on `e.code`.

---

## REVIEW SKETCH (D-09: for user review before building)

### Editor: Place menu and Route tool

```
Top bar: [Terrain v][Road v][Place v] | Grid Contours | Undo Redo | [Test stage]
                              +------------------+
                              | F Start point  1 |
                              |------------------|
                              | # Building     2 |
                              | T Tree         3 |
                              | B Bush         4 |
                              | H Hedge        5 |
                              | = Fence        6 |
                              | / Ramp         7 |
                              |------------------|
                              | > Route        8 |   <- NEW (stage or road race)
                              +------------------+
```

### Editor: Route tool armed (sidebar 240px + canvas)

```
+----------------------+----------------------------------------------+
| Place                |                                              |
| Route                |        . . . terrain canvas . . .            |
|----------------------|                                              |
| Kind                 |   [S]>--------(1)-------(2)                  |
| (Stage)(P2P)(Circuit)|    start        \          \                 |
|                      |                  \         (3)=>  [F]        |
| hint: Click+drag =   |                   `--------------   finish   |
| place start, then    |        gate widths shown as bars across      |
| gates. Enter = finish|        each arrow; dashed line joins them    |
|                      |                                              |
| Gate width  [ 20 m ] |                                              |
|                      |                                              |
| v Routes (3)         |                                              |
| [Stage: Dust Run  v] |                                              |
| [New][Rename][Delete]|                                              |
|  1 Start      ^ v x  |                                              |
|  2 Gate 1     ^ v x  |                                              |
|  3 Gate 2     ^ v x  |                                              |
|  4 Finish     ^ v x  |                                              |
|  (selected: Width    |                                              |
|   [20 m], Turn [90]) |                                              |
|                      |                                              |
| [   Test stage    ]  |                                              |
+----------------------+----------------------------------------------+
| Info: 3 gates, 1,240 m   ! Gate 3 is 640 m from gate 2              |
+---------------------------------------------------------------------+
```

### Editor: Ramp armed (D-14..D-18)

```
+----------------------+----------------------------------------------+
| Place                |                                              |
| Ramp                 |         ghost ramp (translucent) on terrain  |
|----------------------|                                              |
| Shape                |          +--[snap guide: accent line]--+      |
| [Kicker ][Wedge   ]  |      /|  |  gap 12 m   |\               |    |
| [Tabletop][Quarter]  |     /_|  |<----------->| \_             |    |
| [Half-pipe        ]  |   take-off (ghost)      landing (snapped)    |
|                      |                                              |
| Material             |                                              |
| [Wood  ][Metal ]     |                                              |
|  (tile) (tile)       |                                              |
|  grip 0.9  grip 0.7  |                                              |
|                      |                                              |
| Height  [ 2.0 m ]    |                                              |
| Width   [ 6.0 m ]    |                                              |
| Length  [ 8.0 m ]    |                                              |
| Angle   [ 20 deg ]   |   (Kicker, Tabletop only)                    |
| Curve   [ 40 %  ]    |   (Kicker, Tabletop only)                    |
| Gap     [ 12 m  ]    |   (Tabletop / gap jump only)                 |
|                      |                                              |
| Snapping             |                                              |
| [x] Terrain  [x] Line|                                              |
| [x] Pieces           |                                              |
|                      |                                              |
| v Ramps (4)  list    |                                              |
+----------------------+----------------------------------------------+
```

### In-game stage HUD (`?mode=stage`)

```
+---------------------------------------------------------------------+
| STAGE  Dust Run          GATE 2/4         TIME  01:12.48   [minimap] |
| (existing race HUD slots)                  PB    01:09.10            |
|                                                                     |
|              |  |  <- next gate: bright posts + banner + light beam |
|              |==|                                                   |
|                     ^                                               |
|                (next-gate arrow, existing navigation arrow)        |
|                                                                     |
|  SPLIT  G1 00:31.2 (-0.8)                                           |
|                                              [speedometer]          |
+---------------------------------------------------------------------+

Results (existing results view, no medals set):
+------------------------------+
| STAGE COMPLETE               |
| Time        01:12.48         |
| Penalty     +00:05.00        |
| Final       01:17.48         |
| Personal best  NEW BEST      |
| G1 .. G2 .. G3 .. splits     |
| [R] Restart   [Esc] Menu     |
+------------------------------+
(no medal row, no UNEARNED label when the stage has no medals)
```

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (vanilla TS + DOM + `tools/editor-shell/shell.css`; no UI framework per CLAUDE.md) |
| Preset | not applicable |
| Component library | none. Reuse shell controls: `createButton`, value box (`createStepper`), `menu` items, swatch grid, `details.section`, list rows [07.1.3] |
| Icon library | none. Unicode glyphs via `textContent`. New [Assumed]: Route ➤, Kicker ◢, Wedge ◣, Tabletop ▭, Quarter-pipe ◜, Half-pipe ⌓, Move up ▲, Move down ▼, Test ▶. Labels and `aria-label` carry meaning; planner may swap poorly rendering glyphs |
| Font | Editor: `13px system-ui, sans-serif` [07.1.1]. Game HUD: existing HUD fonts (`"Arial Narrow","Helvetica Neue",Helvetica,Arial,sans-serif` headings; monospace for timers) [Existing] |

Registry safety gate: not applicable (no shadcn, no third-party registries).

Focal points: Editor - the Route/Ramp sidebar title with the armed kind plus the ghost/route line on canvas. Game - the lit next gate and the timer.

---

## Layout Contract

### A. Place menu gains **Route** (entry 8) [D-09, D-11]
- One new entry below a divider (routes are not scenery), key `8` (`Digit8`). It authors stages and road races; one tool [D-11].
- Sidebar when armed: title "Place", subtitle "Route". Body top to bottom: hint block; **Kind** segmented control (Stage / Point to point / Circuit); **Gate width** value box (8 to 60 m, default 20, step 2, unit `m`; applies to new gates; Stage kind only; road kinds use the checkpoint size); **Laps** value box (Circuit only, 1 to 20, default 3); `details.section` **Routes ({n})** open.
- Kind Stage writes `<id>.stages.json`; P2P/Circuit write road route data (file layout per planning, D-12). The panel is identical for both so the user never sees the file split.

### B. Routes panel (sidebar section) [D-09, brief stage 6]
- Picker: a select listing "{Kind}: {name}" for all routes on the map, then buttons **New**, **Rename**, **Delete** (32px height, 4px gap).
- Ordered item list for the selected route: `Start`, `Gate 1..n` (road kinds: `Checkpoint 1..n`), `Finish` (Circuit: `Lap line`). Rows 32px, 4px gap: `[number][name][up][down][go to][delete]`. Selected row: 2px accent left border. Row click selects the marker and vice versa. Scrolls inside the section, not the sidebar.
- Selected item shows below the list: **Width** value box (Stage), **Turn** value box (0 to 359, step 15, unit deg). Dragging a marker moves it, dragging its arrow turns it, one undo step each [07.1.3 pattern].
- Primary button, full width at panel bottom: **Test stage** (Stage kind) / **Test route** (road kinds). Saves first, then opens `/?map=<id>&mode=stage&stage=<id>&debug` (road kinds: matching `?mode=`). Hotkey: none; also available in the top bar as the last item [Assumed].
- Info bar: "{n} gates, {total} m" running length; warnings (non-blocking, `--warn` text): "Gate {n} is {d} m from the previous gate", "Gate {n} sits on a steep slope", "Medals recorded for this stage may no longer be fair after terrain edits" (on save, only when medals exist, `--warn`).

### C. Canvas: route markers [brief stage 6, D-11]
- Reuse the game's `stage-view` look so the editor shows real gates: two posts `widthM` apart on terrain with a banner. Start = green `--ok #66cc99` flag; gates = accent-neutral white-ish banner (`#F2EFE6`); finish = chequered banner; selected item gets an accent `#4aa3ff` 1.6 m ground ring. Number tag above each marker (DOM tag, 11px, `--panel` fill), shown for all items of the selected route, none for other routes (other routes drawn dim at 40% alpha) [Assumed].
- A 2px dashed polyline joins start, gates and finish in order, accent for the selected route. Ghost: translucent gate follows the cursor, drag shows a facing arrow. Refused spot (outside area): ghost `--error`, `not-allowed`, info bar reason.
- Road kinds: checkpoints may sit anywhere; no snap-to-node; show a small "off road" `--warn` tag if the point is farther than 30 m from any road node [Assumed, D-13].

### D. Ramp panel [D-14..D-20]
Sidebar Place > Ramp, replacing the 07.1.3 Ramp body:
1. **Shape** swatch group (5 shapes: kicker, wedge, tabletop / gap jump, quarter-pipe, half-pipe). 5 does not divide by 3 or 2, so by the 07.1.3 column rule it is a 1-column list of 40px rows; glyph tile left, name at 11px right [07.1.3 rule].
2. **Material** swatch group, 2 columns (Wood, Metal), grid-fill tiles (2-column CSS grid, no fixed width) with a texture-hinting pattern tile (wood: horizontal plank stripes `#8A5A2B`/`#6F4521`; steel: `#8E959E`/`#6B727B` with rivet dots) and a 11px caption "grip {value}" under the name. Future materials follow the column rule.
3. **Value boxes** (label above, 32px): Height (m), Width (m), Length (m), then shape-dependent:
   - Kicker and Tabletop: **Angle** (deg) and **Curve** (%, 0 = straight plank, 100 = full quarter-curve lip) [D-16].
   - Tabletop / gap jump: **Gap** (m) between take-off and landing, plus **Landing** toggle (On/Off; On places the matching landing piece on the same axis).
   - Wedge, Quarter-pipe, Half-pipe: size only (Height, Width, Length); Half-pipe adds **Radius** (m) [Assumed].
   Ranges clamp with the stepper; out-of-range typing snaps to the nearest valid value. Exact numeric ranges come from the parser (planner).
4. **Snapping** section (`details.section`, open): three toggles, all On by default: **Terrain** (foot sits on terrain height under the foot, rigid deck keeps one base height, quick task 261116-ryu), **Line** (align to the car's line or the nearest route/gate direction within 15 deg, shown as an accent guide line), **Pieces** (edge-snap to other ramp pieces; take-off and landing share one axis at the set Gap). Holding Alt disables all snapping for that gesture [Assumed, avoids menu clash: Alt menu activation is already suppressed in Place].
5. **Ramps ({n})** list below, same row pattern as 07.1.3 start list: `[glyph][name][go to][delete]`; name auto "{Shape} {n}", inline renameable.

Canvas: ghost uses the real builder (own material, visible frame and side panels). Snap feedback: accent 2px guide line along the aligned axis, 6px accent dot at the snapped contact edge, info bar text "Snapped: terrain, line" listing active snaps. Press sets position, drag sets direction, release commits one undo step; changing a value box with a ramp selected edits it as one undo step [D-17]. Refused (outside area, on road paint is allowed for ramps): ghost `--error`.

Select mode: ramps selectable like other features (wire box accent). Shift-drag turns in place [07.1.3 pattern].

### E. Game stage HUD [brief, D-03..D-06, D-10]
- **Reuse** existing race HUD slots (`race-hud.ts`), minimap, speedometer and navigation arrow [Existing]. Stage mode adds no new HUD panel.
- Top-left status: "STAGE {name}" and "GATE {n}/{total}" (finish counts as the last). Timer in the existing timer slot, monospace, sim time only. Under it "PB {time}" if a personal best exists for this stage and vehicle class, else "PB --:--.--".
- No wrong-way warning in stage mode [D-04].
- **Gates in world** [D-10, no colliders]: next gate bright (`#ffd447`-warm banner, existing HUD gold), later gates dim (40% opacity, `#9A9AA0`), passed gates removed. Finish: chequered banner. Light beam: tall thin additive beam on the next gate only, `#ffd447` at 50% alpha. Posts seated on terrain at their own positions.
- **Arrow** points at `targetPosition` (next gate or finish) with `y` from the height sampler; same style as the existing navigation arrow.
- **Gate pass feedback:** banner flashes and the split line shows for 2.5 s: "G{n}  {split}  ({delta})" where delta is vs personal best, green `#66cc99` if faster, `#ff6b6b` if slower, no delta when no PB. Gate pass is silent aside from any existing checkpoint cue [Assumed].
- **Respawn** [D-05]: car returns to the last gate facing onward; existing flat penalty banner "+{n}s" reused. Penalty counts into the Final time.
- **Results** (existing `results-view.ts`) with: Time, Penalty, Final, split list per gate, Personal best line ("NEW BEST" in `#ffd447` or "PB {time}"), Restart and Menu actions. **When the stage has no medals [D-06]: no medal row, no "UNEARNED" text, no thresholds.** When medals exist: medal row as in the existing modes.
- Minimap: gate positions as remaining points; copes with an empty road graph (draw only the gates and the car).
- Fallback: on a non-terrain map `?mode=stage` falls back to free drive, no HUD change, console warning only [D-08].

---

## Spacing Scale

Declared values (multiples of 4), unchanged from 07.1.x:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Row gaps, swatch gaps, glyph-to-label |
| sm | 8px | Sidebar padding, gap between option rows |
| md | 16px | Section separation; game HUD edge inset |
| lg | 24px | Game HUD block gaps |
| xl | 32px | Value-box height, list rows, icon buttons |
| 2xl | 48px | Game results panel padding |
| 3xl | 64px | Not used |

Exceptions: Shape list rows 224px x 40px and Material tiles fill a 2-column CSS grid in 224px per the 07.1.3 exception; Place menu button 40px high. World-space gate, ramp and marker sizes are metres, not UI spacing.

---

## Typography

Exactly 4 sizes and 2 weights per surface.

Editor [07.1.2]:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 13px | 400 (section summaries 600) | 1.4 |
| Label / hint | 11px | 400 | 1.3 |
| Glyph | 16px | 400 | 1 |
| Display (sidebar title) | 24px | 600 | 1.2 |

Game HUD [Existing, reused sizes]:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Label (PB, split, gate count) | 12px | 400 | 1.3 |
| Body (status, results rows) | 16px | 400 | 1.4 |
| Heading (timer) | 26px | 700 | 1.2 |
| Display (results title) | 54px | 700 | 1.1 |

Note: the game HUD already uses weight 700 as its bold; stage elements use 400 and 700 only. No new sizes beyond these four in the stage HUD.

---

## Color

Editor chrome (no new colours): `--bg #14161a`, `--panel #1d2026`, `--panel-2 #262a32`, `--text #d8dde6`, `--accent #4aa3ff`, `--error #ff6b6b`, `--ok #66cc99`, `--warn #ffb347`.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `--bg #14161a` (editor); game: the 3D scene | Canvas surround, inputs |
| Secondary (30%) | `--panel` / `--panel-2` (editor); `rgba(7,16,21,.86)` (game HUD panels) [Existing] | Sidebar, lists, HUD panels |
| Accent (10%) | `--accent #4aa3ff` (editor); `#ffd447` (game HUD gold) [Existing] | See reserved list |
| Destructive | `#6b2b2b` fill, `--error` text | Delete route confirm only |

Accent reserved for:
1. Editor: Place trigger while armed; selected Kind segment, shape swatch and material swatch (2px outline); selected route item row border; selected marker ring; route polyline of the selected route; snap guide lines and snap dots; focus rings.
2. Game: the next gate banner and light beam, the timer when running, "NEW BEST", gate counter current value.
Not accent: passed/dim gates, dividers, tooltips, hover.

Semantic: faster-than-PB delta `--ok` / `#66cc99`; slower `--error`; warnings `--warn`. Ramp material colours (wood `#8A5A2B`, steel `#8E959E`) are world art, not UI colours.

---

## Copywriting Contract

Tooltips: `Name: sentence`, sentence case, 60 characters or fewer, no trailing full stop.

| Element | Copy |
|---------|------|
| Primary CTA (editor) | "Test stage" (road kinds: "Test route") |
| Primary CTA (game) | "Restart" (existing) |
| Empty state heading | "No routes" (Routes list); "No ramps" (Ramps list) |
| Empty state body | "Pick Place > Route, then click and drag to set the start, add gates, and press Enter to finish." / "Pick a shape, then press and drag on the terrain." |
| Error state | "Routes must be inside the map area" / "A stage can have at most 40 gates" / "A map can have at most 20 stages" / "A route needs a start and a finish" / "Could not save the route: {parser message}. Fix it and save again." / "Ramp is outside the map area" |
| Destructive confirmation | Delete route: heading "Delete {name}?", body "The route and its gates are removed from this map. Undo brings them back.", confirm "Delete route", dismiss "Keep route". Single gate or ramp delete: no dialog (undoable) |

Labels: Route, Kind, Stage, Point to point, Circuit, Gate width, Laps, Routes, New, Rename, Delete, Start, Gate {n}, Checkpoint {n}, Finish, Lap line, Turn, Test stage, Test route; Ramp, Shape, Kicker, Wedge, Tabletop, Quarter-pipe, Half-pipe, Material, Wood, Metal, Height, Width, Length, Angle, Curve, Gap, Landing, Radius, Snapping, Terrain, Line, Pieces.

Tooltips:
- Route: "Route: place a stage or a race route (8)"
- Test stage: "Test stage: save and drive this stage"
- Gate width: "Gate width: how wide the gate is, in metres"
- Angle: "Angle: slope of the take-off in degrees"
- Curve: "Curve: 0 is straight, 100 is a full curved lip"
- Gap: "Gap: distance between take-off and landing"
- Material: "Material: sets the look and the grip"
- Snapping Line: "Line: align to the nearest route direction"
- Snapping Pieces: "Pieces: snap edges to other ramps"
- Long tier (Snapping): "Hold Alt while placing to turn all snapping off for that click."
- Hints: Route "Click and drag to set the start, then add gates. Enter finishes." Ramp "Press, then drag toward the way it should face."

Game: "STAGE {name}", "GATE {n}/{total}", "PB {time}", "NEW BEST", "STAGE COMPLETE", "+{n}s" penalty. No wrong-way text.

---

## Interaction and State Contract

| Situation | Behaviour |
|-----------|-----------|
| Pick Route (8) | Menu closes, trigger accent, sidebar swaps, cursor crosshair, gate ghost follows cursor |
| First drag | Places start (position + facing) |
| Further drags | Append gates before the finish |
| Enter or double-click | Places the finish at the last point (Circuit: lap line) |
| Esc | Cancels drag, then disarms Route, then clears selection [07.1.3] |
| Backspace | Removes the last placed item of the route in progress |
| Marker drag / arrow drag | Moves / turns, one undo step each |
| Undo/Redo | Stage and route edits are a `stages` part of the undo diff; ramp edits likewise; one gesture = one step |
| Sculpting under routes or ramps | Markers and ramp feet re-seat to new terrain; stages store no y |
| Terrain edit with recorded medals | Notice on save (see Routes panel) |
| Typing in a field | Letter and digit hotkeys suspended |
| Game: crossing gate backwards or out of order | No effect, no feedback [D-03] |
| Game: restart / respawn | Existing commands; respawn per D-05 |
| Empty road graph | Every HUD piece must render without roads |

Hotkey added: `8` (`Digit8`) Place: Route; passes the hotkey audit (no collisions with the 07.1.3 set).

Accessibility: shape and material groups are `role="radiogroup"` with `aria-checked`; route list is `role="list"`; every control has `data-tip` and `aria-label`; text via `textContent`; disabled uses `aria-disabled="true"`; HUD relies on text plus colour (delta shows sign "-0.8" / "+0.4", not colour alone).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable (no shadcn) |
| third-party | none | not applicable |

---

## Assumptions (review in the morning)

1. Route is a new Place menu entry (key 8) under a divider; stage, P2P and circuit share one panel with a Kind switch, hiding the file split from the user [D-11, D-12].
2. Layout sketches above are proposals, as D-09 requires user review before build.
3. Gate banner colours: next gate gold `#ffd447`, later gates dim, finish chequered, start green; editor shows the same visuals plus number tags.
4. Test stage button lives in the panel bottom and also last in the top bar; no hotkey.
5. Road-kind checkpoints are free-placed with only an "off road" warning (D-13), no snapping to road nodes.
6. Ramp shape list is a 1-column list (5 shapes, by the 07.1.3 column rule); materials a 2-column grid showing grip values.
7. Curve is a 0 to 100 percent value; Landing toggle and Gap exist only for tabletop / gap jump; half-pipe has a Radius. Numeric ranges are for the planner.
8. Snapping toggles (Terrain, Line, Pieces) all default On; Alt disables snapping per gesture; guide lines accent.
9. Ramp placement on road paint is allowed (ramps are stunt objects); only outside-area is refused.
10. Gate-pass feedback: 2.5 s split line with delta vs PB, no new sounds.
11. Game HUD reuses existing sizes and colours; no new panel, no medal row when no medals exist.
12. Glyphs are placeholders and swappable.
13. D-20 structure base: the Ramp panel is built as the first "Structure" kind (shape, transform, material, optional supports); no elevated-track UI is added this phase.

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** pending
