---
phase: quick-261116-ryu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/crest-geometry.ts
  - tests/crest-geometry.test.ts
  - tools/terrain-editor/features.ts
  - tools/terrain-editor/editor.ts
  - tools/terrain-editor/tool-dispatch.ts
  - tools/terrain-editor/tool-dispatch.test.ts
  - .planning/todos/pending/2026-11-16-roads-do-not-snap.md (git rm)
autonomous: false
requirements: [QUICK-261116-ryu]

must_haves:
  truths:
    - "A ramp's deck is one rigid shape: its top height is the ground height at the foot start (centre line, s=0) plus the ramp profile, the same on left and right, whatever the ground does underneath"
    - "Ramp side skirts and lip face still reach down to the real ground at every column, so there is no gap under the deck"
    - "Round crests still follow the ground exactly as before"
    - "Editor ramp pick box and selection box cover the rigid deck (top = base + heightM), not a ground-following top"
    - "Holding Shift while dragging the road tool, or with the 'Straight' road option on, draws a dead-straight road from the press point to the release point"
    - "The roads-do-not-snap todo is removed in the last code commit"
  artifacts:
    - path: "src/core/crest-geometry.ts"
      provides: "rampBaseY helper + rigid buildRampGeometry"
      contains: "export function rampBaseY"
    - path: "tools/terrain-editor/tool-dispatch.ts"
      provides: "roadStraight option and straight stroke handling"
      contains: "roadStraight"
  key_links:
    - from: "tools/terrain-editor/features.ts (ramp ray pick)"
      to: "src/core/crest-geometry.ts rampBaseY"
      via: "import"
      pattern: "rampBaseY"
    - from: "tools/terrain-editor/editor.ts roadPaint options"
      to: "dispatcher.setOptions({ roadStraight })"
      via: "createToggle"
      pattern: "roadStraight"
---

<objective>
A) Make ramps rigid: deck top = one base height (ground at the foot start on the centre line) + rampProfileHeight(s). Skirts/lip still reach the real ground. Only ramps change; round crests keep following the ground. Keep editor pick/selection boxes consistent.
B) Add straight road drawing to the terrain editor road tool: Shift held during the drag, or a "Straight" toggle in the road options, makes the stroke a 2-point line from press point to current point.
Then git rm the roads-do-not-snap todo in the last code commit.

Purpose: big ramps no longer copy terrain bumps into the deck (user locked decision); straight roads replace the need for road snapping.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

<interfaces>
src/core/crest-geometry.ts:
- `rampLengthM(heightM, ramp): number`, `rampProfileHeight(s, heightM, ramp): number` (0 at s<=0)
- `buildRampGeometry(crest, ramp, heightSampler)` at ~L414-477 (private). Per column i and side, it computes x,z, `g = heightSampler(x,z)`, writes top vertex y = `g + rampProfileHeight(...)` and ground vertex y = `g`. Vertex layout: top L/R per column, then ground L/R per column. Indices: top, left skirt, right skirt per step, plus lip face.
- Round crests: `buildCrestGeometry` radial dome (~L548) uses heightSampler per vertex. DO NOT change.

tools/terrain-editor/features.ts:
- `rampFootprint(crest)` ~L618 -> { cx, cz, hx, hz, rotationY } (ground rectangle; no height). Fine as is.
- Ramp ray pick ~L853-869: `y0 = Math.min(heightAt(centerX,centerZ), heightAt(fp.cx, fp.cz))`, `h = heightM + 0.4`, box cy = y0 + h/2 - 0.2, hy = h/2. Top is y0-relative, so with a rigid deck on ground that dips mid-ramp it undershoots the deck.

tools/terrain-editor/editor.ts:
- Selection box for a ramp ~L2534-2549: for each footprint corner, `grow(wx, wz, 0, o.crest.heightM + 0.5)` — read `grow` (defined just above in the same function) to see whether its y args are relative to the ground at (wx,wz); make the top cover base + heightM.
- `modsOf(e)` ~L4636 passes { shift, ctrl, alt } into dispatcher.pointerDown/pointerMove (L4697, L4705). pointerUp gets no mods.
- Shift on the canvas is only used for MIDDLE-button pan (~L347) and Select-mode left-click guard (~L4790); road tool ignores Shift today, so Shift+left-drag is free in road mode.
- Road options UI: `case "roadPaint"` ~L5631-5676 builds Road class select, Width, Max bank steppers. `createToggle({ label, checked, tip, onChange })` exists in tools/editor-shell/controls.ts (~L211) returning { el, get, set }; import it alongside the other editor-shell controls already imported.

