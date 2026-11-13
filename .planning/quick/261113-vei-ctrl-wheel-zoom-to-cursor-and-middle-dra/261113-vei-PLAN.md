---
phase: quick-261113-vei
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tools/terrain-editor/camera-nav.ts
  - tools/terrain-editor/camera-nav.test.ts
  - tools/terrain-editor/editor.ts
  - tools/map-editor/world.ts
  - tools/map-editor/world.test.ts
  - tools/map-editor/editor.ts
autonomous: true
requirements: [QUICK-261113-vei]

must_haves:
  truths:
    - "Ctrl+wheel (or Meta+wheel) zooms toward the cursor in the terrain editor and the map editor; the browser page does not zoom"
    - "Plain wheel does nothing in either editor (no zoom, no page scroll)"
    - "Alt+wheel still changes brush size in the terrain editor"
    - "Terrain editor: Ctrl+wheel no longer pans the view up/down"
    - "Terrain editor: middle-drag spins (left/right) and tilts (up/down) around the ground point under the cursor at button-down, never below the horizon or flipped"
    - "Shift+middle-drag pans in both editors; in the terrain editor the ground under the cursor follows the mouse"
    - "Right-drag rotate and Shift+right-drag pan (terrain), right/middle-drag pan (map) are unchanged"
    - "Help text in both editors describes the new controls"
  artifacts:
    - path: "tools/terrain-editor/camera-nav.ts"
      provides: "Pure camera maths: zoomTowardPoint, orbitAboutPivot, panByPixels, worldPerPixel"
      exports: ["zoomTowardPoint", "orbitAboutPivot", "panByPixels", "worldPerPixel"]
    - path: "tools/terrain-editor/camera-nav.test.ts"
      provides: "Vitest coverage of the camera maths"
    - path: "tools/map-editor/world.ts"
      provides: "wheelZoomFactor seam: null for plain wheel, zoom factor for Ctrl/Meta wheel"
      exports: ["wheelZoomFactor"]
  key_links:
    - from: "tools/terrain-editor/editor.ts"
      to: "tools/terrain-editor/camera-nav.ts"
      via: "import in wheel + middle-drag handlers"
      pattern: "from \"./camera-nav.ts\""
    - from: "tools/map-editor/editor.ts"
      to: "wheelZoomFactor"
      via: "wheel listener"
      pattern: "wheelZoomFactor\\("
---

<objective>
Rework camera navigation in both editors (user decisions 2026-11-13, numbered 1-9 below as D-1..D-9):
Ctrl+wheel = zoom to cursor in both editors, plain wheel = nothing, terrain middle-drag orbits about the
ground point under the cursor, Shift+middle-drag pans in both editors, help text updated.

Purpose: predictable, cursor-centred navigation that matches common 3D/2D tools.
Output: new pure module tools/terrain-editor/camera-nav.ts (+ tests), a wheelZoomFactor seam in
tools/map-editor/world.ts (+ tests), rewired handlers and help text in both editor.ts files.
No src/ (game runtime) changes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@tools/terrain-editor/editor.ts (lines 83-225 camera/controls/middle-drag/wheel; 749-796 setTopDown + pickTerrain)
@tools/map-editor/editor.ts (lines 122-130 HINTS; 1081-1127 mouse handlers; 1199-1213 wheel)
@tools/map-editor/world.ts (lines 254-267 zoomAt)
@tools/map-editor/world.test.ts (lines 140-156 zoomAt tests, for style)

