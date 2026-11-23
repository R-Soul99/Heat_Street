// Editor Route tool (Phase 10, D-09/D-11). Self-contained: state, markers, sidebar and
// load/save of stage drafts. editor.ts hosts it through the narrow RouteToolDeps interface.
// Editor-side code: DOM and three are fine, Rapier never is.

import * as THREE from "three";
import { yawFromTravelDirection } from "../../src/core/heading.ts";
import type { RouteDraft } from "../../src/core/route-draft.ts";
import {
  DEFAULT_GATE_WIDTH_M,
  draftFromStage,
  GATE_WIDTH_MAX_M,
  GATE_WIDTH_MIN_M,
  parseStageData,
  type StageDraft,
  serializeStageData,
} from "../../src/core/stage.ts";
import { terrainGridExtent } from "../../src/core/terrain-drive-setup.ts";
import type { UndoTarget } from "../../src/core/terrain-undo.ts";
import { createStageView, type StageView } from "../../src/render/stage-view.ts";
import { createStepper, el } from "../editor-shell/controls.ts";
import { openDialog } from "../editor-shell/dialog.ts";
import { buildStageTestUrl } from "./drive-url.ts";
import { createDragGesture } from "./place-tool.ts";
import {
  addGate,
  deleteGate,
  deleteLastStageItem,
  deleteStage,
  fallbackGateHeading,
  gateIdSeed,
  moveGateOrder,
  moveStageItem,
  newStage,
  renameStage,
  type StageItemRow,
  setStageFinish,
  setStageItemWidth,
  stageIdSeed,
  stageItemRows,
  stageLengthM,
  stageWarnings,
  turnStageItem,
} from "./stages.ts";
import type { ToolResult } from "./tool-dispatch.ts";

export type RouteSavePlan = { stagesText?: string; routesText?: string };

export interface RouteToolDeps {
  scene: THREE.Scene;
  tagLayer: HTMLElement;
  getArea(): (UndoTarget & { areaId?: string }) | null;
  commitStages(next: readonly StageDraft[]): ToolResult;
  commitRoutes(next: readonly RouteDraft[]): ToolResult;
  applyResult(res: ToolResult): void;
  setStatus(text: string, kind?: "info" | "ok" | "error"): void;
  setInfo(text: string, warnings: readonly string[]): void;
  heightAt(x: number, z: number): number;
  slopeDegAt(x: number, z: number): number;
  slopeLimitDeg(): number;
  api(url: string, init?: RequestInit): Promise<Response>;
  save(): Promise<boolean>;
  openDriveUrl(url: string): void;
  refreshSidebar(): void;
}

export interface RouteTool {
  buildSidebar(f: HTMLElement): void;
  pointerDown(x: number, z: number, button: number): boolean;
  pointerMove(x: number, z: number): void;
  pointerUp(): boolean;
  cancel(): boolean;
  finish(): boolean;
  removeLast(): boolean;
  load(areaId: string): Promise<void>;
  prepareSave(areaId: string): RouteSavePlan | { error: string };
  commitSave(areaId: string, prepared: RouteSavePlan): Promise<string | null>;
  onUndoApplied(): void;
  onTerrainEdited(): void;
  updateTags(camera: THREE.Camera, width: number, height: number): void;
  hasMedalsAtRisk(): boolean;
  dispose(): void;
}

const ACCENT = 0x4aa3ff;
const START_COLOR = 0x66cc99;
const PICK_RADIUS_M = 2.5;
const TURN_PICK_RADIUS_M = 1.6;
const ARROW_LEN_M = 3;
const RING_RADIUS_M = 1.6;
const TAG_LIFT_M = 4;

type ItemRef = string; // "start" | "finish" | gate id

interface Tag {
  el: HTMLElement;
  pos: THREE.Vector3;
}

type Drag = {
  stageId: string;
  ref: ItemRef;
  mode: "move" | "turn";
  moved: boolean;
};

function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const x of mat) x.dispose();
    else if (mat) mat.dispose();
  });
}

function itemOf(
  d: StageDraft,
  ref: ItemRef,
): { x: number; z: number; headingRad: number; widthM?: number } | undefined {
  if (ref === "start") return d.start;
  if (ref === "finish") return d.finish ?? undefined;
  return d.gates.find((g) => g.id === ref);
}

