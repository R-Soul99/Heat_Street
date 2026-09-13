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
import {
  defaultSurfaceProfiles,
  parseSavedSurfaceProfiles,
  SURFACE_TUNING_STORAGE_KEY,
} from "./core/surface-tuning";
import type { SurfaceType } from "./core/surface-types";
import { defaultTuning, parseSavedTuning, TUNING_STORAGE_KEY } from "./core/vehicle-tuning";
import { DEBUG_ENABLED, onDebugKey, onDebugToggle } from "./debug/debug-gate";
import { createFreeLookCamera } from "./debug/free-look-camera";
import { createHud } from "./debug/profiler-hud";
import { createTelemetryHud } from "./debug/telemetry-hud";
import { createTuningPanel } from "./debug/tuning-panel";
import { createSpeedometer } from "./hud/speedometer";
import { LiveInputSource } from "./input/live-input";
import { startLoop } from "./loop";
import {
  createSurfaceScene,
  SURFACE_SCENE_FLOOR_HALF_EXTENTS,
  SURFACE_ZONE_ORDER,
} from "./physics/surface-scene";
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
import { createRenderer } from "./render/renderer";
import { createSurfaceFx } from "./render/surface-fx";
import { createSurfaceWorld } from "./render/surface-view";
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
// strings safe to read (threats T-02-01 / T-03-01) — never `JSON.parse`
// directly here. Three separate keys mean a corrupt camera blob cannot take
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
const scene = createSurfaceScene(world, tuning, surfaceProfiles);
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
// `{ includePhase2Ground: false }` -- Phase 3's `src/render/surface-view.ts`
// zone/building visuals below replace the flat Phase 2 ground and ramp; the
// reference grid is still built either way (see that option's own doc
// comment), but `groundExtents` bounds it to the six-surface scene's actual
// floor footprint rather than the Phase 2 flat-plane default -- an
// unbounded grid was found during plan 03-08's human go/no-go session to
// read as drivable floor well past where the real physics floor ends.
const view = createVehicleView(
  tuning.wheels.radius,
  tuning.wheels.halfTrack,
  tuning.wheels.halfWheelbase,
  tuning.chassis.halfExtents,
  { includePhase2Ground: false, groundExtents: SURFACE_SCENE_FLOOR_HALF_EXTENTS },
);
const surfaceWorld = createSurfaceWorld();
view.scene.add(surfaceWorld.group);

// SURF-02's visual half (plan 03-10): always constructed, NOT gated on
// `DEBUG_ENABLED` -- surface FX is player-facing, exactly like the
// speedometer and the camera. `surfaceWorld.zoneMeshes`/`SURFACE_ZONE_ORDER`
// are the parallel arrays the skid-decal pool projects onto.
const fx = createSurfaceFx(surfaceWorld.zoneMeshes, SURFACE_ZONE_ORDER);
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
// Synthesized loops ship as the DEFAULT and, per this plan's resolved
// checkpoint (see SUMMARY.md), the ONLY source this build ships with -- no
// external CC0 asset was sourced or committed this session. This is the
// single line a future real-recording upgrade would replace with a
// `loadSurfaceLoops(...)` call, falling back to synthesis per surface for
// whichever URL is absent or fails.
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
// against the rig it actually ships on.
const occlusionProbe = createOcclusionProbe(surfaceWorld.buildingMeshes);
// "fade" is the default arm — PROVISIONAL pending plan 03-12's SC6 playtest.
// This is the line to change once that session picks a winner.
const occlusion = createOcclusionController(
  occlusionProbe,
  surfaceWorld.buildingMeshes,
  helicopterRig,
  cameraTuning,
  "fade",
);
if (DEBUG_ENABLED) {
  onDebugKey("KeyO", () => {
    const m = occlusion.cycle();
    console.log("[occlusion-diag] KeyO pressed, new mode =", m);
  });
}
// TEMP DIAGNOSTIC (03-12 playtest debugging) — remove before commit.
let diagFrame = 0;

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
    // TEMP DIAGNOSTIC (03-12 playtest debugging) — remove before commit.
    if (DEBUG_ENABLED) {
      diagFrame++;
      if (diagFrame % 30 === 0) {
        const diagHits = occlusionProbe.hits(camera.position, view.meshes[0].position);
        console.log(
          "[occlusion-diag] mode=",
          occlusion.mitigation(),
          "hits=",
          diagHits.length,
          "camPos=",
          camera.position.toArray().map((n) => n.toFixed(1)),
          "carPos=",
          view.meshes[0].position.toArray().map((n) => n.toFixed(1)),
        );
      }
    }

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
  hud: hud ? (stats, dtMs) => hud.update(stats, dtMs) : undefined,
});
