---
phase: quick-261116-qok
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - tools/editor-shell/shell.ts
  - tools/terrain-editor/pane-state.ts
  - tools/terrain-editor/pane-state.test.ts
  - tools/terrain-editor/editor.ts
  - .planning/todos/pending/2026-11-16-editor-drive-button-overlaps-camera-pad.md
  - .planning/todos/pending/2026-11-16-editor-pane-header-stale-when-item-selected.md
autonomous: false
requirements: [TODO-2026-11-16-drive-button-overlap, TODO-2026-11-16-pane-header-stale]

must_haves:
  truths:
    - "The Drive button never sits on top of the camera pad, at 1280, 1440 and 1920 px wide"
    - "With a ramp (or any placed item) selected, the left pane header reads the item kind, e.g. 'Ramp'"
    - "With an item selected, the View section (Grid spacing, Contour interval) is hidden"
    - "When the selection clears, or in Brush / Place, the header and View section come back as before"
  artifacts:
    - path: "tools/terrain-editor/pane-state.ts"
      provides: "PaneChoice.headerTitle and PaneChoice.showView"
      contains: "showView"
    - path: "tools/editor-shell/shell.ts"
      provides: "setSidebarViewVisible + camera pad placed below the top bar"
      contains: "setSidebarViewVisible"
  key_links:
    - from: "tools/terrain-editor/editor.ts"
      to: "shell.setSidebarViewVisible"
      via: "applyPaneChrome helper using currentPane()"
      pattern: "setSidebarViewVisible\\(pane\\.showView\\)"
    - from: "tools/editor-shell/shell.ts"
      to: ".shell-viewpad top"
      via: "ResizeObserver on the top bar element"
      pattern: "ResizeObserver"
---

<objective>
Two terrain-editor fixes from the 2026-11-16 todos (both left over from quick 261116-a53):
1. The always-visible "▶ Drive" button overlaps the camera pad at the top right of the canvas.
2. With an item selected, the left pane header still reads "Select / No selection" and the View section still shows.

Output: pane-state fields + tests, a shell method to hide the View section, the camera pad pushed below the top bar, editor wiring, and both todo files removed.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/todos/pending/2026-11-16-editor-drive-button-overlaps-camera-pad.md
@.planning/todos/pending/2026-11-16-editor-pane-header-stale-when-item-selected.md
@.planning/quick/261116-a53-editor-amendments-a-contextual-left-pane/261116-a53-SUMMARY.md
@tools/terrain-editor/pane-state.ts
@tools/terrain-editor/pane-state.test.ts

<interfaces>
Cause of the overlap (shell.css): `.shell-topbar` is `position:absolute; top:36px; right:8px; flex-wrap:wrap`.
`.shell-viewpad` is fixed at `right:8px; top:84px`, which only clears a ONE-row top bar.
At 1440 px the bar wraps to two or more rows, and `.bar-group:has(.drive-btn) { margin-left:auto }`
pushes the Drive group to the right edge, straight onto the pad. The pad does not move with the bar.

tools/editor-shell/shell.ts (createShell):
- Sidebar built as `sidebar.append(title, subtitle, divider, body)`; then, if `options.sidebarView`,
  `sidebar.appendChild(createSection("View", ..., true, options.sidebarView))` — the section element is not kept.
- `setSidebarTitle(t, sub?)` sets title + subtitle (subtitle hidden when undefined).
- `const pad = el("div", "shell-viewpad")`; later `options.root.append(bar.el, pad, info.el)`.
- `export interface Shell { ... setSidebarTitle(title: string, subtitle?: string): void; ... }`
- tools/map-editor/editor.ts also calls createShell (must keep working unchanged).

tools/terrain-editor/pane-state.ts:
- `paneChoice(i: PaneInput): PaneChoice` with panels "place" | "item" | "select" | "brush".
- `PaneChoice { panel; key; showGeneralSelect; showItemPanel; rotatable }`.
- `itemPanelTitle(kind)` returns "Building", "Ramp", "Tree", "Bush", "Hedge", "Fence".