export function createRouteTool(deps: RouteToolDeps): RouteTool {
  const kind: "stage" = "stage";
  let selectedId: string | null = null;
  let selectedRef: ItemRef | null = null;
  let gateWidth = DEFAULT_GATE_WIDTH_M;
  let stageSeed = 1;
  let gateSeeds = new Map<string, number>();
  let newPending = false;
  let stagesFileExisted = false;
  let loadFailed: string | null = null;
  let terrainEdited = false;
  let preview: StageDraft[] | null = null;
  let drag: Drag | null = null;
  let hover: { x: number; z: number } | null = null;
  let syncing = false;

  const gesture = createDragGesture();
  const markers = new THREE.Group();
  markers.name = "route-markers";
  deps.scene.add(markers);
  const views: StageView[] = [];
  const tags: Tag[] = [];
  const ghost = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.6, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  ghost.visible = false;
  ghost.renderOrder = 998;
  deps.scene.add(ghost);
  let gestureLine: THREE.Line | null = null;

  // Sidebar elements (built once; lists are rebuilt on refresh).
  let root: HTMLElement | null = null;
  let routesSelect: HTMLSelectElement | null = null;
  let countLabel: HTMLElement | null = null;
  let listBox: HTMLElement | null = null;
  let emptyBox: HTMLElement | null = null;
  let renameRow: HTMLElement | null = null;
  let testBtn: HTMLButtonElement | null = null;
  let itemControls: HTMLElement | null = null;
  let widthStepper: ReturnType<typeof createStepper> | null = null;
  let turnStepper: ReturnType<typeof createStepper> | null = null;
  let kindWidthStepper: ReturnType<typeof createStepper> | null = null;

  const area = () => deps.getArea();
  const list = (): readonly StageDraft[] => preview ?? area()?.stages ?? [];
  const stage = (): StageDraft | undefined => list().find((s) => s.id === selectedId);

  function reseed(): void {
    const l = area()?.stages ?? [];
    stageSeed = stageIdSeed(l);
    gateSeeds = new Map(l.map((s) => [s.id, gateIdSeed(s)]));
  }

  function commit(next: readonly StageDraft[]): void {
    const res = deps.commitStages(next);
    deps.applyResult(res);
    refreshAll();
  }

  // -------------------------------------------------------------- markers

  function clearMarkers(): void {
    for (const v of views.splice(0)) v.dispose();
    for (const child of [...markers.children]) {
      markers.remove(child);
      disposeObject(child);
    }
    for (const t of tags.splice(0)) t.el.remove();
  }

  function flag(x: number, z: number, y: number, heading: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = heading;
    const mat = new THREE.MeshBasicMaterial({ color: START_COLOR, side: THREE.DoubleSide });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), mat);
    pole.position.y = 1.5;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), mat);
    cloth.rotation.y = Math.PI / 2;
    cloth.position.set(0, 2.65, 0.6);
    g.add(pole, cloth);
    return g;
  }

  function arrow(x: number, z: number, y: number, heading: number, color: number): THREE.Mesh {
    const v = [
      0, 0, -1.5, -0.6, 0, -0.3, 0.6, 0, -0.3, -0.2, 0, -0.3, -0.2, 0, 1.5, 0.2, 0, 1.5, -0.2, 0,
      -0.3, 0.2, 0, 1.5, 0.2, 0, -0.3,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v), 3));
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    m.position.set(x, y + 0.15, z);
    m.rotation.y = heading;
    m.renderOrder = 997;
    return m;
  }

  function widthLine(
    p: { x: number; z: number; headingRad: number },
    widthM: number,
    color: number,
  ): THREE.Line {
    const rx = Math.cos(p.headingRad);
    const rz = -Math.sin(p.headingRad);
    const h = widthM / 2;
    const ax = p.x - rx * h;
    const az = p.z - rz * h;
    const bx = p.x + rx * h;
    const bz = p.z + rz * h;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ax, deps.heightAt(ax, az) + 0.3, az),
      new THREE.Vector3(bx, deps.heightAt(bx, bz) + 0.3, bz),
    ]);
    const l = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
    );
    l.renderOrder = 996;
    l.frustumCulled = false;
    return l;
  }

  function rebuildMarkers(): void {
    clearMarkers();
    const a = area();
    if (!a) return;
    for (const s of list()) {
      const isSel = s.id === selectedId;
      const view = createStageView(markers, deps.heightAt);
      views.push(view);
      if (s.finish !== null && s.gates.length > 0) {
        view.setStage({
          start: s.start,
          gates: s.gates,
          finish: s.finish,
        });
      } else {
        view.setStage(null);
      }
      view.update(null);
      view.setDim(!isSel);

      const pts: { x: number; z: number }[] = [s.start, ...s.gates];
      if (s.finish) pts.push(s.finish);
      const lineColor = isSel ? ACCENT : 0x4aa3ff;
      const vs = pts.map((p) => new THREE.Vector3(p.x, deps.heightAt(p.x, p.z) + 0.6, p.z));
      if (vs.length >= 2) {
        const geo = new THREE.BufferGeometry().setFromPoints(vs);
        const mat = new THREE.LineDashedMaterial({
          color: lineColor,
          dashSize: 3,
          gapSize: 2,
          transparent: true,
          opacity: isSel ? 1 : 0.4,
          depthTest: false,
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.renderOrder = 995;
        line.frustumCulled = false;
        markers.add(line);
      }
      const sy = deps.heightAt(s.start.x, s.start.z);
      const startFlag = flag(s.start.x, s.start.z, sy, s.start.headingRad);
      markers.add(startFlag);
      if (isSel) markers.add(arrow(s.start.x, s.start.z, sy, s.start.headingRad, START_COLOR));
      for (const g of s.gates) {
        if (s.finish === null) markers.add(widthLine(g, g.widthM, 0xffd447));
        if (isSel) {
          markers.add(arrow(g.x, g.z, deps.heightAt(g.x, g.z), g.headingRad, 0xffd447));
        }
      }
      if (isSel && s.finish) {
        markers.add(
          arrow(
            s.finish.x,
            s.finish.z,
            deps.heightAt(s.finish.x, s.finish.z),
            s.finish.headingRad,
            0xf2efe6,
          ),
        );
      }
      if (isSel) {
        const rows = stageItemRows(s);
        for (const r of rows) {
          const it = itemOf(s, r.ref);
          if (!it) continue;
          const y = deps.heightAt(it.x, it.z);
          const tag = el("div", undefined, String(r.number));
          tag.style.cssText =
            "position:absolute;font-size:11px;padding:4px;background:var(--panel,#222);color:#fff;border:1px solid #000;white-space:nowrap;transform:translate(-50%,-100%)";
          deps.tagLayer.appendChild(tag);
          tags.push({ el: tag, pos: new THREE.Vector3(it.x, y + TAG_LIFT_M, it.z) });
        }
        if (selectedRef !== null) {
          const it = itemOf(s, selectedRef);
          if (it) {
            const ringPts: number[] = [];
            for (let i = 0; i < 48; i++) {
              const ang = (i / 48) * Math.PI * 2;
              ringPts.push(
                it.x + Math.cos(ang) * RING_RADIUS_M,
                deps.heightAt(it.x, it.z) + 0.2,
                it.z + Math.sin(ang) * RING_RADIUS_M,
              );
            }
            const rg = new THREE.BufferGeometry();
            rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ringPts), 3));
            const ring = new THREE.LineLoop(
              rg,
              new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true }),
            );
            ring.renderOrder = 998;
            ring.frustumCulled = false;
            markers.add(ring);
          }
        }
      }
    }
  }

  const probe = new THREE.Vector3();
  function updateTags(camera: THREE.Camera, width: number, height: number): void {
    for (const t of tags) {
      probe.copy(t.pos).project(camera);
      const visible = probe.z > -1 && probe.z < 1;
      t.el.style.display = visible ? "block" : "none";
      t.el.style.left = `${((probe.x + 1) / 2) * Math.max(1, width)}px`;
      t.el.style.top = `${((1 - probe.y) / 2) * Math.max(1, height)}px`;
    }
  }

  function setGesturePreview(): void {
    if (gestureLine) {
      deps.scene.remove(gestureLine);
      gestureLine.geometry.dispose();
      (gestureLine.material as THREE.Material).dispose();
      gestureLine = null;
    }
    const p = gesture.preview();
    if (!p) return;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p.from.x, deps.heightAt(p.from.x, p.from.z) + 0.5, p.from.z),
      new THREE.Vector3(p.to.x, deps.heightAt(p.to.x, p.to.z) + 0.5, p.to.z),
    ]);
    gestureLine = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true }),
    );
    gestureLine.renderOrder = 998;
    gestureLine.frustumCulled = false;
    deps.scene.add(gestureLine);
  }

  // ------------------------------------------------------------- geometry

  function inside(x: number, z: number): boolean {
    const a = area();
    if (!a) return false;
    const e = terrainGridExtent(a.grid);
    return x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ;
  }

  function pickItem(
    x: number,
    z: number,
  ): { stageId: string; ref: ItemRef; mode: Drag["mode"] } | null {
    let best: { stageId: string; ref: ItemRef; mode: Drag["mode"] } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    // Arrow tips of the selected stage turn; centres of any stage's items select / move.
    const sel = stage();
    if (sel) {
      for (const r of stageItemRows(sel)) {
        const it = itemOf(sel, r.ref);
        if (!it) continue;
        const tx = it.x - Math.sin(it.headingRad) * ARROW_LEN_M;
        const tz = it.z - Math.cos(it.headingRad) * ARROW_LEN_M;
        const d = Math.hypot(tx - x, tz - z);
        if (d <= TURN_PICK_RADIUS_M && d < bestD) {
          bestD = d;
          best = { stageId: sel.id, ref: r.ref, mode: "turn" };
        }
      }
      if (best) return best;
    }
    for (const s of list()) {
      for (const r of stageItemRows(s)) {
        const it = itemOf(s, r.ref);
        if (!it) continue;
        const d = Math.hypot(it.x - x, it.z - z);
        if (d <= PICK_RADIUS_M && d < bestD) {
          bestD = d;
          best = { stageId: s.id, ref: r.ref, mode: "move" };
        }
      }
    }
    return best;
  }

  function lastItem(s: StageDraft): { x: number; z: number; headingRad: number } {
    return s.gates.length > 0 ? s.gates[s.gates.length - 1] : s.start;
  }

  // -------------------------------------------------------------- gestures

  function pointerDown(x: number, z: number, button: number): boolean {
    if (button !== 0 || !area()) return false;
    const hit = pickItem(x, z);
    if (hit) {
      selectedId = hit.stageId;
      selectedRef = hit.ref;
      drag = { stageId: hit.stageId, ref: hit.ref, mode: hit.mode, moved: false };
      refreshAll();
      return true;
    }
    if (!inside(x, z)) {
      deps.setStatus("Routes must be inside the map area", "error");
      ghost.visible = true;
      (ghost.material as THREE.MeshBasicMaterial).color.set(0xff5555);
      return true;
    }
    gesture.down(x, z);
    setGesturePreview();
    return true;
  }

  function pointerMove(x: number, z: number): void {
    hover = { x, z };
    const ok = inside(x, z);
    ghost.visible = true;
    ghost.position.set(x, deps.heightAt(x, z) + 0.3, z);
    (ghost.material as THREE.MeshBasicMaterial).color.set(ok ? ACCENT : 0xff5555);
    if (drag) {
      const base = area()?.stages ?? [];
      if (drag.mode === "move") {
        if (!inside(x, z)) return;
        preview = moveStageItem(base, drag.stageId, drag.ref, x, z) as StageDraft[];
      } else {
        const s = base.find((q) => q.id === drag?.stageId);
        const it = s ? itemOf(s, drag.ref) : undefined;
        if (!it) return;
        const dx = x - it.x;
        const dz = z - it.z;
        if (Math.hypot(dx, dz) < 0.5) return;
        preview = turnStageItem(
          base,
          drag.stageId,
          drag.ref,
          yawFromTravelDirection(dx, dz),
        ) as StageDraft[];
      }
      drag.moved = true;
      rebuildMarkers();
      return;
    }
    if (gesture.active()) {
      gesture.move(x, z);
      setGesturePreview();
    }
  }

  function placeFromGesture(x: number, z: number, headingRad: number | undefined): void {
    const a = area();
    if (!a) return;
    const base = a.stages ?? [];
    const cur = base.find((s) => s.id === selectedId);
    if (!cur || cur.finish !== null || newPending) {
      const heading = headingRad ?? 0;
      const res = newStage(base, stageSeed, { x, z, headingRad: heading });
      if (res.error !== undefined) {
        deps.setStatus(res.error, "error");
        return;
      }
      stageSeed = res.nextSeed;
      gateSeeds.set(res.id, 1);
      selectedId = res.id;
      selectedRef = "start";
      newPending = false;
      commit(res.list);
      return;
    }
    const prev = lastItem(cur);
    const heading = headingRad ?? fallbackGateHeading({ ...prev }, x, z);
    const seed = gateSeeds.get(cur.id) ?? gateIdSeed(cur);
    const res = addGate(base, cur.id, seed, { x, z, headingRad: heading, widthM: gateWidth });
    if (res.error !== undefined) {
      deps.setStatus(res.error, "error");
      return;
    }
    gateSeeds.set(cur.id, res.nextSeed);
    selectedRef = res.gateId;
    commit(res.list);
  }

  function pointerUp(): boolean {
    if (drag) {
      const d = drag;
      drag = null;
      const next = preview;
      preview = null;
      if (d.moved && next) commit(next);
      else rebuildMarkers();
      return true;
    }
    if (gesture.active()) {
      const r = gesture.up();
      setGesturePreview();
      if (r && inside(r.x, r.z)) placeFromGesture(r.x, r.z, r.headingRad);
      return true;
    }
    return false;
  }

  function cancel(): boolean {
    let did = false;
    if (drag) {
      drag = null;
      preview = null;
      rebuildMarkers();
      did = true;
    }
    if (gesture.active()) {
      gesture.cancel();
      setGesturePreview();
      did = true;
    }
    if (newPending) {
      newPending = false;
      did = true;
    }
    return did;
  }

  function finish(): boolean {
    const a = area();
    const cur = stage();
    if (!a || !cur || cur.finish !== null) return false;
    if (!hover || !inside(hover.x, hover.z)) {
      deps.setStatus("Move the pointer inside the map, then press Enter to finish", "error");
      return true;
    }
    const prev = lastItem(cur);
    const w = cur.gates.length > 0 ? cur.gates[cur.gates.length - 1].widthM : gateWidth;
    const next = setStageFinish(a.stages ?? [], cur.id, {
      x: hover.x,
      z: hover.z,
      headingRad: fallbackGateHeading({ ...prev }, hover.x, hover.z),
      widthM: w,
    });
    selectedRef = "finish";
    commit(next);
    return true;
  }

  function removeLast(): boolean {
    const a = area();
    const cur = stage();
    if (!a || !cur) return false;
    const next = deleteLastStageItem(a.stages ?? [], cur.id);
    if (next.length < (a.stages ?? []).length) {
      selectedId = next[0]?.id ?? null;
    }
    selectedRef = null;
    commit(next);
    return true;
  }

  // --------------------------------------------------------------- sidebar

  function stageName(s: StageDraft): string {
    return `Stage: ${s.name}`;
  }

  function rowButton(
    label: string,
    tip: string,
    onClick: () => void,
    disabled = false,
  ): HTMLButtonElement {
    const b = el("button", "row-btn", label, tip);
    b.type = "button";
    b.setAttribute("aria-label", tip);
    b.disabled = disabled;
    b.style.cssText = "min-width:28px;height:28px;padding:0 4px";
    b.addEventListener("click", onClick);
    return b;
  }

  function selectRef(ref: ItemRef): void {
    selectedRef = ref;
    refreshAll();
  }

  function renderRows(s: StageDraft): void {
    if (!listBox) return;
    listBox.replaceChildren();
    const rows: StageItemRow[] = stageItemRows(s);
    for (const r of rows) {
      const row = el("div", "route-row");
      row.setAttribute("role", "listitem");
      row.style.cssText = `display:flex;gap:4px;align-items:center;height:32px;border-left:2px solid ${r.ref === selectedRef ? "#4aa3ff" : "transparent"}`;
      const num = el("span", undefined, String(r.number));
      num.style.cssText = "width:20px;text-align:center";
      const name = el("button", "row-name", r.label, `Select ${r.label}`);
      name.type = "button";
      name.setAttribute("aria-label", `Select ${r.label}`);
      name.style.cssText =
        "flex:1;text-align:left;background:none;border:0;color:inherit;cursor:pointer";
      name.addEventListener("click", () => selectRef(r.ref));
      row.append(num, name);
      const isGate = r.ref !== "start" && r.ref !== "finish";
      const gi = isGate ? s.gates.findIndex((g) => g.id === r.ref) : -1;
      row.append(
        rowButton(
          "▲",
          `Move ${r.label} earlier`,
          () => {
            const a = area();
            if (a) commit(moveGateOrder(a.stages ?? [], s.id, r.ref, -1));
          },
          !isGate || gi <= 0,
        ),
        rowButton(
          "▼",
          `Move ${r.label} later`,
          () => {
            const a = area();
            if (a) commit(moveGateOrder(a.stages ?? [], s.id, r.ref, 1));
          },
          !isGate || gi >= s.gates.length - 1,
        ),
        rowButton("◎", `Go to ${r.label}`, () => {
          selectRef(r.ref);
        }),
        rowButton(
          "✕",
          `Delete ${r.label}`,
          () => {
            const a = area();
            if (!a) return;
            if (r.ref === "finish") commit(setFinishNull(a.stages ?? [], s.id));
            else if (isGate) commit(deleteGate(a.stages ?? [], s.id, r.ref));
          },
          !isGate && r.ref !== "finish",
        ),
      );
      listBox.appendChild(row);
    }
  }

  function setFinishNull(l: readonly StageDraft[], id: string): StageDraft[] {
    return l.map((s) => (s.id === id ? { ...s, finish: null } : s));
  }

  function refreshPanel(): void {
    if (!root) return;
    const l = list();
    const s = stage();
    if (routesSelect) {
      routesSelect.replaceChildren();
      for (const q of l) {
        const o = document.createElement("option");
        o.value = q.id;
        o.textContent = stageName(q);
        routesSelect.appendChild(o);
      }
      if (s) routesSelect.value = s.id;
    }
    if (countLabel) countLabel.textContent = `Routes (${l.length})`;
    if (emptyBox) emptyBox.style.display = l.length === 0 ? "block" : "none";
    if (listBox) listBox.style.display = s ? "block" : "none";
    if (s) renderRows(s);
    else listBox?.replaceChildren();
    if (itemControls) {
      const it = s && selectedRef ? itemOf(s, selectedRef) : undefined;
      itemControls.style.display = it ? "block" : "none";
      if (it) {
        syncing = true;
        if (selectedRef !== "start" && it.widthM !== undefined) widthStepper?.set(it.widthM);
        turnStepper?.set(Math.round(((((it.headingRad * 180) / Math.PI) % 360) + 360) % 360));
        syncing = false;
        const wrapEl = widthStepper?.el;
        if (wrapEl) wrapEl.style.display = selectedRef === "start" ? "none" : "";
      }
    }
    if (testBtn) {
      const ready = s !== undefined && s.finish !== null && s.gates.length > 0;
      testBtn.disabled = !ready;
      testBtn.dataset.tip = ready
        ? "Test stage: save and drive this stage"
        : "Test stage: place a finish first";
    }
    if (renameRow) renameRow.style.display = "none";
  }

  function refreshInfo(): void {
    const s = stage();
    if (!s) {
      deps.setInfo("", []);
      return;
    }
    deps.setInfo(
      `${s.gates.length} gates, ${Math.round(stageLengthM(s))} m`,
      stageWarnings(s, deps.slopeDegAt, deps.slopeLimitDeg()),
    );
  }

  function refreshAll(): void {
    if (selectedId !== null && !list().some((s) => s.id === selectedId)) {
      selectedId = list()[0]?.id ?? null;
      selectedRef = null;
    }
    rebuildMarkers();
    refreshPanel();
    refreshInfo();
  }

  function buildSidebar(f: HTMLElement): void {
    root = el("div", "route-tool");
    f.appendChild(root);
    const title = el("div", "section-title", "Place");
    const sub = el("div", "section-sub", "Route");
    const hint = el(
      "p",
      "hint",
      "Click and drag to set the start, then add gates. Enter finishes.",
    );
    root.append(title, sub, hint);

    const seg = el("div", "segmented");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "Route kind");
    const kinds: { id: string; label: string; tip: string; enabled: boolean }[] = [
      { id: "stage", label: "Stage", tip: "Stage: gates across open ground", enabled: true },
      {
        id: "p2p",
        label: "Point to point",
        tip: "Point to point: race route along the roads",
        enabled: false,
      },
      {
        id: "circuit",
        label: "Circuit",
        tip: "Circuit: lapped race route along the roads",
        enabled: false,
      },
    ];
    for (const k of kinds) {
      const b = el("button", undefined, k.label, k.tip);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", k.tip);
      b.setAttribute("aria-checked", String(k.id === kind));
      if (!k.enabled) b.setAttribute("aria-disabled", "true");
      seg.appendChild(b);
    }
    root.appendChild(seg);

    kindWidthStepper = createStepper({
      value: gateWidth,
      spec: { step: 2, coarse: 5, min: GATE_WIDTH_MIN_M, max: GATE_WIDTH_MAX_M, decimals: 0 },
      tip: "Gate width in metres",
      unit: "m",
      onChange: (v) => {
        gateWidth = v;
      },
    });
    const wRow = el("div", "row");
    wRow.append(el("span", undefined, "Gate width"), kindWidthStepper.el);
    root.appendChild(wRow);

    const section = document.createElement("details");
    section.className = "section";
    section.open = true;
    const summary = document.createElement("summary");
    countLabel = el("span", undefined, "Routes (0)");
    summary.appendChild(countLabel);
    section.appendChild(summary);

    routesSelect = document.createElement("select");
    routesSelect.dataset.tip = "Choose a route";
    routesSelect.setAttribute("aria-label", "Choose a route");
    routesSelect.addEventListener("change", () => {
      selectedId = routesSelect?.value ?? null;
      selectedRef = null;
      refreshAll();
    });
    section.appendChild(routesSelect);

    const actions = el("div", "row");
    actions.style.cssText = "display:flex;gap:4px";
    const newBtn = el("button", undefined, "New", "New: start a fresh stage on the next drag");
    newBtn.type = "button";
    newBtn.setAttribute("aria-label", "New stage");
    newBtn.addEventListener("click", () => {
      newPending = true;
      deps.setStatus("Drag on the map to place the new stage start", "info");
    });
    const renBtn = el("button", undefined, "Rename", "Rename: change the route name");
    renBtn.type = "button";
    renBtn.setAttribute("aria-label", "Rename route");
    renBtn.addEventListener("click", () => {
      const s = stage();
      if (!s || !renameRow) return;
      renameRow.style.display = "flex";
      const input = renameRow.querySelector("input");
      if (input) {
        input.value = s.name;
        input.focus();
        input.select();
      }
    });
    const delBtn = el("button", undefined, "Delete", "Delete: remove this route");
    delBtn.type = "button";
    delBtn.setAttribute("aria-label", "Delete route");
    delBtn.addEventListener("click", async () => {
      const s = stage();
      const a = area();
      if (!s || !a) return;
      const body = document.createElement("p");
      body.textContent =
        "The route and its gates are removed from this map. Undo brings them back.";
      const choice = await openDialog<"ok" | "no">({
        title: `Delete ${s.name}?`,
        body,
        actions: [
          { id: "ok", label: "Delete route", tip: "Delete this route", primary: true },
          { id: "no", label: "Keep route", tip: "Keep this route" },
        ],
      });
      const ok = choice === "ok";
      if (!ok) return;
      commit(deleteStage(a.stages ?? [], s.id));
    });
    actions.append(newBtn, renBtn, delBtn);
    section.appendChild(actions);

    renameRow = el("div", "row");
    renameRow.style.display = "none";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 60;
    nameInput.dataset.tip = "Route name (Enter to save)";
    nameInput.setAttribute("aria-label", "Route name");
    nameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        if (renameRow) renameRow.style.display = "none";
      } else if (e.key === "Enter") {
        const s = stage();
        const a = area();
        if (s && a) {
          const next = renameStage(a.stages ?? [], s.id, nameInput.value);
          if (next === (a.stages ?? []))
            deps.setStatus("Route names are 1 to 60 characters", "error");
          else commit(next);
        }
        if (renameRow) renameRow.style.display = "none";
      }
    });
    renameRow.appendChild(nameInput);
    section.appendChild(renameRow);

    emptyBox = el(
      "p",
      "hint",
      "No routes. Pick Route from Place (8), then click and drag to set the start.",
    );
    section.appendChild(emptyBox);

    listBox = el("div", "route-list");
    listBox.setAttribute("role", "list");
    listBox.style.cssText = "max-height:240px;overflow-y:auto";
    section.appendChild(listBox);

    itemControls = el("div", "route-item-controls");
    widthStepper = createStepper({
      value: gateWidth,
      spec: { step: 2, coarse: 5, min: GATE_WIDTH_MIN_M, max: GATE_WIDTH_MAX_M, decimals: 0 },
      tip: "Width of the selected item in metres",
      unit: "m",
      onChange: (v) => {
        if (syncing) return;
        const s = stage();
        const a = area();
        if (s && a && selectedRef) commit(setStageItemWidth(a.stages ?? [], s.id, selectedRef, v));
      },
    });
    turnStepper = createStepper({
      value: 0,
      spec: { step: 15, coarse: 3, min: 0, max: 359, decimals: 0, wrap: true },
      tip: "Turn the selected item in degrees",
      unit: "deg",
      onChange: (v) => {
        if (syncing) return;
        const s = stage();
        const a = area();
        if (s && a && selectedRef) {
          commit(turnStageItem(a.stages ?? [], s.id, selectedRef, (v * Math.PI) / 180));
        }
      },
    });
    const wr = el("div", "row");
    wr.append(el("span", undefined, "Width"), widthStepper.el);
    const tr = el("div", "row");
    tr.append(el("span", undefined, "Turn"), turnStepper.el);
    itemControls.append(wr, tr);
    section.appendChild(itemControls);

    testBtn = el("button", "primary", "Test stage", "Test stage: save and drive this stage");
    testBtn.type = "button";
    testBtn.setAttribute("aria-label", "Test stage");
    testBtn.style.width = "100%";
    testBtn.addEventListener("click", async () => {
      const s = stage();
      const a = area();
      if (!s || !a || s.finish === null) return;
      const ok = await deps.save();
      if (!ok) return;
      deps.openDriveUrl(buildStageTestUrl(a.areaId ?? "", s.id));
    });
    section.appendChild(testBtn);
    root.appendChild(section);
    refreshPanel();
  }

  // ------------------------------------------------------------- load/save

  async function load(areaId: string): Promise<void> {
    const a = area();
    if (!a) return;
    loadFailed = null;
    stagesFileExisted = false;
    a.stages = [];
    try {
      const res = await deps.api(`/__terrain/stages/${encodeURIComponent(areaId)}`);
      if (res.status === 404) {
        // no file yet
      } else if (res.ok) {
        stagesFileExisted = true;
        const text = await res.text();
        try {
          const data = parseStageData(text, `${areaId}.stages.json`, terrainGridExtent(a.grid));
          a.stages = data.stages.map(draftFromStage);
        } catch (e) {
          loadFailed = e instanceof Error ? e.message : String(e);
          deps.setStatus(`Could not read the stages file: ${loadFailed}`, "error");
        }
      } else {
        loadFailed = `the server answered ${res.status}`;
        deps.setStatus(`Could not load the stages: ${loadFailed}`, "error");
      }
    } catch (e) {
      loadFailed = e instanceof Error ? e.message : String(e);
      deps.setStatus(`Could not load the stages: ${loadFailed}`, "error");
    }
    terrainEdited = false;
    preview = null;
    selectedId = a.stages[0]?.id ?? null;
    selectedRef = null;
    reseed();
    refreshAll();
  }

  function prepareSave(areaId: string): RouteSavePlan | { error: string } {
    const a = area();
    if (!a) return {};
    const stages = a.stages ?? [];
    if (loadFailed !== null && stages.length === 0) {
      return { error: `The stages file could not be read (${loadFailed}). Fix it before saving.` };
    }
    if (stages.some((s) => s.finish === null || s.gates.length === 0)) {
      return { error: "A route needs a start and a finish" };
    }
    if (stages.length === 0 && !stagesFileExisted) return {};
    const complete = stages.map((s) => ({
      id: s.id,
      name: s.name,
      start: s.start,
      gates: s.gates,
      finish: s.finish as NonNullable<StageDraft["finish"]>,
      ...(s.medals === undefined ? {} : { medals: s.medals }),
    }));
    return {
      stagesText: serializeStageData({ schemaVersion: 1, areaId, stages: complete }),
    };
  }

  async function commitSave(areaId: string, prepared: RouteSavePlan): Promise<string | null> {
    if (prepared.stagesText === undefined) return null;
    try {
      const res = await deps.api(`/__terrain/stages/${encodeURIComponent(areaId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: prepared.stagesText,
      });
      if (!res.ok) {
        const msg = (await res.text().catch(() => "")) || `status ${res.status}`;
        return `Could not save the route: ${msg}. Fix it and save again.`;
      }
      stagesFileExisted = true;
      loadFailed = null;
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Could not save the route: ${msg}. Fix it and save again.`;
    }
  }

  return {
    buildSidebar,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel,
    finish,
    removeLast,
    load,
    prepareSave,
    commitSave,
    onUndoApplied(): void {
      reseed();
      refreshAll();
    },
    onTerrainEdited(): void {
      terrainEdited = true;
      refreshAll();
    },
    updateTags,
    hasMedalsAtRisk(): boolean {
      return terrainEdited && (area()?.stages ?? []).some((s) => s.medals !== undefined);
    },
    dispose(): void {
      clearMarkers();
      deps.scene.remove(markers);
      deps.scene.remove(ghost);
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      if (gestureLine) deps.scene.remove(gestureLine);
      root?.remove();
    },
  };
}