<interfaces>
Terrain editor, current state (verified):
- line 88-89: const DEFAULT_HINT = "Left-drag to sculpt. Middle-drag (or right-drag) to tilt and spin, Shift+right-drag or Ctrl+wheel to pan, wheel to zoom, Alt+wheel = brush size in cells.";
- line 152: camera = new THREE.PerspectiveCamera(50, 1, 1, 20000)
- lines 155-165: controls = new OrbitControls(camera, canvas); mouseButtons {LEFT:null, MIDDLE:null, RIGHT: ROTATE}; enableDamping=false; maxPolarAngle = PI/2 - 0.02. Comment block at 156-158 describes buttons (mentions "Ctrl + wheel pans the view up/down").
- lines 168-189: middleDrag {id,x,y}; pointerdown (button 1) -> preventDefault + setPointerCapture; pointermove -> Spherical about controls.target: sph.theta -= 2*PI*dx/h; sph.phi = clamp(sph.phi - 2*PI*dy/h, 0.01, controls.maxPolarAngle); camera.lookAt(target); controls.update().
- lines 190-215: capture-phase wheel listener ({capture:true, passive:false}): Alt -> altWheelStep (keep); Ctrl -> up/down pan (REMOVE); otherwise falls through to OrbitControls zoom.
- lines 216-222: endMiddleDrag on pointerup/pointercancel.
- setTopDown (749) places camera up to max(grid.scaleX, grid.scaleZ)*0.9 above target, so max distance must allow several km.
- function pickTerrain(clientX, clientY): TerrainRayHit | null  (line 786; uses module `raycaster`, `ndc`; returns null when no area). TerrainRayHit = { x, y, z, distance }. Function declaration, so hoisted; `raycaster` is initialised before any event fires.

