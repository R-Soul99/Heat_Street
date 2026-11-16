---
quick_id: 261116-a5q
status: complete
completed: 2026-11-16
commits:
  - 9a8de83  # task 1 align ramps
  - 8ff58e0  # task 2 snap to grid
  - 5b683ce  # task 3 contours only
---

# Quick 261116-a5q: Editor amendments B

All three tasks built. No browser was available, so none of the UI has been seen running.

## What changed

1. **Align ramps** (`ramp-align.ts`, pure and tested; wired in `editor.ts`). The selected-ramp panel has an "Align"
   group: Face, Face each other, Match heading, Line up. Press one, the info bar says "Click the ramp to align to
   (Esc cancels)", click the second ramp: one undo step on the selected ramp only (Face each other changes both,
   still one step). While waiting, a thin accent line is drawn along the centre line of the ramp under the cursor.
   All turns go through `updateRamp` and slides through `canPlaceRamp` (the existing guards); a refusal changes
   nothing and the info bar says why. Ramp size never changes.
2. **Snap to grid** (`snap.ts`, pure and tested). "Snap" button plus a 1/2/5/10 m drop-down beside Grid in the top
   bar (and a "Snap to grid" View menu entry). Default off, 5 m. Both remembered in the editor prefs. Snaps: tree and
   bush click placement, building footprint corners, ramp start point, start-point placement and drag, hedge and
   fence points, and dragging any selected item (its anchor lands on the grid). Alt bypasses. Snapping runs before
   the placement guards. Grid + Snap draws the world grid at the snap size around the cursor.
3. **Contours only** (`contour-view.ts`, pure and tested). The Contours control is now three states: off, lines,
   lines only. `C` and the top-bar button cycle; the View menu has "Contours" and "Contours only". In lines-only the
   surface colours and road paint are hidden behind a flat dark ground, contours cover the whole map with every
   fifth line brighter, scenery/ramps/start markers/road centre lines stay, tools keep working. Display only, never
   saved into the map. State remembered in prefs.

## Choices made for you (veto any of these)

- **Align target is the other ramp's start (foot start), not its middle.** Face points the selected ramp's start at
  the other ramp's start. Line up uses the line through the other ramp's start along its heading. Consistent with
  how a ramp's position is stored.
- **Align stays one-shot and ends on refusal.** A refused align (e.g. would reach outside the map) cancels the
  waiting state and says "... Nothing changed." You press the button again to retry. Clicking a non-ramp or the same
  ramp keeps waiting and says so.