tools/terrain-editor/editor.ts:
- ~line 2610 `function currentPane(): PaneChoice` (uses selectedItemKind()).
- ~line 2590-2599 in refreshSceneryBoxes: `if (paneBuiltKey !== null && paneBuiltKey !== currentPane().key) buildSidebar(); refreshSelectedPanel();`
- ~line 5951 `function syncToolbar()`; near its end (~5985) `shell.setSidebarTitle(st.title, st.subtitle);`
  NOTE: syncToolbar calls refreshSceneryBoxes() BEFORE setSidebarTitle, so anything set in
  refreshSceneryBoxes would be overwritten. The header must be applied through one helper used by both.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pane header and View visibility follow the selection</name>
  <files>tools/terrain-editor/pane-state.ts, tools/terrain-editor/pane-state.test.ts, tools/editor-shell/shell.ts, tools/terrain-editor/editor.ts</files>
  <behavior>
    - paneChoice with selectedItem "ramp" in Select mode: headerTitle === "Ramp", showView === false
    - Every SelectedItemKind in Select mode: headerTitle === itemPanelTitle(kind), showView === false
    - Nothing selected in Select mode: headerTitle === null, showView === true
    - Brush mode with a stale selectedItem: headerTitle === null, showView === true
    - Place armed (even with a selectedItem): headerTitle === null, showView === true
  </behavior>
  <action>
    pane-state.ts: add two fields to PaneChoice and fill them in every branch of paneChoice.
    `headerTitle: string | null` — the pane header to show instead of the toolbar title; itemPanelTitle(selectedItem) for the "item" branch, null otherwise.
    `showView: boolean` — false for the "item" branch, true otherwise. Add short doc comments in the file's existing style. Write the tests from the behavior block first in pane-state.test.ts (extend the existing paneChoice describe; do not rewrite existing tests), see them fail, then implement.

    shell.ts: keep a reference to the View section element when it is created. Add `setSidebarViewVisible(on: boolean): void` to the Shell interface and the returned object; it sets `hidden = !on` on that section (no-op when there is no sidebarView). Map editor needs no change.

    editor.ts: add a module variable holding the last toolbar header (`{ title, subtitle }`, initialised to the shell defaults) and a helper `applyPaneChrome()` that does: `const pane = currentPane();` then `shell.setSidebarTitle(pane.headerTitle ?? last.title, pane.headerTitle ? undefined : last.subtitle)` and `shell.setSidebarViewVisible(pane.showView)`. In syncToolbar, replace the direct `shell.setSidebarTitle(st.title, st.subtitle)` with: store st.title/st.subtitle into that variable, then call applyPaneChrome(). Also call applyPaneChrome() at the end of refreshSceneryBoxes (after refreshSelectedPanel) so selecting or deselecting an item updates the header and View right away even when syncToolbar does not run. Declare the helper/variable where they are initialised before first use (watch for TDZ: refreshSceneryBoxes may run during startup; guard with the `shell` existence pattern already used in that file if needed). Header text: just the kind word, e.g. "Ramp", no subtitle (user prefers plain, short UI text).
  </action>
  <verify>
    <automated>npx vitest run tools/terrain-editor/pane-state.test.ts tools/terrain-editor/toolbar-state.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>New pane-state tests pass; existing tests still pass; tsc clean; editor wires headerTitle and showView through applyPaneChrome from both syncToolbar and refreshSceneryBoxes.</done>
</task>

<task type="auto">
  <name>Task 2: Camera pad sits below the top bar, whatever its height</name>
  <files>tools/editor-shell/shell.ts</files>
  <action>
    Move the camera pad down instead of shrinking the bar (todo option "move the camera pad down"); the Drive group keeps its `margin-left:auto` so it stays at the right end of the bar. In createShell, right after `options.root.append(bar.el, pad, info.el)`, add a small `placePad()` that sets `pad.style.top = \`${bar.el.offsetTop + bar.el.offsetHeight + 8}px\``, call it once, and observe `bar.el` with a ResizeObserver that calls placePad (the bar's height changes when it wraps at narrower windows, and window resizes change its width, which the observer also catches). Guard with `typeof ResizeObserver !== "undefined"` so tests or old environments do not throw. Leave the CSS fallback `top: 84px` in shell.css untouched. Do not change the top bar's flex/wrap rules. Note the map editor shares this shell; its pad simply follows its own bar, which is correct there too.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx biome check tools/editor-shell tools/terrain-editor && npx vitest run tools/editor-shell tools/terrain-editor</automated>
  </verify>
  <done>Pad top is computed from the bar's real bottom edge plus 8 px and updates on resize; tsc, biome and the editor test suites pass.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Short browser check, then remove the todos</name>
  <what-built>Camera pad follows the top bar; pane header names the selected item and View hides while an item is selected.</what-built>
  <how-to-verify>
    Dev server is already running. Open http://localhost:5173/tools/terrain-editor/index.html in Chrome (hard refresh). About one minute:
    1. Resize the window to roughly 1280, 1440 and 1920 px wide (DevTools device toolbar is fine). At each width the "▶ Drive" button sits at the end of the top bar and the camera pad sits fully below the bar, with no overlap.
    2. In Select, click a ramp. The left pane header reads "Ramp" and the View section (Grid spacing, Contour interval) is gone.
    3. Press Esc or click empty ground. Header goes back to "Select / No selection" and View is back.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
  <action>After approval: `git rm` both .planning/todos/pending/2026-11-16-editor-drive-button-overlaps-camera-pad.md and .planning/todos/pending/2026-11-16-editor-pane-header-stale-when-item-selected.md and include the removal in the final commit of this task.</action>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none | Local dev-only editor UI; no new input parsing, network or storage |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qok-01 | Denial of service | ResizeObserver callback in shell.ts | accept | Callback only writes one style value; no layout loop because the pad is not inside the observed bar |
</threat_model>

<verification>
- npx vitest run tools/terrain-editor tools/editor-shell passes
- npx tsc --noEmit clean
- npx biome check tools/editor-shell tools/terrain-editor clean
- Browser check in Task 3 approved
- Both todo files removed from .planning/todos/pending/
</verification>

<success_criteria>
Drive button and camera pad never overlap at 1280/1440/1920; selecting an item shows its kind as the pane header and hides View; deselecting restores both; todos deleted.
</success_criteria>

<output>
Create `.planning/quick/261116-qok-editor-fixes-drive-button-clear-of-camer/261116-qok-SUMMARY.md` when done
</output>
