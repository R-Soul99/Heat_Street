/**
 * Composition root: wires core, physics, render and debug together into a
 * running application.
 *
 * This REPLACES plan 01-01's temporary WASM bootstrap entirely — that file's
 * only job was to prove the Rapier WASM executes in a real browser, which
 * `startLoop` below now does for real, on every frame, for the life of the
 * page.
 *
 * `src/main.ts` is the trust boundary where a layering violation is easiest
 * to introduce and hardest to see (01-RESEARCH.md "Architectural
 * Responsibility Map"). `tests/layering.test.ts` polices the whole `src/`
 * tree automatically rather than relying on this file being reviewed
 * carefully by eye every time it changes.
 *
 * Phase 2 supersedes the Phase 1 debug scene HERE, and only here: every other
 * file that still imports `createDebugScene`/`createDebugRenderScene` does so
 * as a regression fixture (see the comment above `world`/`scene` below), never
 * as a second live composition path.
 *
 * Plan 04-09 supersedes Phase 3's `createSurfaceScene`/`createSurfaceWorld`
 * six-band test fixture HERE, and only here (D-P26): `src/physics/surface-
 * scene.ts` and `src/render/surface-view.ts` remain in place, unmodified, as
 * regression fixtures their own tests still import. This file now boots on
 * the real compiled Juliette, GA area instead — `createMapScene` (physics)
 * and `loadMapView` (render) in place of their Phase 3 predecessors, with
 * every other Phase 2/3 system (handling, surface FX, surface audio, the
 * helicopter camera and its occlusion fade) wired to the real geometry
 * unchanged.
 *
 * D-P25: this file uses literal TOP-LEVEL `await` (not a floating promise
 * wrapping an async function) to fetch and parse the compiled map artifacts
 * before the world can be built — Vite's `build.target: "esnext"` supports
 * this. A floating promise here would race `startLoop` against an unloaded
 * world; a real top-level `await` cannot.
 */
import * as THREE from "three";
import { createAudioBootstrap } from "./audio/audio-bootstrap";
import { createSurfaceAudio } from "./audio/surface-audio";
import { createSynthesizedSurfaceLoops } from "./audio/surface-loops";
import {
  CAMERA_TUNING_STORAGE_KEY,
  defaultCameraTuning,
  parseSavedCameraTuning,
} from "./core/camera-tuning";
import { parseMapCollision } from "./core/map-collision";
// Explicit `.ts` extension on `road-graph.ts`'s import path is that module's
// OWN convention (`tools/map-compiler/**` needs it for Node's native
// type-stripping resolver) — this file imports it the same, ordinary,
// extensionless way every other `src/` consumer does.
import { parseRoadGraph } from "./core/road-graph";
import {
  defaultSurfaceProfiles,
  parseSavedSurfaceProfiles,
  SURFACE_TUNING_STORAGE_KEY,
} from "./core/surface-tuning";
import type { SurfaceType } from "./core/surface-types";
import { defaultTuning, parseSavedTuning, TUNING_STORAGE_KEY } from "./core/vehicle-tuning";
import { DEBUG_ENABLED, onDebugKey, onDebugToggle } from "./debug/debug-gate";
import { createFreeLookCamera } from "./debug/free-look-camera";
import { createNavPointer } from "./debug/nav-pointer";
import { createHud } from "./debug/profiler-hud";
import { createTelemetryHud } from "./debug/telemetry-hud";
import { createTuningPanel } from "./debug/tuning-panel";
import { createMapCredit } from "./hud/map-credit";
import { createSpeedometer } from "./hud/speedometer";
import { LiveInputSource } from "./input/live-input";
import { startLoop } from "./loop";
import { createMapScene } from "./physics/map-scene";
import { TransformCache } from "./physics/transform-cache";
import { createWorld } from "./physics/world";
import { createCameraSkin, createCameraSkinChrome } from "./render/camera/camera-skin";
import {
  type CameraRig,
  createChaseCameraRig,
  createHelicopterCameraRig,
} from "./render/camera/helicopter-camera";
import { createObjectCameraTarget } from "./render/camera/object-camera-target";
import { createOcclusionController } from "./render/camera/occlusion-controller";
import { createOcclusionProbe } from "./render/camera/occlusion-probe";
import { applyAllInterpolated } from "./render/interpolator";
import { loadMapView } from "./render/map-view";
import { createRenderer } from "./render/renderer";
import { createSurfaceFx } from "./render/surface-fx";
import { createVehicleView } from "./render/vehicle-view";