- **Align is cancelled if the selection changes** (other item, mode change, delete, undo that removes the ramp).
- **Align buttons are disabled with one ramp on the map** (tooltip says place a second ramp first).
- **Face / Match / Line up refuse no-op results** ("already faces it", "already the same heading", "already on that
  line") instead of making an empty undo step.
- **Ramp headings are stored values**, so the Rotation field number (negative of the stored heading, previous task)
  stays consistent; the status after Face reports the displayed Rotation number.
- **Snap rounding: exactly half-way rounds away from zero** (2.5 -> 5, -2.5 -> -5) so both sides of the origin read
  the same.
- **Scatter (tree/bush brush) is never snapped**; it is a free brush. Only click placement snaps.
- **Ramp direction drag is not snapped** (only the start point is), so heading stays free; rotation from wheel,
  arrows and the Rotation field is unaffected, as asked.
- **Moving snaps the item's anchor**: point/building centre, ramp foot start, first point of a hedge/fence. A drag
  that ends on the item's own grid spot changes nothing and makes no undo step.
- **Snap on turns Grid on; Snap off leaves Grid alone.** Grid is not remembered between sessions (always starts
  off), only Snap and its size are. If Snap was left on in the prefs, you start with Snap on and Grid off.
- **With Snap + Grid on, the grid shown is the snap grid** (world lines at the snap size, 80 m square around the
  cursor, rebuilt every ~4 m of cursor travel), replacing the cell-footprint grid under brushes while Snap is on.
  With Snap off the old cell grid is unchanged. Grid spacing (cells) setting is unused while Snap is on.
- **Contours-only keeps the user's interval** and the existing zoom scaling (coarser when zoomed out), so a large
  map zoomed out shows few lines. Whole-map rebuild after a sculpt is debounced 150 ms.
- **Contours-only implementation**: the original terrain chunk meshes are hidden and a flat dark copy sharing the
  same geometry is drawn (follows sculpting; no change to the game's terrain view). The contour lines use a muted
  orange, index lines pale. WebGL lines are 1 px, so index lines are brighter only, not thicker.
- **Button label** reads "Contours only" while in that state; tooltip changes with state.
- **No hotkey added.** C keeps its key and now cycles.
- **Contours choice persists** across sessions (also the plain lines state, which previously started off).

## Road snapping: not done, and why

The terrain editor has no road node tools. Roads here are painted with the road brush (cells, Brush mode) and
locked/unlocked/deleted per selection; the cursor position enters through the brush, not as point placement. There is
no single clear node placement point to snap, so roads are left unsnapped.

## Does the GAME draw a grid on terrain maps?

Yes. `createVehicleView` in `src/render/vehicle-view.ts` (lines ~446-454) always builds a flat reference grid
(`buildReferenceGrid`, 10 m spacing `GRID_SPACING`, colours `0x50505c` / centre line `0x6a6a78`) at y = 0.01 and
adds it to the scene on every map. `src/main.ts` (~line 663-681) bounds it to the terrain's own extents but
centres it on the world origin. There is no option, URL flag or debug toggle controlling it. On a terrain map it is
a flat plane at y = 0.01, so it only shows where the ground is at or below 0 and is hidden under hills. This is
probably the "grid on all the maps". I did not change the game. If you want it gone, the simplest options are a
`?grid=0` style flag or removing the `scene.add(grid)` for terrain maps; say which.

## Verification

- `npm run check`: typecheck clean; biome 0 errors, 4 warnings (the same pre-existing ones: css specificity in
  `shell.css`, an unused variable in `tools/map-compiler/author/gltf.test.ts`); vitest 2713 passed, 1 failed:
  `tests/demo-hills.test.ts` "respects the max slope over the whole grid (D-03)", the known failure from your
  sculpted cliff. Not touched.
- New tests: `ramp-align.test.ts` (19), `snap.test.ts` (11), `contour-view.test.ts` (7); `rail-tools.test.ts`
  view group updated to include the snap slot.

## Not verified in a browser

Everything visual and interactive: the Align group layout in the selected-ramp panel (it is two rows taller; check
it still fits at 900 px high without a scrollbar); the guide line; the click-to-pick flow and Esc; the Snap button
and drop-down look and placement in the top bar (a `tool-btn` plus a `<select>`); that snapping feels right for
each placement kind and for dragging; the snap grid appearance; the contours-only look (dark ground, line
brightness, z-fighting of lines on the ground, whole-map redraw speed on a big map while sculpting); the
"Contours only" label width.

## Browser check list (about two minutes)

Open `http://localhost:5173/tools/terrain-editor/index.html`, open any area (a flat one such as the feel-test
playground is easiest).

1. Place > Ramp (key 7): drop two ramps pointing different ways, far apart. Esc, then click the first ramp. The left
   pane shows an "Align (then click the other ramp)" group with four buttons.
2. Click "Face", move over the second ramp: a thin blue line runs along its centre line. Click it: the first ramp
   turns to point straight at the second. Ctrl+Z once undoes it. Click the first ramp again, "Face each other",
   click the second: both turn to face each other; one Ctrl+Z undoes both.
3. "Match heading" then click the second ramp: parallel. "Line up" then click: the first ramp slides sideways onto the
   second one's centre line (distance along it unchanged). Pressing Line up again and clicking says "already on that
   line". Press any Align button then Esc: "Align cancelled."
4. Top bar: next to Grid there is a "Snap" button and a "5 m" drop-down. Click Snap: the grid turns on as a world
   grid with lines every 5 m near the cursor. Place a tree (key 3, click): it lands exactly on a grid crossing.
   Hold Alt while clicking: it lands where the cursor is. Switch the size to 1 m and 10 m and check the grid follows.
5. Snap on: drag a selected building/ramp: it jumps from grid point to grid point. Place a building by dragging a
   footprint: both corners land on grid points. Draw a hedge: points land on the grid. Place a ramp: its start
   lands on the grid, direction stays free.
6. Turn Snap off: Grid stays on (cell grid under the cursor again). Reload the page: Snap state and size are
   remembered, Grid is off.
7. Press C: lines (as before, around the cursor). Press C again: "Contours only": surface colours and road paint
   vanish, plain dark ground with contour lines over the whole map, every fifth line brighter; scenery, ramps, start
   markers and road centre lines still visible. Sculpt (raise): the lines follow a moment after you stop. Press C a
   third time: back to off. View menu shows Contours and Contours only entries that match. Reload: the state is
   remembered.

## Self-Check: PASSED

Commits 9a8de83, 8ff58e0, 5b683ce exist on `main`; new files present under `tools/terrain-editor/`:
`ramp-align.ts`, `snap.ts`, `contour-view.ts` (plus tests).