tools/terrain-editor/tool-dispatch.ts:
- `ToolOptions` ~L102-120; defaults object ~L468 (`maxBankDeg: presetDefaults.maxBankDeg`).
- `Modifiers { shift?, ctrl?, alt? }` ~L173.
- Stroke has `start: {x,z}`, `points: {x,z}[]`, `mods` (from pointerDown).
- pointerDown road: `res.previewPoints = [...s.points]` (~L1397).
- pointerMove(x, z, _mods) road branch ~L1408-1411: pushes a point every 0.5 m, preview = all points.
- pointerUp road branch ~L1434-1458: appends end point, then if points.length >= 2 calls `applyRoadStroke(area, s.points, options.roadPreset, { widthM, maxBankDeg, replace: true })`.
- Tests: tools/terrain-editor/tool-dispatch.test.ts `describe("road and erase")` ~L170 uses `setup()`, `d.setTool("road")`, `d.pointerDown/Move/Up`, `area.graph.edges`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rigid ramp deck (geometry + editor pick/selection consistency)</name>
  <files>src/core/crest-geometry.ts, tests/crest-geometry.test.ts, tools/terrain-editor/features.ts, tools/terrain-editor/editor.ts</files>
  <behavior>
    - Bumpy sampler (e.g. (x,z) => Math.sin(x*1.3)*0.4 + z*0.05 + Math.cos(z*2)*0.3): every top vertex y equals rampBaseY + rampProfileHeight(s) (within 1e-5), where rampBaseY = sampler(centerX, centerZ); left and right top vertices of each column have equal y.
    - Same bumpy sampler: every ground vertex y equals sampler(x, z) at that vertex's x,z (skirts reach the real ground).
    - Lip top = base + heightM regardless of ground at the lip.
    - Round crest output with the same bumpy sampler is unchanged (existing rim-seating tests keep passing).
  </behavior>
  <action>
    Per the user's locked decision (rigid ramps; do not reshape terrain — project rule "fix the car/object, not the terrain"):
    1. In src/core/crest-geometry.ts add and export `rampBaseY(crest: AuthoredCrest, heightSampler: (x: number, z: number) => number): number` returning `heightSampler(crest.centerX, crest.centerZ)` with a short doc comment (the ground height at the foot start on the centre line; the whole deck hangs off this one value). In `buildRampGeometry` compute `baseY = rampBaseY(crest, heightSampler)` once and set the top vertex y to `baseY + rampProfileHeight(s, crest.heightM, ramp)`; keep ground vertices at `heightSampler(x, z)`. Indices unchanged. Where ground rises above the deck the terrain simply pokes through — acceptable, do not clamp or reshape. Update the function's/file's doc comments that say the ramp follows the terrain. Leave round crests (`buildCrestGeometry` dome path) untouched.
    2. tests/crest-geometry.test.ts "take-off ramps": replace the "follows the terrain under it" test with tests per the behavior block (vertex index layout: top(i,side)=i*2+side, ground(i,side)=columns*2+i*2+side, columns = steps+1, steps = max(2, ceil(length/0.5))). Keep the flat-sampler wedge test.
    3. tools/terrain-editor/features.ts ramp ray pick (~L853-869): import rampBaseY; bottom = min of heightAt at foot start, footprint centre and lip centre (centerX + cos(heading)*len, same for z; use rampLengthM), top = rampBaseY(o.crest, heightAt) + heightM + 0.2; set cy/hy from bottom-0.2 .. top. Existing features tests that pick ramps must still pass.
    4. tools/terrain-editor/editor.ts ramp selection box (~L2534-2549): read `grow` in that function; make the box top reach base + heightM + 0.5 (base = ground at foot start via the same height sampler the editor uses there) and bottom reach the ground at each corner. If grow already takes absolute y, pass absolute values; if ground-relative, pass offsets that produce that.
    5. Grep once more for any other place that derives ramp top height from terrain (spawn/start-point height, refusal checks in features.ts/scenery-guards.ts, ramp-align.ts, src/render/crest-view.ts, src/physics/terrain-scene.ts, src/physics/map-scene.ts) — those consume buildCrestGeometry output so need no change; only fix any that compute ramp top as ground(x,z) + profile on their own. Note findings in the SUMMARY.
    Commit: `fix(quick-261116-ryu): rigid ramp deck from one base height`.
  </action>
  <verify>
    <automated>npx vitest run tests/crest-geometry.test.ts tools/terrain-editor/features.test.ts tools/terrain-editor/ramp-align.test.ts tests/feel-test-ramps.test.ts tests/playground-map.test.ts</automated>
  </verify>
  <done>New rigid-deck tests pass; round crest tests unchanged and passing; editor ramp pick/selection use base + heightM; tsc clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Straight road drawing (Shift or "Straight" toggle) + drop snap todo</name>
  <files>tools/terrain-editor/tool-dispatch.ts, tools/terrain-editor/tool-dispatch.test.ts, tools/terrain-editor/editor.ts, .planning/todos/pending/2026-11-16-roads-do-not-snap.md</files>
  <behavior>
    - Straight via modifier: pointerDown(-60,0,{}), pointerMove(-20,15,{shift:true}), pointerMove(20,-15,{shift:true}), pointerMove(40,0,{shift:true}) -> last preview is exactly [{-60,0},{40,0}]; pointerUp(60,0) builds a road whose graph edge polyline points all have |z| < 0.5 (straight along z=0).
    - Straight via option: setOptions({ roadStraight: true }), moves with {} mods -> preview always 2 points (start, current); up applies a straight road.
    - Without Shift and option off, behaviour unchanged (existing "road moves only preview" test still passes: preview grows point by point).
    - Straight stroke shorter than 0.5 m from start applies nothing and finishes cleanly (no undo entry).
  </behavior>
  <action>
    Chosen control: Shift held during the road drag (common straight-line convention; Shift+LEFT drag is unused in road mode — Shift pan is middle-button only) PLUS a "Straight" toggle in the road options for mouse-only use.
    1. tool-dispatch.ts: add `roadStraight: boolean` to ToolOptions (doc: "Road tool draws a straight line from press to release.") with default `false` in the defaults object (~L468); make sure setOptions accepts it (check the preset-patch logic ~L943 leaves it alone). Add `straight: boolean` to the Stroke type; in pointerDown set it to `options.roadStraight || !!mods.shift`. In pointerMove road branch: update `s.straight = options.roadStraight || !!mods?.shift` (rename `_mods` to `mods`), keep collecting freehand points as today, and set `res.previewPoints` to `[s.start, {x, z}]` when straight, else all points. Also remember the latest pointer position on the stroke (`s.last = { x, z }`). In pointerUp road branch: when `s.straight`, build the stroke as `[s.start, end]` where end is (x,z) if finite else s.last; only apply if the two points are >= 0.5 m apart; otherwise keep the existing freehand path. Pass to applyRoadStroke exactly as now. The straight state is decided by the last move, so releasing Shift mid-drag returns to the freehand path collected so far.
    2. tool-dispatch.test.ts: add tests in `describe("road and erase")` per the behavior block (read the graph edge type for the polyline field name).
    3. editor.ts `case "roadPaint"`: append `createToggle({ label: "Straight", checked: o.roadStraight, tip: "Draw a straight road from where you press to where you let go. Or hold Shift while dragging.", onChange: (v) => dispatcher.setOptions({ roadStraight: v }) }).el` after the bank field. If the editor has a road-tool hint/PLACE_HINT or tool tooltip text for the road tool, add "Shift = straight" to it in plain short wording.
    4. Final step in this commit: `git rm .planning/todos/pending/2026-11-16-roads-do-not-snap.md` (user: snapping roads not needed now straight drawing exists).
    Commit: `feat(quick-261116-ryu): straight road drawing (Shift or Straight toggle)` including the todo removal.
  </action>
  <verify>
    <automated>npx vitest run tools/terrain-editor/tool-dispatch.test.ts && npx tsc --noEmit && npx biome check src/core/crest-geometry.ts tests/crest-geometry.test.ts tools/terrain-editor/features.ts tools/terrain-editor/editor.ts tools/terrain-editor/tool-dispatch.ts tools/terrain-editor/tool-dispatch.test.ts</automated>
  </verify>
  <done>Straight-road tests pass, existing road tests pass, tsc and biome clean, todo file removed in the commit. (tests/demo-hills.test.ts max-slope failure is pre-existing from uncommitted map edits — ignore.)</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Rigid ramp decks and straight road drawing in the terrain editor.</what-built>
  <how-to-verify>
    Under 2 minutes, dev server already running:
    1. Open http://localhost:5173/tools/terrain-editor/index.html, place a big ramp on bumpy ground, press Drive and drive up it: the deck should be smooth with no copied bumps.
    2. Back in the editor, pick the road tool and hold Shift while dragging (or tick "Straight"): the preview is a straight line and the road comes out straight.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | Local editor tool and pure geometry; no new input sources, network or packages |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ryu-01 | Denial of service | pointerUp straight stroke with NaN end | mitigate | fall back to s.last when end is non-finite; skip apply under 0.5 m |
</threat_model>

<verification>
- npx vitest run tests/crest-geometry.test.ts tools/terrain-editor/features.test.ts tools/terrain-editor/tool-dispatch.test.ts
- npx tsc --noEmit
- npx biome check on touched files
</verification>

<success_criteria>
- Ramp deck top = rampBaseY + profile everywhere, equal left/right; ground vertices on real ground; round crests unchanged
- Editor ramp pick/selection consistent with the rigid deck
- Shift-drag or Straight toggle gives a 2-point straight road
- roads-do-not-snap todo removed in the last code commit
</success_criteria>

<output>
Create `.planning/quick/261116-ryu-rigid-ramps-with-a-flat-deck-from-the-fo/261116-ryu-SUMMARY.md` when done
</output>