const canvasElement = document.getElementById("game");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('composition root: expected a <canvas id="game"> element in index.html');
}
const canvas: HTMLCanvasElement = canvasElement;

// Persisted values are restored at boot so an HMR reload does not lose a
// tuning session (D-17). Three independent blobs, each read through its OWN
// parse-or-default function — `parseSavedTuning`/`parseSavedSurfaceProfiles`/
// `parseSavedCameraTuning` are what make these untrusted `localStorage`
// strings safe to read (threats T-02-01 / T-03-01) — never JSON's own
// `parse` called directly here. Three separate keys mean a corrupt camera
// blob cannot take
// vehicle tuning down with it, which a single merged blob would.
const tuning =
  parseSavedTuning(
    typeof localStorage !== "undefined" ? localStorage.getItem(TUNING_STORAGE_KEY) : null,
  ) ?? defaultTuning();
const surfaceProfiles =
  parseSavedSurfaceProfiles(
    typeof localStorage !== "undefined" ? localStorage.getItem(SURFACE_TUNING_STORAGE_KEY) : null,
  ) ?? defaultSurfaceProfiles();
const cameraTuning =
  parseSavedCameraTuning(
    typeof localStorage !== "undefined" ? localStorage.getItem(CAMERA_TUNING_STORAGE_KEY) : null,
  ) ?? defaultCameraTuning();

const world = createWorld();

// The one compiled area this composition root drives (plan 04-09). Named
// exactly once so the three map artifact URLs and `parseMapCollision`'s
// area-mismatch check (T-04-30) can never independently drift from each
// other — every URL below is built FROM this constant, never re-typed.
const AREA_ID = "juliette-ga";
const MAP_GRAPH_URL = `/maps/${AREA_ID}.map.json`;
const MAP_COLLISION_URL = `/maps/${AREA_ID}.collision.json`;
const MAP_GLB_URL = `/maps/${AREA_ID}.glb`;

/**
 * Fetches `url` as text, throwing a named error (naming `url` and the HTTP
 * status) on a non-2xx response — `fetch` alone only REJECTS on a network
 * failure, never on a 404/500, so this is what makes a missing artifact fail
 * loudly (T-04-32) instead of handing `parseRoadGraph`/`parseMapCollision` an
 * HTML error-page body to choke on with a confusing message.
 */