Map editor:
- wheel listener (1199-1213): always preventDefault; unit = deltaMode 1 ? 16 : deltaMode 2 ? canvas.height : 1; factor = Math.exp(-e.deltaY * unit * 0.0015); setView(zoomAt(currentView(), factor, sx, sy, fitScale / 4, MAX_SCALE)).
- mousedown (1084): wantsPan = e.button !== 0, so middle and Shift+middle already pan. Do not change.
- world.ts: export function zoomAt(view, factor, sx, sy, minScale, maxScale): View
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure camera maths (terrain) and wheel seam (map), with tests</name>
  <files>tools/terrain-editor/camera-nav.ts, tools/terrain-editor/camera-nav.test.ts, tools/map-editor/world.ts, tools/map-editor/world.test.ts</files>
  <behavior>
    camera-nav (plain THREE.Vector3 maths, no DOM, inputs never mutated, returns new vectors):
    - zoomTowardPoint(position, target, point, factor, minDist, maxDist) -> { position, target }: factor > 1 zooms in. Scales position and target about `point` by 1/factor (homothety), so view direction is unchanged and `point` stays on the same screen pixel. Effective factor is clamped so the resulting |position - target| stays within [minDist, maxDist]; if already at a limit and asked to go further, returns unchanged copies.
      Tests: (a) direction (target - position) normalised is unchanged; (b) point, position and new position are collinear (point stays on the same view ray through the camera: cross((newPos - point),(pos - point)) ~ 0); (c) factor 2 halves |position - target| and |position - point|; (d) clamping at minDist and maxDist; (e) factor 1 is identity.
    - orbitAboutPivot(position, target, pivot, dTheta, dPhi, minPhi, maxPhi) -> { position, target }: theta/phi use the same convention as THREE.Spherical of (position - target) (phi from +Y). Yaw = rotate both position and target by dTheta about the world Y axis through pivot. Pitch = rotate both about the camera right axis (horizontal, perpendicular to view direction) through pivot by an angle chosen so the new phi of (position - target) equals clamp(phi + dPhi, minPhi, maxPhi). Choose the rotation sign so that test (a) holds.
      Tests: (a) with pivot === target, the result equals the existing Spherical code path (theta += dTheta, phi = clamp(phi + dPhi)) within 1e-6 for a few sample inputs — this pins the senses to the current editor; (b) |position - pivot| and |target - pivot| are preserved; (c) phi never leaves [minPhi, maxPhi] even for huge dPhi (no flip, never below horizon); (d) with pivot off-target, pure yaw keeps position.y and target.y unchanged.
    - worldPerPixel(distance, fovDeg, viewportHeightPx) = 2 * distance * tan(fov/2) / max(1, height). Test one known value.
    - panByPixels(right, up, dx, dy, worldPerPx) -> Vector3 offset to ADD to both camera and target: offset = right * (-dx * wpp) + up * (dy * wpp), so dragging right moves the camera left (scene follows the mouse). Test sign for dx>0 and dy>0.
    world.ts:
    - wheelZoomFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean }, pageHeightPx: number): number | null — returns null when neither ctrlKey nor metaKey; otherwise Math.exp(-deltaY * unit * 0.0015) with unit = deltaMode 1 ? 16 : deltaMode 2 ? pageHeightPx : 1 (exact existing formula moved out of editor.ts).
      Tests: plain wheel -> null; ctrl wheel deltaY -100 -> > 1; meta wheel deltaY 100 -> < 1; deltaMode 1 scales by 16.
  </behavior>
  <action>
    Create tools/terrain-editor/camera-nav.ts exporting the four functions above (import * as THREE from "three"; use Vector3, Quaternion.setFromAxisAngle, Spherical as needed). Short JSDoc on each. For orbitAboutPivot compute the current phi from (position - target) via Spherical, clamp the target phi, use the clamped difference as the pitch angle, and handle the degenerate case where the view is exactly vertical (right axis undefined: derive right from theta, e.g. (cos theta, 0, -sin theta)). Write camera-nav.test.ts first (RED), then implement (GREEN). Per D-9.
    Add wheelZoomFactor to tools/map-editor/world.ts next to zoomAt and tests to world.test.ts in the existing style. Per D-1/D-2/D-9.
    Do not touch editor.ts in this task.
  </action>
  <verify>
    <automated>npx vitest run tools/terrain-editor/camera-nav.test.ts tools/map-editor/world.test.ts</automated>
  </verify>
  <done>All new tests pass; camera-nav.ts has no DOM references; existing world.test.ts tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Wire new navigation into both editors and update help text</name>
  <files>tools/terrain-editor/editor.ts, tools/map-editor/editor.ts</files>
  <action>
    Terrain editor (tools/terrain-editor/editor.ts):
    1. After controls setup set controls.enableZoom = false (D-2), controls.minDistance = 2 and controls.maxDistance = camera.far * 0.5 (10000 m; leaves room for setTopDown). Name them as constants (e.g. NAV_MIN_DIST_M, NAV_MAX_DIST_M) and pass the same values to zoomTowardPoint.
    2. Add a helper pickPivot(clientX, clientY): THREE.Vector3 | null next to pickTerrain: terrain hit from pickTerrain -> Vector3; else intersect raycaster.ray (set by pickTerrain; if pickTerrain returned early because there is no area, call raycaster.setFromCamera yourself) with the horizontal plane y = controls.target.y (THREE.Plane(new Vector3(0,1,0), -controls.target.y), ray.intersectPlane); else null. Per D-1 fallbacks.
    3. Rewrite the capture-phase wheel listener: Alt branch unchanged (D-4). Otherwise always e.preventDefault() and e.stopImmediatePropagation() (D-2). If !(e.ctrlKey || e.metaKey) return (plain wheel does nothing). Delete the old Ctrl up/down pan code entirely (D-3). For Ctrl/Meta: factor via wheelZoomFactor imported from ../map-editor/world.ts (shared deltaMode normalisation, D-1) using canvas.clientHeight; point = pickPivot(...) ?? controls.target.clone(); apply zoomTowardPoint(camera.position, controls.target, point, factor, min, max); copy results into camera.position and controls.target; controls.update().
    4. Middle-drag: extend middleDrag state to { id, x, y, mode: "orbit" | "pan", pivot: THREE.Vector3, panDist: number }. On pointerdown (button 1): mode = e.shiftKey ? "pan" : "orbit" (Shift read at button-down only); pivot = pickPivot(...) ?? controls.target.clone() (D-5 fallback); panDist = camera.position.distanceTo(pivot). On pointermove: orbit -> orbitAboutPivot(camera.position, controls.target, pivot, -(2*PI*dx)/h, -(2*PI*dy)/h, 0.01, controls.maxPolarAngle) (same senses/speeds as today, D-5), copy back, camera.lookAt(controls.target), controls.update(). Pan -> wpp = worldPerPixel(panDist, camera.fov, h); right = column 0 and up = column 1 of camera.matrix (setFromMatrixColumn); offset = panByPixels(right, up, dx, dy, wpp); add to camera.position and controls.target; controls.update() (D-6). Keep endMiddleDrag as is.
    5. Leave RIGHT: ROTATE and OrbitControls Shift+right pan untouched (D-7). Shift/Ctrl+left still go to the tool dispatcher; do not add any left-button pan.
    6. Help text (D-8): DEFAULT_HINT becomes "Left-drag to sculpt. Middle-drag (or right-drag) to tilt and spin, Shift+middle-drag (or Shift+right-drag) to pan, Ctrl+wheel to zoom to the cursor, Alt+wheel = brush size in cells." Rewrite the comment block above controls.mouseButtons to match (middle orbits about the point under the cursor, Shift+middle pans, Ctrl+wheel zooms to cursor, plain wheel does nothing, Alt+wheel brush size). Grep the file for "wheel", "zoom", "pan" in user-visible strings/tooltips and fix any that contradict the new controls.
    Map editor (tools/map-editor/editor.ts):
    7. Wheel listener: keep e.preventDefault() first (plain wheel must not scroll the page, D-2); after the roads check, const factor = wheelZoomFactor(e, canvas.height); if factor === null return; otherwise the existing zoomAt(currentView(), factor, sx, sy, fitScale / 4, MAX_SCALE) path (D-1). Import wheelZoomFactor from ./world.ts.
    8. Do not change mousedown: button !== 0 already pans for middle and Shift+middle (D-6/D-7, no regression).
    9. HINTS.select (line 124): "...Right- or middle-drag pans (Shift+middle too); Ctrl+wheel zooms to the cursor; Ctrl+arrows pan; F fits the world." Grep tools/map-editor and tools/editor-shell for other "wheel"/"zoom" user text and update any that say plain wheel zooms.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run tools/terrain-editor tools/map-editor && npx biome check tools/terrain-editor/camera-nav.ts tools/terrain-editor/camera-nav.test.ts tools/terrain-editor/editor.ts tools/map-editor/world.ts tools/map-editor/world.test.ts tools/map-editor/editor.ts</automated>
  </verify>
  <done>
    Typecheck, tests and biome clean. grep -n "Ctrl+wheel to pan" tools/terrain-editor/editor.ts returns nothing; controls.enableZoom = false is present; terrain editor imports from "./camera-nav.ts"; map editor wheel handler calls wheelZoomFactor.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | Local dev-only editor tools; input is the user's own mouse/wheel events. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vei-01 | Denial of service | zoomTowardPoint / orbitAboutPivot | mitigate | Clamp distance to [NAV_MIN_DIST_M, NAV_MAX_DIST_M] and phi to [0.01, maxPolarAngle] so extreme wheel/drag input cannot produce NaN or a flipped/inside-terrain camera. |
