// Editor Route tool (Phase 10, D-09/D-11). Self-contained: state, markers, sidebar and
// load/save of stage drafts. editor.ts hosts it through the narrow RouteToolDeps interface.
// Editor-side code: DOM and three are fine, Rapier never is.

import * as THREE from "three";
import {
  COURSE_SCHEMA_VERSION,
  type Course,
  LAPS_MAX,
  LAPS_MIN,
  parseCourseData,
  serializeCourseData,
} from "../../src/core/course.ts";
import { yawFromTravelDirection } from "../../src/core/heading.ts";
import {
  courseFromRouteDraft,
  distanceToNearestNode,
  ROUTE_OFF_ROAD_WARN_M,
  type RouteDraft,
  routeDraftFromCourse,
} from "../../src/core/route-draft.ts";
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
import { buildRouteTestUrl, buildStageTestUrl } from "./drive-url.ts";
import { createDragGesture } from "./place-tool.ts";
import {
  finishWord,
  itemsStillNeeded,
  itemWord,
  planPartialSave,
  type RouteKind,
  routeMissing,
  routePrompt,
  stackTags,
  stageMissing,
} from "./route-guide.ts";
import {
  addRouteCheckpoint,
  checkpointIdSeed,
  deleteLastRouteItem,
  deleteRoute,
  deleteRouteCheckpoint,
  moveCheckpointOrder,
  moveRouteItem,
  newRoute,
  renameRoute,
  routeIdSeed,
  routeItemRows,
  setRouteFinish,
  setRouteLaps,
  turnRouteStart,
} from "./route-ops.ts";
import {
  addGate,
  autoAimStageItem,
  clearStageFinish,
  deleteGate,
  deleteLastStageItem,
  deleteStage,
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

export type RouteSavePlan = {
  stagesText?: string;
  routesText?: string;
  /** Exactly what the texts hold, remembered as the saved version once written. */
  stages?: readonly StageDraft[];
  routes?: readonly RouteDraft[];
  /** Unfinished items left out of this save (or kept at their last saved version). */
  unfinished: string[];
};

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
  /** allowUnfinished false: an unfinished item refuses the save (Save as reloads the area). */
  prepareSave(areaId: string, allowUnfinished: boolean): RouteSavePlan | { error: string };
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
const TURN_PICK_RADIUS_M = 2.5;
const ARROW_LEN_M = 10;
const RING_RADIUS_M = 1.6;
const TAG_LIFT_M = 4;

type ItemRef = string; // "start" | "finish" | gate id

interface Tag {
  el: HTMLElement;
  pos: THREE.Vector3;
  /** Pixel size, measured once on the first visible frame. */
  size: { w: number; h: number } | null;
}

type Drag = {
  stageId: string;
  ref: ItemRef;
  mode: "move" | "turn";
  moved: boolean;
  isRoute: boolean;
};

/** One selectable thing in the panel: a stage, or a road route shown through a stage-shaped display draft. */
interface Entry {
  id: string;
  isRoute: boolean;
  d: StageDraft;
  route?: RouteDraft;
}

const ROAD_GATE_WIDTH_M = 20;
const NO_ROADS_TIP = "This map has no roads; use Stage";
const WARN_COLOR = "#ffb347";

function yawToward(fx: number, fz: number, tx: number, tz: number): number {
  if (Math.hypot(tx - fx, tz - fz) < 0.01) return 0;
  return yawFromTravelDirection(tx - fx, tz - fz);
}

/** Stage-shaped display of a road route: gates face the next item, width = sensor width. */
function displayOfRoute(r: RouteDraft): StageDraft | null {
  if (r.start === null) return null;
  const items: { id: string; x: number; z: number }[] = [...r.checkpoints];
  if (r.finish) items.push({ id: "finish", x: r.finish.x, z: r.finish.z });
  const heads = items.map((it, i) => {
    const next = items[i + 1];
    if (next) return yawToward(it.x, it.z, next.x, next.z);
    const prev = i > 0 ? items[i - 1] : r.start;
    return prev ? yawToward(prev.x, prev.z, it.x, it.z) : 0;
  });
  const gates = r.checkpoints.map((c, i) => ({
    id: c.id,
    x: c.x,
    z: c.z,
    headingRad: heads[i],
    widthM: ROAD_GATE_WIDTH_M,
  }));
  const finish = r.finish
    ? {
        x: r.finish.x,
        z: r.finish.z,
        headingRad: heads[items.length - 1],
        widthM: ROAD_GATE_WIDTH_M,
      }
    : null;
  return { id: r.id, name: r.name, start: r.start, gates, finish };
}

function routeLengthM(r: RouteDraft): number {
  const pts: { x: number; z: number }[] = [];
  if (r.start) pts.push(r.start);
  pts.push(...r.checkpoints);
  if (r.finish) pts.push(r.finish);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return total;
}

function routeKindLabel(r: RouteDraft): string {
  return r.mode === "circuit" ? "Circuit" : "Point to point";
}

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
  let kind: RouteKind = "stage";
  let routeSeed = 1;
  let routeCpSeeds = new Map<string, number>();
  let routesFileExisted = false;
  let routeLoadFailed: string | null = null;
  let routePreview: RouteDraft[] | null = null;
  let routesSnapshot = "[]";
  let routesChangedSinceLoad = false;
  let medalsFileExists = false;
  let selectedId: string | null = null;
  let selectedRef: ItemRef | null = null;
  let gateWidth = DEFAULT_GATE_WIDTH_M;
  let stageSeed = 1;
  let gateSeeds = new Map<string, number>();
  let newPending = false;
  let finishPending = false;
  let savedStages: readonly StageDraft[] = [];
  let savedRoutes: readonly RouteDraft[] = [];
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
  let widthRow: HTMLElement | null = null;
  let lapsRow: HTMLElement | null = null;
  let lapsStepper: ReturnType<typeof createStepper> | null = null;
  let itemWidthRow: HTMLElement | null = null;
  let itemTurnRow: HTMLElement | null = null;
  let autoBtn: HTMLButtonElement | null = null;
  let newBtn: HTMLButtonElement | null = null;
  let promptEl: HTMLElement | null = null;
  let finishBtn: HTMLButtonElement | null = null;
  const kindButtons = new Map<RouteKind, HTMLButtonElement>();

  const area = () => deps.getArea();
  const list = (): readonly StageDraft[] => preview ?? area()?.stages ?? [];
  const routeList = (): readonly RouteDraft[] => routePreview ?? area()?.routes ?? [];
  const stage = (): StageDraft | undefined => list().find((s) => s.id === selectedId);
  const route = (): RouteDraft | undefined => routeList().find((r) => r.id === selectedId);
  const hasRoads = (): boolean => (area()?.graph.nodes.length ?? 0) > 0;

  function entries(): Entry[] {
    const out: Entry[] = list().map((s) => ({ id: s.id, isRoute: false, d: s }));
    for (const r of routeList()) {
      const d = displayOfRoute(r);
      if (d) out.push({ id: r.id, isRoute: true, d, route: r });
    }
    return out;
  }
  const selected = (): Entry | undefined => entries().find((e) => e.id === selectedId);
  const kindOf = (e: Entry): RouteKind => e.route?.mode ?? "stage";

  /** The route new items go on: the selected one, while it matches Kind and has no finish. */
  function building(): Entry | undefined {
    const e = selected();
    if (!e || newPending || kindOf(e) !== kind || e.d.finish !== null) return undefined;
    return e;
  }

  /** Selecting an existing route makes Kind follow it. */
  function selectRoute(id: string | null, ref: ItemRef | null): void {
    selectedId = id;
    selectedRef = ref;
    newPending = false;
    finishPending = false;
    const e = selected();
    if (e) kind = kindOf(e);
  }

  /** False, with a status, when the route still needs gates or checkpoints before its finish. */
  function canFinish(e: Entry): boolean {
    const need = itemsStillNeeded(kind, e.d.gates.length);
    if (need === 0) return true;
    const word = `${itemWord(kind)}${need === 1 ? "" : "s"}`;
    deps.setStatus(`Add ${need} more ${word} before the ${finishWord(kind)}`, "error");
    return false;
  }

  function reseed(): void {
    const l = area()?.stages ?? [];
    stageSeed = stageIdSeed(l);
    gateSeeds = new Map(l.map((s) => [s.id, gateIdSeed(s)]));
    const rl = area()?.routes ?? [];
    routeSeed = routeIdSeed(rl);
    routeCpSeeds = new Map(rl.map((r) => [r.id, checkpointIdSeed(r)]));
  }

  function commit(next: readonly StageDraft[]): void {
    const res = deps.commitStages(next);
    deps.applyResult(res);
    refreshAll();
  }

  function commitRouteList(next: readonly RouteDraft[]): void {
    const res = deps.commitRoutes(next);
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
    // Tail at the item, tip ARROW_LEN_M ahead (where pickItem looks for the turn handle).
    const tip = -ARROW_LEN_M;
    const neck = tip + 3.5;
    const v = [
      0,
      0,
      tip,
      -2,
      0,
      neck,
      2,
      0,
      neck,
      -0.6,
      0,
      neck,
      -0.6,
      0,
      0,
      0.6,
      0,
      0,
      -0.6,
      0,
      neck,
      0.6,
      0,
      0,
      0.6,
      0,
      neck,
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

  function isOffRoad(ref: ItemRef, d: StageDraft): boolean {
    const a = area();
    const it = itemOf(d, ref);
    if (!a || !it) return false;
    return distanceToNearestNode(a.graph, it.x, it.z) > ROUTE_OFF_ROAD_WARN_M;
  }

  function rebuildMarkers(): void {
    clearMarkers();
    const a = area();
    if (!a) return;
    for (const entry of entries()) {
      const s = entry.d;
      const isRoute = entry.isRoute;
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
        if (isSel && !isRoute) {
          markers.add(arrow(g.x, g.z, deps.heightAt(g.x, g.z), g.headingRad, 0xffd447));
        }
      }
      if (isSel && s.finish && !isRoute) {
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
        const rows = entry.route ? routeItemRows(entry.route) : stageItemRows(s);
        for (const r of rows) {
          const it = itemOf(s, r.ref);
          if (!it) continue;
          const y = deps.heightAt(it.x, it.z);
          const tag = el("div", undefined, r.label);
          tag.style.cssText =
            "position:absolute;font-size:11px;padding:4px;background:var(--panel,#222);color:#fff;border:1px solid #000;white-space:nowrap;transform:translate(-50%,-100%)";
          deps.tagLayer.appendChild(tag);
          tags.push({ el: tag, pos: new THREE.Vector3(it.x, y + TAG_LIFT_M, it.z), size: null });
        }
        if (isRoute) {
          for (const r of rows) {
            if (r.ref === "start" || !isOffRoad(r.ref, s)) continue;
            const it = itemOf(s, r.ref);
            if (!it) continue;
            const tag = el("div", undefined, "off road");
            tag.style.cssText = `position:absolute;font-size:11px;padding:4px;background:var(--panel,#222);color:${WARN_COLOR};border:1px solid ${WARN_COLOR};white-space:nowrap;transform:translate(-50%,-100%)`;
            deps.tagLayer.appendChild(tag);
            tags.push({
              el: tag,
              pos: new THREE.Vector3(it.x, deps.heightAt(it.x, it.z) + TAG_LIFT_M + 3, it.z),
              size: null,
            });
          }
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
    const shown: Tag[] = [];
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    for (const t of tags) {
      probe.copy(t.pos).project(camera);
      const visible = probe.z > -1 && probe.z < 1;
      t.el.style.display = visible ? "block" : "none";
      if (!visible) continue;
      if (t.size === null) t.size = { w: t.el.offsetWidth, h: t.el.offsetHeight };
      shown.push(t);
      boxes.push({
        x: ((probe.x + 1) / 2) * Math.max(1, width),
        y: ((1 - probe.y) / 2) * Math.max(1, height),
        ...t.size,
      });
    }
    const ys = stackTags(boxes);
    shown.forEach((t, i) => {
      t.el.style.left = `${boxes[i].x}px`;
      t.el.style.top = `${ys[i]}px`;
    });
  }

  function setGesturePreview(): void {
    if (gestureLine) {
      deps.scene.remove(gestureLine);
      gestureLine.geometry.dispose();
      (gestureLine.material as THREE.Material).dispose();
      gestureLine = null;
    }
    // Only a start takes its direction from the drag.
    const p = building() ? undefined : gesture.preview();
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
  ): { stageId: string; ref: ItemRef; mode: Drag["mode"]; isRoute: boolean } | null {
    let best: { stageId: string; ref: ItemRef; mode: Drag["mode"]; isRoute: boolean } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    const all = entries();
    // Arrow tips of the selected item turn (road routes: the start only); centres of any item select / move.
    const sel = all.find((e) => e.id === selectedId);
    if (sel) {
      for (const r of rowsOf(sel)) {
        if (sel.isRoute && r.ref !== "start") continue;
        const it = itemOf(sel.d, r.ref);
        if (!it) continue;
        const tx = it.x - Math.sin(it.headingRad) * ARROW_LEN_M;
        const tz = it.z - Math.cos(it.headingRad) * ARROW_LEN_M;
        const d = Math.hypot(tx - x, tz - z);
        if (d <= TURN_PICK_RADIUS_M && d < bestD) {
          bestD = d;
          best = { stageId: sel.id, ref: r.ref, mode: "turn", isRoute: sel.isRoute };
        }
      }
      if (best) return best;
    }
    for (const e of all) {
      for (const r of rowsOf(e)) {
        const it = itemOf(e.d, r.ref);
        if (!it) continue;
        const d = Math.hypot(it.x - x, it.z - z);
        if (d <= PICK_RADIUS_M && d < bestD) {
          bestD = d;
          best = { stageId: e.id, ref: r.ref, mode: "move", isRoute: e.isRoute };
        }
      }
    }
    return best;
  }

  function rowsOf(e: Entry): { ref: string; label: string; number: number }[] {
    return e.route ? routeItemRows(e.route) : stageItemRows(e.d);
  }

  // -------------------------------------------------------------- gestures

  function pointerDown(x: number, z: number, button: number): boolean {
    if (button !== 0 || !area()) return false;
    // Placing the finish ignores markers, so it can go right beside the start.
    const hit = finishPending && building() ? null : pickItem(x, z);
    if (hit) {
      selectRoute(hit.stageId, hit.ref);
      drag = {
        stageId: hit.stageId,
        ref: hit.ref,
        mode: hit.mode,
        moved: false,
        isRoute: hit.isRoute,
      };
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
    if (drag?.isRoute) {
      const rbase = area()?.routes ?? [];
      if (drag.mode === "move") {
        if (!inside(x, z)) return;
        routePreview = moveRouteItem(rbase, drag.stageId, drag.ref, x, z) as RouteDraft[];
      } else {
        const start = rbase.find((q) => q.id === drag?.stageId)?.start;
        if (!start) return;
        const dx = x - start.x;
        const dz = z - start.z;
        if (Math.hypot(dx, dz) < 0.5) return;
        routePreview = turnRouteStart(
          rbase,
          drag.stageId,
          yawFromTravelDirection(dx, dz),
        ) as RouteDraft[];
      }
      drag.moved = true;
      rebuildMarkers();
      return;
    }
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
    const target = building();
    if (target && finishPending) {
      placeFinish(target, x, z);
      return;
    }
    finishPending = false;
    const curRoute = target?.route;
    const curStage = target && !target.isRoute ? target.d : undefined;
    if (!target) {
      const heading = headingRad ?? 0;
      if (kind !== "stage") {
        if (!hasRoads()) {
          deps.setStatus(NO_ROADS_TIP, "error");
          return;
        }
        const rl = a.routes ?? [];
        const res = newRoute(rl, routeSeed, a.areaId ?? "", kind, { x, z, headingRad: heading });
        if (res.error !== undefined) {
          deps.setStatus(res.error, "error");
          return;
        }
        routeSeed = res.nextSeed;
        routeCpSeeds.set(res.id, 1);
        selectedId = res.id;
        selectedRef = "start";
        newPending = false;
        commitRouteList(res.list);
        return;
      }
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
    if (curRoute) {
      const seed = routeCpSeeds.get(curRoute.id) ?? checkpointIdSeed(curRoute);
      const res = addRouteCheckpoint(a.routes ?? [], curRoute.id, seed, x, z);
      if (res.error !== undefined) {
        deps.setStatus(res.error, "error");
        return;
      }
      routeCpSeeds.set(curRoute.id, res.nextSeed);
      selectedRef = res.checkpointId;
      commitRouteList(res.list);
      return;
    }
    if (!curStage) return;
    const cur = curStage;
    const seed = gateSeeds.get(cur.id) ?? gateIdSeed(cur);
    const res = addGate(base, cur.id, seed, { x, z, widthM: gateWidth });
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
      const rnext = routePreview;
      preview = null;
      routePreview = null;
      if (d.moved && d.isRoute && rnext) commitRouteList(rnext);
      else if (d.moved && next) commit(next);
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
      routePreview = null;
      rebuildMarkers();
      did = true;
    }
    if (gesture.active()) {
      gesture.cancel();
      setGesturePreview();
      did = true;
    }
    if (newPending || finishPending) {
      newPending = false;
      finishPending = false;
      refreshPanel();
      did = true;
    }
    return did;
  }

  function placeFinish(e: Entry, x: number, z: number): void {
    const a = area();
    if (!a || !canFinish(e)) return;
    finishPending = false;
    selectedRef = "finish";
    if (e.route) {
      commitRouteList(setRouteFinish(a.routes ?? [], e.id, x, z));
      return;
    }
    commit(
      setStageFinish(a.stages ?? [], e.id, {
        x,
        z,
        widthM: e.d.gates.length > 0 ? e.d.gates[e.d.gates.length - 1].widthM : gateWidth,
      }),
    );
  }

  function finish(): boolean {
    const e = building();
    if (!e) return false;
    if (!canFinish(e)) return true;
    if (!hover || !inside(hover.x, hover.z)) {
      deps.setStatus("Move the pointer inside the map, then press Enter to finish", "error");
      return true;
    }
    placeFinish(e, hover.x, hover.z);
    return true;
  }

  function removeLast(): boolean {
    const a = area();
    const curR = route();
    if (a && curR) {
      const rnext = deleteLastRouteItem(a.routes ?? [], curR.id);
      if (rnext.length < (a.routes ?? []).length) {
        selectedId = a.stages?.[0]?.id ?? rnext[0]?.id ?? null;
      }
      selectedRef = null;
      commitRouteList(rnext);
      return true;
    }
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

  function renderRows(entry: Entry): void {
    if (!listBox) return;
    listBox.replaceChildren();
    const s = entry.d;
    const rows: StageItemRow[] = rowsOf(entry);
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
            if (!a) return;
            if (entry.isRoute)
              commitRouteList(moveCheckpointOrder(a.routes ?? [], s.id, r.ref, -1));
            else commit(moveGateOrder(a.stages ?? [], s.id, r.ref, -1));
          },
          !isGate || gi <= 0,
        ),
        rowButton(
          "▼",
          `Move ${r.label} later`,
          () => {
            const a = area();
            if (!a) return;
            if (entry.isRoute) commitRouteList(moveCheckpointOrder(a.routes ?? [], s.id, r.ref, 1));
            else commit(moveGateOrder(a.stages ?? [], s.id, r.ref, 1));
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
            if (entry.isRoute) {
              if (r.ref === "finish") {
                commitRouteList(
                  (a.routes ?? []).map((q) => (q.id === s.id ? { ...q, finish: null } : q)),
                );
              } else if (isGate)
                commitRouteList(deleteRouteCheckpoint(a.routes ?? [], s.id, r.ref));
              return;
            }
            if (r.ref === "finish") commit(clearStageFinish(a.stages ?? [], s.id));
            else if (isGate) commit(deleteGate(a.stages ?? [], s.id, r.ref));
          },
          !isGate && r.ref !== "finish",
        ),
      );
      listBox.appendChild(row);
    }
  }

  function refreshPanel(): void {
    if (!root) return;
    const all = entries();
    const sel = all.find((e) => e.id === selectedId);
    const s = sel?.d;
    const roads = hasRoads();
    for (const [k, b] of kindButtons) {
      b.setAttribute("aria-checked", String(k === kind));
      if (k === "stage") continue;
      if (roads) b.removeAttribute("aria-disabled");
      else b.setAttribute("aria-disabled", "true");
      b.dataset.tip = roads
        ? k === "p2p"
          ? "Point to point: race route along the roads"
          : "Circuit: lapped race route along the roads"
        : NO_ROADS_TIP;
    }
    if (widthRow) widthRow.style.display = kind === "stage" ? "" : "none";
    if (newBtn) {
      newBtn.dataset.tip = `New: start a fresh ${kind === "stage" ? "stage" : "route"} on the next drag`;
    }
    if (routesSelect) {
      routesSelect.replaceChildren();
      for (const e of all) {
        const o = document.createElement("option");
        o.value = e.id;
        o.textContent = e.route ? `${routeKindLabel(e.route)}: ${e.d.name}` : stageName(e.d);
        routesSelect.appendChild(o);
      }
      if (s) routesSelect.value = s.id;
    }
    const b = building();
    const matching = sel && kindOf(sel) === kind ? sel : undefined;
    if (finishPending && !b) finishPending = false;
    if (promptEl) {
      promptEl.textContent = routePrompt({
        kind,
        current: matching
          ? {
              name: matching.d.name,
              items: matching.d.gates.length,
              hasFinish: matching.d.finish !== null,
            }
          : null,
        newPending,
        finishPending,
      });
    }
    if (finishBtn) {
      const fin = finishWord(kind);
      const ready = b !== undefined && itemsStillNeeded(kind, b.d.gates.length) === 0;
      finishBtn.textContent = `Place ${fin}`;
      finishBtn.setAttribute("aria-label", `Place ${fin}`);
      finishBtn.setAttribute("aria-pressed", String(finishPending));
      finishBtn.disabled = !ready;
      finishBtn.dataset.tip = ready
        ? `Place ${fin}: then click on the map (or press Enter at the pointer)`
        : `Place ${fin}: needs an unfinished route with enough ${itemWord(kind)}s`;
    }
    if (countLabel) countLabel.textContent = `Routes (${all.length})`;
    if (emptyBox) emptyBox.style.display = all.length === 0 ? "block" : "none";
    if (listBox) listBox.style.display = s ? "block" : "none";
    if (sel) renderRows(sel);
    else listBox?.replaceChildren();
    if (lapsRow) {
      const circuit = sel?.route?.mode === "circuit";
      lapsRow.style.display = circuit ? "" : "none";
      if (circuit && sel?.route) {
        syncing = true;
        lapsStepper?.set(sel.route.laps);
        syncing = false;
      }
    }
    if (itemControls) {
      const it = s && selectedRef ? itemOf(s, selectedRef) : undefined;
      itemControls.style.display = it ? "block" : "none";
      if (it) {
        syncing = true;
        if (selectedRef !== "start" && it.widthM !== undefined) widthStepper?.set(it.widthM);
        turnStepper?.set(Math.round(((((it.headingRad * 180) / Math.PI) % 360) + 360) % 360));
        syncing = false;
        if (itemWidthRow) {
          itemWidthRow.style.display = selectedRef === "start" || sel?.isRoute ? "none" : "";
        }
        if (itemTurnRow) {
          itemTurnRow.style.display = sel?.isRoute && selectedRef !== "start" ? "none" : "";
        }
        if (autoBtn) {
          const manual = "headingManual" in it && it.headingManual === true;
          autoBtn.style.display = sel?.isRoute || selectedRef === "start" ? "none" : "";
          autoBtn.disabled = !manual;
          autoBtn.dataset.tip = manual
            ? "Auto: turn this to follow the route again"
            : "Auto: already following the route";
        }
      }
    }
    if (testBtn) {
      const ready = s !== undefined && s.finish !== null && s.gates.length > 0;
      const word = sel?.isRoute ? "route" : "stage";
      testBtn.textContent = sel?.isRoute ? "Test route" : "Test stage";
      testBtn.setAttribute("aria-label", sel?.isRoute ? "Test route" : "Test stage");
      testBtn.disabled = !ready;
      testBtn.dataset.tip = ready
        ? `Test ${word}: save and drive this ${word}`
        : `Test ${word}: place a finish first`;
    }
    if (renameRow) renameRow.style.display = "none";
  }

  function refreshInfo(): void {
    const sel = selected();
    if (!sel) {
      deps.setInfo("", []);
      return;
    }
    if (sel.route) {
      const r = sel.route;
      const count = r.checkpoints.length + (r.finish ? 1 : 0);
      const warns: string[] = [];
      const a = area();
      if (a) {
        const pts = [...r.checkpoints, ...(r.finish ? [r.finish] : [])];
        pts.forEach((p, i) => {
          if (distanceToNearestNode(a.graph, p.x, p.z) > ROUTE_OFF_ROAD_WARN_M) {
            warns.push(`Checkpoint ${i + 1} is off road`);
          }
        });
      }
      deps.setInfo(`${count} checkpoints, ${Math.round(routeLengthM(r))} m`, warns);
      return;
    }
    const s = sel.d;
    deps.setInfo(
      `${s.gates.length} gates, ${Math.round(stageLengthM(s))} m`,
      stageWarnings(s, deps.slopeDegAt, deps.slopeLimitDeg()),
    );
  }

  function refreshAll(): void {
    if (selectedId !== null && !entries().some((e) => e.id === selectedId)) {
      selectedId = entries()[0]?.id ?? null;
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
    promptEl = el("p", "hint", "");
    promptEl.setAttribute("aria-live", "polite");
    promptEl.style.cssText = "color:#e8e8e8;border-left:2px solid #4aa3ff;padding-left:8px";
    root.append(title, sub, promptEl);

    const seg = el("div", "segmented");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "Route kind");
    const kinds: { id: RouteKind; label: string; tip: string }[] = [
      { id: "stage", label: "Stage", tip: "Stage: gates across open ground" },
      { id: "p2p", label: "Point to point", tip: "Point to point: race route along the roads" },
      { id: "circuit", label: "Circuit", tip: "Circuit: lapped race route along the roads" },
    ];
    for (const k of kinds) {
      const b = el("button", undefined, k.label, k.tip);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", k.tip);
      b.setAttribute("aria-checked", String(k.id === kind));
      b.addEventListener("click", () => {
        if (k.id !== "stage" && !hasRoads()) {
          deps.setStatus(NO_ROADS_TIP, "info");
          return;
        }
        kind = k.id;
        newPending = false;
        finishPending = false;
        refreshPanel();
      });
      kindButtons.set(k.id, b);
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
    widthRow = wRow;
    root.appendChild(wRow);

    const placeBtn = el("button", undefined, "Place finish");
    finishBtn = placeBtn;
    placeBtn.type = "button";
    placeBtn.style.width = "100%";
    placeBtn.addEventListener("click", () => {
      const e = building();
      if (!e || !canFinish(e)) return;
      finishPending = !finishPending;
      refreshPanel();
    });
    root.appendChild(placeBtn);

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
      selectRoute(routesSelect?.value ?? null, null);
      refreshAll();
    });
    section.appendChild(routesSelect);

    const actions = el("div", "row");
    actions.style.cssText = "display:flex;gap:4px";
    const nb = el("button", undefined, "New", "New: start a fresh stage on the next drag");
    newBtn = nb;
    nb.type = "button";
    nb.setAttribute("aria-label", "New route");
    nb.addEventListener("click", () => {
      newPending = true;
      finishPending = false;
      refreshPanel();
      deps.setStatus(
        kind === "stage"
          ? "Drag on the map to place the new stage start"
          : "Drag on the map to place the new route start",
        "info",
      );
    });
    const renBtn = el("button", undefined, "Rename", "Rename: change the route name");
    renBtn.type = "button";
    renBtn.setAttribute("aria-label", "Rename route");
    renBtn.addEventListener("click", () => {
      const s = selected()?.d;
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
      const sel = selected();
      const s = sel?.d;
      const a = area();
      if (!sel || !s || !a) return;
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
      if (sel.isRoute) commitRouteList(deleteRoute(a.routes ?? [], s.id));
      else commit(deleteStage(a.stages ?? [], s.id));
    });
    actions.append(nb, renBtn, delBtn);
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
        const sel = selected();
        const a = area();
        if (sel && a) {
          if (sel.isRoute) {
            const rnext = renameRoute(a.routes ?? [], sel.id, nameInput.value);
            if (rnext === (a.routes ?? []))
              deps.setStatus("Route names are 1 to 60 characters", "error");
            else commitRouteList(rnext);
          } else {
            const next = renameStage(a.stages ?? [], sel.id, nameInput.value);
            if (next === (a.stages ?? []))
              deps.setStatus("Route names are 1 to 60 characters", "error");
            else commit(next);
          }
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
        // Road routes have no width control: sensors are axis-aligned (race logic).
      },
    });
    turnStepper = createStepper({
      value: 0,
      spec: { step: 15, coarse: 3, min: 0, max: 359, decimals: 0, wrap: true },
      tip: "Turn the selected item in degrees",
      unit: "deg",
      onChange: (v) => {
        if (syncing) return;
        const sel = selected();
        const a = area();
        if (sel && a && selectedRef) {
          const rad = (v * Math.PI) / 180;
          if (sel.isRoute) {
            if (selectedRef === "start")
              commitRouteList(turnRouteStart(a.routes ?? [], sel.id, rad));
          } else commit(turnStageItem(a.stages ?? [], sel.id, selectedRef, rad));
        }
      },
    });
    const wr = el("div", "row");
    wr.append(el("span", undefined, "Width"), widthStepper.el);
    const tr = el("div", "row");
    const auto = el("button", undefined, "Auto");
    autoBtn = auto;
    auto.type = "button";
    auto.setAttribute("aria-label", "Auto: turn this to follow the route");
    auto.addEventListener("click", () => {
      const sel = selected();
      const a = area();
      if (!sel || sel.isRoute || !a || !selectedRef) return;
      commit(autoAimStageItem(a.stages ?? [], sel.id, selectedRef));
    });
    tr.append(el("span", undefined, "Turn"), turnStepper.el, auto);
    itemWidthRow = wr;
    itemTurnRow = tr;
    itemControls.append(wr, tr);
    section.appendChild(itemControls);

    lapsStepper = createStepper({
      value: 3,
      spec: { step: 1, coarse: 5, min: LAPS_MIN, max: LAPS_MAX, decimals: 0 },
      tip: "Laps",
      onChange: (v) => {
        if (syncing) return;
        const r = route();
        const a = area();
        if (r && a) commitRouteList(setRouteLaps(a.routes ?? [], r.id, v));
      },
    });
    lapsRow = el("div", "row");
    lapsRow.append(el("span", undefined, "Laps"), lapsStepper.el);
    lapsRow.style.display = "none";
    section.appendChild(lapsRow);

    testBtn = el("button", "primary", "Test stage", "Test stage: save and drive this stage");
    testBtn.type = "button";
    testBtn.setAttribute("aria-label", "Test stage");
    testBtn.style.width = "100%";
    testBtn.addEventListener("click", async () => {
      const sel = selected();
      const a = area();
      if (!sel || !a || sel.d.finish === null) return;
      const ok = await deps.save();
      if (!ok) return;
      if (sel.route) {
        deps.openDriveUrl(buildRouteTestUrl(a.areaId ?? "", sel.route.mode, sel.id));
      } else {
        deps.openDriveUrl(buildStageTestUrl(a.areaId ?? "", sel.id));
      }
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
      // The editor's api() helper throws on non-2xx, so an absent file arrives here as "no stages file".
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "no stages file" && msg !== "404") {
        loadFailed = msg;
        deps.setStatus(`Could not load the stages: ${loadFailed}`, "error");
      }
    }
    await loadRoutes(areaId, a);
    terrainEdited = false;
    preview = null;
    routePreview = null;
    kind = "stage";
    selectRoute(a.stages[0]?.id ?? a.routes?.[0]?.id ?? null, null);
    savedStages = a.stages;
    savedRoutes = a.routes ?? [];
    reseed();
    refreshAll();
  }

  async function loadRoutes(
    areaId: string,
    a: NonNullable<ReturnType<typeof area>>,
  ): Promise<void> {
    routeLoadFailed = null;
    routesFileExisted = false;
    medalsFileExists = false;
    a.routes = [];
    try {
      const res = await deps.api(`/__terrain/routes/${encodeURIComponent(areaId)}`);
      if (res.status === 404) {
        // no routes file yet
      } else if (res.ok) {
        routesFileExisted = true;
        const text = await res.text();
        try {
          const data = parseCourseData(text, `${areaId}.routes.json`, a.graph);
          a.routes = data.courses.map((c) => routeDraftFromCourse(c, a.graph));
        } catch (e) {
          routeLoadFailed = e instanceof Error ? e.message : String(e);
          deps.setStatus(`Could not read the routes file: ${routeLoadFailed}`, "error");
        }
      } else {
        routeLoadFailed = `the server answered ${res.status}`;
        deps.setStatus(`Could not load the routes: ${routeLoadFailed}`, "error");
      }
    } catch (e) {
      // The editor's api() helper throws on non-2xx, so an absent file arrives here as "no routes file".
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "no routes file" && msg !== "404") {
        routeLoadFailed = msg;
        deps.setStatus(`Could not load the routes: ${routeLoadFailed}`, "error");
      }
    }
    routesSnapshot = JSON.stringify(a.routes);
    routesChangedSinceLoad = false;
    try {
      const m = await deps.api(`/maps/${encodeURIComponent(areaId)}.medals.json`);
      if (m.ok) {
        const body = (await m.text()).trimStart();
        medalsFileExists = body.startsWith("{");
      }
    } catch {
      // no medals file known
    }
  }

  function prepareSave(
    areaId: string,
    allowUnfinished: boolean,
  ): RouteSavePlan | { error: string } {
    const a = area();
    if (!a) return { unfinished: [] };
    const stagePlan = planPartialSave(a.stages ?? [], savedStages, stageMissing);
    const routePlan = planPartialSave(a.routes ?? [], savedRoutes, routeMissing);
    const unfinished = [...stagePlan.unfinished, ...routePlan.unfinished];
    if (unfinished.length > 0 && !allowUnfinished) {
      return { error: `${unfinished.join("; ")}. Finish or delete it before using Save as.` };
    }
    const stages = stagePlan.write;
    if (loadFailed !== null && stages.length === 0) {
      return { error: `The stages file could not be read (${loadFailed}). Fix it before saving.` };
    }
    const plan: RouteSavePlan = { unfinished };
    if (stages.length > 0 || stagesFileExisted) {
      const complete = stages.map((s) => ({
        id: s.id,
        name: s.name,
        start: s.start,
        gates: s.gates,
        finish: s.finish as NonNullable<StageDraft["finish"]>,
        ...(s.medals === undefined ? {} : { medals: s.medals }),
      }));
      plan.stages = stages;
      plan.stagesText = serializeStageData({ schemaVersion: 1, areaId, stages: complete });
    }

    const routes = routePlan.write;
    if (routeLoadFailed !== null && routes.length === 0) {
      return {
        error: `The routes file could not be read (${routeLoadFailed}). Fix it before saving.`,
      };
    }
    if (routes.length > 0 || routesFileExisted) {
      const courses: Course[] = [];
      for (const draft of routes) {
        const res = courseFromRouteDraft(draft, a.graph, deps.heightAt);
        if ("error" in res) return { error: `${draft.name}: ${res.error}` };
        courses.push(res.course);
      }
      plan.routes = routes;
      plan.routesText = serializeCourseData({
        schemaVersion: COURSE_SCHEMA_VERSION,
        areaId,
        courses,
      });
    }
    return plan;
  }

  async function putFile(url: string, text: string) {
    try {
      const res = await deps.api(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (!res.ok) {
        const msg = (await res.text().catch(() => "")) || `status ${res.status}`;
        return `Could not save the route: ${msg}. Fix it and save again.`;
      }
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Could not save the route: ${msg}. Fix it and save again.`;
    }
  }

  async function commitSave(areaId: string, prepared: RouteSavePlan): Promise<string | null> {
    if (prepared.stagesText !== undefined) {
      const err = await putFile(
        `/__terrain/stages/${encodeURIComponent(areaId)}`,
        prepared.stagesText,
      );
      if (err !== null) return err;
      stagesFileExisted = true;
      loadFailed = null;
      savedStages = prepared.stages ?? [];
    }
    if (prepared.routesText !== undefined) {
      const err = await putFile(
        `/__terrain/routes/${encodeURIComponent(areaId)}`,
        prepared.routesText,
      );
      if (err !== null) return err;
      routesFileExisted = true;
      routeLoadFailed = null;
      savedRoutes = prepared.routes ?? [];
      // Medals notice: the area has a medals file and a route differs from what was loaded.
      if (JSON.stringify(area()?.routes ?? []) !== routesSnapshot) routesChangedSinceLoad = true;
    }
    return null;
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
      const stageRisk = terrainEdited && (area()?.stages ?? []).some((s) => s.medals !== undefined);
      return stageRisk || (medalsFileExists && routesChangedSinceLoad);
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