async function fetchArtifactText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch "${url}": HTTP ${response.status}`);
  }
  return response.text();
}

// D-P27: a missing, stale or malformed map artifact must produce a named,
// legible on-screen failure — never a blank canvas. Every statement that
// depends on the compiled map (the fetch/parse/load above, and every
// downstream system built from `graph`/`collision`/`mapView`) lives inside
// this `try`, so a failure anywhere in the chain leaves `startLoop`
// deliberately uncalled.
try {
  // `parseRoadGraph`/`parseMapCollision` are the only entry points that ever
  // touch these artifacts' JSON — never a bare call to JSON's own `parse`
  // at this call site (T-04-01), mirroring this file's own "never call
  // JSON's `parse` directly here" discipline for the localStorage trio above.
  const graphText = await fetchArtifactText(MAP_GRAPH_URL);
  const graph = parseRoadGraph(graphText, MAP_GRAPH_URL);
  const collisionText = await fetchArtifactText(MAP_COLLISION_URL);
  const collision = parseMapCollision(collisionText, graph.areaId, MAP_COLLISION_URL);
  const mapView = await loadMapView(MAP_GLB_URL);

  const scene = createMapScene(world, graph, collision, tuning, surfaceProfiles);
  const transforms = new TransformCache(scene.bodies);

  // `src/physics/vehicle-scene.ts` and `src/physics/debug-scene.ts` (and their
  // render-side counterparts, including `src/render/vehicle-view.ts`'s Phase 2
  // ground/ramp visuals) are deliberately LEFT IN PLACE and are no longer
  // imported by this file for live composition. They are now regression
  // fixtures: `tests/determinism.test.ts` (7 sites), `tests/vehicle-scene.test.ts`,
  // `tests/transform-cache.test.ts` and `tests/loop.test.ts` all import their
  // scene-building factory functions, and `tests/determinism.test.ts` is the
  // VEH-03 proof CLAUDE.md project constraint 3 says must not regress.
  // `src/physics/vehicle-scene.ts` remains imported by `tests/vehicle-scene.test.ts`
  // specifically and must not be deleted. Deleting any of these is a separately
  // planned task, never a side effect of this phase.

  const { renderer, camera } = createRenderer(canvas);

  // Geometry is passed EXPLICITLY at this call site rather than letting
  // `src/render/vehicle-view.ts` import `VehicleTuning`, preserving the
  // "explicit contract at the call site" convention this file already used for
  // `scene.bodies.length` / `scene.spinnerIndex` (threat T-01-16).
  // `{ includePhase2Ground: false }` -- `src/render/map-view.ts`'s loaded road/
  // building meshes below replace the flat Phase 2 ground and ramp AND Phase
  // 3's six-band fixture; the reference grid is still built either way (see
  // that option's own doc comment), now bounded to the REAL compiled area's
  // own `bounds` (converted to symmetric half-extents around the origin,
  // since `buildReferenceGrid` is always centred there) rather than Phase 3's
  // fixed six-band footprint — an unbounded/mismatched grid was found during
  // plan 03-08's human go/no-go session to read as "drivable floor" well past
  // where the real physics floor ends, and that finding applies directly to
  // real map bounds too.
  const groundExtents = {
    x: Math.max(Math.abs(graph.bounds.minX), Math.abs(graph.bounds.maxX)),
    z: Math.max(Math.abs(graph.bounds.minZ), Math.abs(graph.bounds.maxZ)),
  };
  const view = createVehicleView(
    tuning.wheels.radius,
    tuning.wheels.halfTrack,
    tuning.wheels.halfWheelbase,
    tuning.chassis.halfExtents,
    { includePhase2Ground: false, groundExtents },
  );
  view.scene.add(mapView.group);

  // SURF-02's visual half (plan 03-10): always constructed, NOT gated on
  // `DEBUG_ENABLED` -- surface FX is player-facing, exactly like the
  // speedometer and the camera. `mapView.roadMeshes`/`mapView.roadSurfaces`
  // are the parallel arrays the skid-decal pool projects onto — the same
  // contract Phase 3's `surfaceWorld.zoneMeshes`/`SURFACE_ZONE_ORDER` shipped,
  // now backed by the real compiled road meshes instead of six test bands.
  const fx = createSurfaceFx(mapView.roadMeshes, mapView.roadSurfaces);
  view.scene.add(fx.group);

  /** One render frame's mutable per-wheel FX sample -- `SurfaceFxWheelInput`'s shape, but writable at this call site (the interface itself is `readonly` for `fx.update`'s own callers). */
  interface WheelFxSample {
    surface: SurfaceType;
    grounded: boolean;
    slip: number;
    position: THREE.Vector3;
  }

  // Allocated ONCE, outside the render callback, and mutated in place every
  // frame -- a fresh four-object array every frame would be exactly the
  // per-frame garbage the render tier's existing scratch-object convention
  // (`vehicle-view.ts`'s `SCRATCH_AXLE` et al.) exists to avoid.
  const wheelFxInput: WheelFxSample[] = [0, 1, 2, 3].map(() => ({
    surface: "tarmac",
    grounded: false,
    slip: 0,
    position: new THREE.Vector3(),
  }));

  // SURF-02's audio half (plan 03-11): always constructed, NOT gated on
  // DEBUG_ENABLED -- audio is player-facing, exactly like the speedometer,
  // camera and surface FX above.
  const audio = createAudioBootstrap(camera);
  // Synthesized loops ship as the DEFAULT and, per plan 03-11's resolved
  // checkpoint (see that plan's SUMMARY.md), the ONLY source this build
  // ships with -- no external CC0 asset was sourced or committed this
  // session. This is the single line a future real-recording upgrade would
  // replace with a `loadSurfaceLoops(...)` call, falling back to synthesis
  // per surface for whichever URL is absent or fails.
  const surfaceAudio = createSurfaceAudio(
    audio.listener,
    view.meshes[0],
    createSynthesizedSurfaceLoops(audio.listener.context),
  );

  // Reused parallel arrays alongside `wheelFxInput` above, filled in the SAME
  // per-wheel loop in the render callback -- `wheelFxInput` holds objects
  // (`WheelFxSample`), not parallel arrays, so `surfaceAudio.update`'s own
  // parallel-array signature (`surfaceGains`' shape, matching
  // `src/render/surface-fx.ts`'s reused-array convention) needs its own
  // allocation-free trio rather than a second per-frame object array.
  const wheelAudioSurfaces: SurfaceType[] = ["tarmac", "tarmac", "tarmac", "tarmac"];
  const wheelAudioGrounded: boolean[] = [false, false, false, false];
  const wheelAudioSlip: number[] = [0, 0, 0, 0];

  // This replaces the Phase 1 all-NEUTRAL stub with live keyboard + gamepad
  // input.
  const input = new LiveInputSource();

  // Always constructed, NOT gated on `DEBUG_ENABLED` — the speedometer is
  // player-facing (NAV-01).
  const speedo = createSpeedometer();

  // SC4's positive half (plan 04-10, D-P30): always constructed, NOT gated
  // on `DEBUG_ENABLED` — attribution is a licence obligation, not a
  // developer tool, exactly like the speedometer above. Content comes
  // entirely from the loaded map's own `attribution` block. The returned
  // handle is intentionally discarded -- this overlay lives for the whole
  // page lifetime, the same as the speedometer above, which no code path
  // ever disposes either.
  createMapCredit(graph.attribution);

  // The HUD is constructed only when `?debug` is present, so a normal build
  // adds zero DOM overlay and zero listeners.
  const hud = DEBUG_ENABLED ? createHud(renderer, world) : null;
  if (hud) {
    onDebugToggle(() => hud.toggle());
  }

  // Both dev panels below follow the exact same shape as the profiler HUD
  // above: construct only when `DEBUG_ENABLED`, then register the toggle. A
  // normal (non-`?debug`) build therefore creates zero panels and registers
  // zero listeners for `KeyG`/`KeyT` either — this is the ASVS V4 control
  // (T-02-03) and it is also why the tuning panel can never be player-facing:
  // player-side handling tuning would break medal-time comparability (D-15).
  //
  // `onApplyVehicle` is `() => scene.setTuning(tuning)` — the SAME object
  // reference the panel mutates in place, so a slider move takes effect on
  // the very next fixed tick with no rebuild. Rebuilding the vehicle on every
  // slider move would lose the car's state mid-drive (position, velocity, the
  // tuning session itself) and make the panel unusable. `onApplySurfaces`
  // mirrors this for the live `SurfaceProfiles` object. `onApplyCamera` is a
  // genuine no-op: `helicopterRig`/`chaseRig` (built below) read their shared
  // `cameraTuning` object BY REFERENCE every `update(dtMs)`, so a camera
  // slider move takes effect on the very next render frame with nothing to
  // push — this is said explicitly here rather than silently omitting the
  // handler.
  const panel = DEBUG_ENABLED
    ? createTuningPanel(tuning, surfaceProfiles, cameraTuning, {
        onApplyVehicle: () => scene.setTuning(tuning),
        onApplySurfaces: () => scene.setSurfaceProfiles(surfaceProfiles),
        onApplyCamera: () => {
          // No-op — see this block's own comment above.
        },
      })
    : null;
  if (panel) {
    onDebugKey("KeyG", () => panel.toggle());
  }

  // `() => tuning` / `() => surfaceProfiles` — callbacks, not captured values,
  // so a telemetry run triggered after the panel above has mutated either
  // object reads the LIVE values rather than a stale copy taken at
  // composition-root startup. This is what makes SC5's "retuned live … and
  // re-verified … with no code edit" literally true, extended to surfaces by
  // this plan's second sweep button.
  const telemetry = DEBUG_ENABLED
    ? createTelemetryHud(
        () => tuning,
        () => surfaceProfiles,
      )
    : null;
  if (telemetry) {
    onDebugKey("KeyT", () => telemetry.toggle());
  }

  // The camera target follows the chassis mesh's INTERPOLATED transform
  // (`view.meshes[0]`), never the rigid body's raw fixed-tick position
  // (`scene.vehicle.body.translation()`). `applyAllInterpolated` writes the
  // alpha-blended pose onto that mesh every render frame, while the body's own
  // translation only changes once per fixed tick. A camera following the raw
  // body position while the car is DRAWN at the interpolated one makes the car
  // visibly jitter inside the frame at any refresh rate that is not exactly
  // 60 Hz — which would read as "the camera shakes" and would poison SC3's
  // drift-stability judgement for a reason that has nothing to do with the
  // rig itself. Velocity does not need interpolating and comes straight from
  // the body.
  const cameraTarget = createObjectCameraTarget(view.meshes[0], () => scene.vehicle.body.linvel());

  // Both rigs are built and kept alive so the composition root can swap
  // between them with zero rebuild cost. NOT gated on `DEBUG_ENABLED` — the
  // camera itself is player-facing, exactly like `speedo`. Only the SWAP below
  // is a dev control. Plan 03-08's go/no-go gate is now DECIDED: GO, with no
  // retuning (docs/adr/0002-helicopter-camera-go-no-go.md) — the helicopter
  // rig is the confirmed shipped camera, not merely today's default. Per
  // CONTEXT.md D-12 the chase rig remains a genuine shipping candidate should
  // a future playtest ever overturn this decision; flipping this `activeRig`
  // initialiser would be the whole change.
  const helicopterRig = createHelicopterCameraRig(camera, cameraTarget, cameraTuning);
  const chaseRig = createChaseCameraRig(camera, cameraTarget, cameraTuning);
  let activeRig: CameraRig = helicopterRig;
  activeRig.snap();
  if (DEBUG_ENABLED) {
    onDebugKey("KeyC", () => {
      activeRig = activeRig === helicopterRig ? chaseRig : helicopterRig;
      activeRig.snap();
    });
  }

  // CAM-04's occlusion mitigation (plan 03-09): constructed ALWAYS, NOT gated
  // on `DEBUG_ENABLED` — occlusion mitigation is player-facing behaviour,
  // exactly like the camera rig itself. Bound to `helicopterRig` specifically,
  // not the momentarily-active `activeRig` — the helicopter rig is the
  // confirmed shipped camera (docs/adr/0002-helicopter-camera-go-no-go.md),
  // and `chaseRig.setPitchBiasRad` is a documented no-op, so biasing whichever
  // rig happens to be active would gain the dev-only `C` comparison nothing
  // while losing the guarantee that occlusion behaviour is always exercised
  // against the rig it actually ships on. `mapView.buildingMeshes` replaces
  // Phase 3's `surfaceWorld.buildingMeshes` — the real compiled area's
  // buildings, now `THREE.DoubleSide` (see `src/render/map-view.ts`'s own
  // header comment) so the probe's fan rays no longer read as culled
  // back-face exits per docs/adr/0003-occlusion-mitigation.md.
  const occlusionProbe = createOcclusionProbe(mapView.buildingMeshes);
  // "fade" is CAM-04/SC6's shipped mitigation — decided by plan 03-12's human
  // playtest, not on paper (docs/adr/0003-occlusion-mitigation.md). Steepen
  // remains fully implemented behind the `O` toggle but is currently blocked
  // by a confirmed fan-ray/back-face bug (same ADR) rather than rejected on
  // feel; it was never actually exercised above its baseline pitch.
  const occlusion = createOcclusionController(
    occlusionProbe,
    mapView.buildingMeshes,
    helicopterRig,
    cameraTuning,
    "fade",
  );
  if (DEBUG_ENABLED) {
    onDebugKey("KeyO", () => {
      occlusion.cycle();
    });
  }

  // The camera skin (CAM-03) is always constructed and applied — the camera is
  // permanently skinned, and Phase 5 is what will drive the choice from the
  // active game mode. "police" is the boot default. Only the PREVIEW toggle
  // (D-14) is a dev control.
  //
  // Full key map for this phase, recorded here as the single place a reader
  // would look: Backquote = profiler HUD, G = tuning panel, T = telemetry
  // panel, C = camera rig swap, V = camera skin, O = occlusion mitigation A/B
  // (fade / steepen / off), F = temporary free-look orbit (debug only).
  const cameraChrome = createCameraSkinChrome();
  const skin = createCameraSkin(canvas.classList, cameraChrome, "police");
  if (DEBUG_ENABLED) {
    onDebugKey("KeyV", () => skin.cycle());
  }

  // `src/debug/free-look-camera.ts`'s own module doc comment: a TEMPORARY
  // debug-only tool added to assist the Phase 3 plan 03-12 manual occlusion
  // playtest. Gate-free factory, gated here exactly like every other
  // `?debug`-only tool in this file — a normal build constructs nothing and
  // registers zero listeners.
  const freeLook = DEBUG_ENABLED ? createFreeLookCamera(camera, canvas) : null;
  if (freeLook) {
    onDebugKey("KeyF", () => freeLook.toggle());
  }

  // TEMPORARY D-06 sign-off tooling (see nav-pointer.ts's own doc comment):
  // lets the operator enter a map coordinate (a crest centre, a bug
  // screenshot's `pos` readout) and get an arrow pointing to it relative to
  // the car's current heading. Same gate-free-factory shape as every other
  // `?debug`-only tool above.
  const navPointer = DEBUG_ENABLED ? createNavPointer() : null;
  if (navPointer) {
    onDebugKey("KeyN", () => navPointer.toggle());
  }

  // Reused scratch for `navPointer`'s forward-vector input — allocated once,
  // never per frame (`src/render/camera/occlusion-probe.ts`'s SCRATCH
  // convention). `applyQuaternion` duck-types its argument, so Rapier's own
  // `{x,y,z,w}` rotation object can be passed straight in with no wrapping.
  const navForwardScratch = new THREE.Vector3();

  startLoop({
    world,
    input,
    transforms,
    applyInput: scene.applyInput,
    onTickBegin: scene.preTick,
    render(alpha: number, dtMs: number): void {
      // Ground speed computed here from linvel's XZ components, never from the
      // vehicle controller's own full-3D speed getter — that includes vertical
      // velocity, whose sign is numerical noise for a -Z-forward car (Pitfall
      // 1). This update MUST NOT sit between interpolation and the draw call:
      // the profiler HUD reads `renderer.info` after `render()` returns, and
      // that read is valid only because there is exactly one draw call per
      // frame. Put it first.
      const v = scene.vehicle.body.linvel();
      speedo.update(Math.hypot(v.x, v.z), dtMs);

      // No ordering constraint like the camera/occlusion calls below — this
      // only reads the chassis's raw fixed-tick pose and writes its own DOM,
      // so it's a no-op (`navPointer` is `null`) in a normal, non-`?debug` build.
      if (navPointer) {
        const carPos = scene.vehicle.body.translation();
        navForwardScratch.set(0, 0, -1).applyQuaternion(scene.vehicle.body.rotation());
        navPointer.update(carPos.x, carPos.z, navForwardScratch.x, navForwardScratch.z);
      }

      view.updateWheels(scene.vehicle.controller);
      applyAllInterpolated(view.meshes, transforms, alpha);
      // `freeLook?.restoreRigPose()` runs BEFORE `activeRig.update(dtMs)` —
      // LOAD-BEARING ordering (src/debug/free-look-camera.ts's own doc
      // comment): the rig damps `camera.position` using `camera.position`
      // itself as its own state, so leaving last frame's free-look pose there
      // would poison the rig's damping and make it snap on disengage. A no-op
      // while free-look is disengaged or DEBUG_ENABLED is false (`freeLook` is
      // `null`).
      freeLook?.restoreRigPose();
      // `activeRig.update(dtMs)` runs AFTER `applyAllInterpolated` because the
      // rig reads `view.meshes[0]`'s just-written INTERPOLATED transform via
      // `cameraTarget`. Moving this above `applyAllInterpolated` reintroduces
      // the one-frame-stale camera jitter described in `cameraTarget`'s own
      // comment above. `dtMs` here is a variable RENDER-frame delta, never the
      // fixed physics tick — nothing in the camera tier may be called from
      // `applyInput`/`onTickBegin` (03-RESEARCH.md Pitfall 3).
      activeRig.update(dtMs);
      // `occlusion.update` runs AFTER `activeRig.update(dtMs)` so the probe
      // casts its rays from THIS frame's converged camera pose, and BEFORE
      // `renderer.render` so a pitch bias it sets lands before the draw call.
      // The bias itself only takes effect on the NEXT frame's
      // `activeRig.update` (the rig reads it at the top of its own update) —
      // a one-frame lag that is imperceptible, in the same spirit as the
      // surface-friction one-tick lag documented in 03-RESEARCH.md Pitfall 2.
      // This is also why `freeLook.apply()` (below) runs AFTER this call, not
      // before it: occlusion must keep sampling the SHIPPING rig pose the
      // player actually sees, never the developer's flown-to free-look pose.
      occlusion.update(camera.position, view.meshes[0].position, dtMs);
      // `freeLook?.apply(...)` runs AFTER `occlusion.update` (see the comment
      // above) and BEFORE `renderer.render`, so the free-look pose — if
      // engaged — is what actually gets drawn this frame. A no-op while
      // disengaged or `freeLook` is `null`.
      freeLook?.apply(
        view.meshes[0].position.x,
        view.meshes[0].position.y,
        view.meshes[0].position.z,
      );
      // `view.wheelMeshes[i].getWorldPosition(...)` below is only correct if
      // `matrixWorld` already reflects THIS frame's chassis pose (written by
      // `applyAllInterpolated` above) and wheel local transforms (written by
      // `view.updateWheels` above) -- neither call updates `matrixWorld`
      // itself, and `renderer.render`'s own traversal (which normally does)
      // has not run yet this frame. A stale read here would spawn particles/
      // decals at last frame's wheel positions, a one-frame lag that is small
      // but needless since forcing a fresh update is cheap for five objects
      // (the chassis plus its four wheel children).
      view.meshes[0].updateMatrixWorld(true);
      for (let i = 0; i < 4; i++) {
        const wi = wheelFxInput[i];
        wi.surface = scene.vehicle.wheelSurfaces[i];
        wi.grounded = scene.vehicle.controller.wheelIsInContact(i);
        const sideImpulse = scene.vehicle.controller.wheelSideImpulse(i) ?? 0;
        const forwardImpulse = scene.vehicle.controller.wheelForwardImpulse(i) ?? 0;
        wi.slip = Math.hypot(sideImpulse, forwardImpulse);
        view.wheelMeshes[i].getWorldPosition(wi.position);
        // Filled in the SAME loop as `wheelFxInput` above -- see the
        // `wheelAudioSurfaces`/`wheelAudioGrounded`/`wheelAudioSlip`
        // declaration comment for why this is three reused parallel arrays
        // rather than a second per-frame object array.
        wheelAudioSurfaces[i] = wi.surface;
        wheelAudioGrounded[i] = wi.grounded;
        wheelAudioSlip[i] = wi.slip;
      }
      fx.update(wheelFxInput, dtMs);
      surfaceAudio.update(wheelAudioSurfaces, wheelAudioGrounded, wheelAudioSlip, dtMs);

      renderer.render(view.scene, camera);
    },
    hud: hud
      ? (stats, dtMs) => hud.update(stats, dtMs, scene.vehicle.body.translation())
      : undefined,
  });
} catch (err) {
  // D-P27 / T-04-32 / T-04-33: a missing, stale or malformed map artifact
  // must produce a named, legible on-screen failure — never a blank canvas,
  // and never by assigning raw HTML (T-04-33's DOM-injection control; this
  // project's one and only DOM-write rule, already followed throughout
  // `src/hud/` and `src/render/camera/camera-skin.ts`). `startLoop` above is
  // deliberately UNREACHED on this path.
  const message = err instanceof Error ? err.message : String(err);
  const container = canvas.parentElement ?? document.body;
  container.textContent = `Heat Street failed to load the compiled area: ${message}`;
}