| T-vei-02 | Tampering | editor tools | accept | Dev-only tools, no network or persistence change. |
</threat_model>

<verification>
Automated: see Task 2 verify.

Manual check for the user (npm run dev):
Terrain editor: http://localhost:5173/tools/terrain-editor/index.html?area=popp-roads
1. Plain wheel over the view: nothing moves, page does not scroll.
2. Ctrl+wheel with the cursor on a distant hill: zooms in toward that hill and the hill stays under the cursor; Ctrl+wheel out works; browser page zoom does not change.
3. Alt+wheel: brush ring size changes as before.
4. Middle-drag starting on a feature away from the screen centre: view spins/tilts around that feature; tilting never goes under the ground or flips over the top.
5. Shift+middle-drag: view pans, ground under the cursor follows the mouse.
6. Right-drag still rotates; Shift+right-drag still pans; Shift/Ctrl+left still do their tool actions.
7. Hint bar text describes the new controls.
Map editor: http://localhost:5173/tools/map-editor/index.html
8. Plain wheel: nothing happens. Ctrl+wheel: zooms toward the cursor.
9. Middle-drag, Shift+middle-drag and right-drag all pan.
10. Select tool hint mentions Ctrl+wheel zoom.
</verification>

<success_criteria>
- All nine user decisions implemented (D-1..D-9).
- tsc, vitest (tools/terrain-editor, tools/map-editor) and biome pass on touched files.
- No changes under src/.
</success_criteria>

<output>
Create `.planning/quick/261113-vei-ctrl-wheel-zoom-to-cursor-and-middle-dra/261113-vei-SUMMARY.md` when done
</output>
