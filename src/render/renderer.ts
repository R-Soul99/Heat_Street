/**
 * WebGL renderer and camera setup.
 *
 * Classic `WebGLRenderer` from `three`, deliberately NOT `WebGPURenderer` from
 * three's webgpu entry point. CLAUDE.md rules WebGPU out for this project: the
 * art direction
 * is low-poly stylised at mid-to-far camera distance, so none of WebGPU's
 * advantages apply, and r186 REMOVED `PCFSoftShadowMap` from the WebGPU
 * renderer. Soft shadows are load-bearing for the cinematic 1970s look, so that
 * removal alone settles it.
 *
 * Layering: `src/render/` reads simulation state and never writes it. This
 * module owns no scene and draws nothing — the single per-frame draw call site
 * belongs to the loop in `src/main.ts` (plan 01-07), because drawing inside the
 * fixed-tick loop collapses the whole architecture back into variable-rate
 * rendering (01-RESEARCH.md anti-patterns).
 */
import * as THREE from "three";

/** Vertical field of view in degrees. */
const FOV_DEG = 55;

/** Near plane. Anything closer is clipped. */
const NEAR = 0.1;

/**
 * Far plane. 500 m comfortably contains the Phase 1 debug scene and the 100 m
 * ground plane. Phase 4's streamed city chunks will want this raised, together
 * with fog or a second cascade so the depth buffer keeps its precision.
 */
const FAR = 500;

/**
 * Provisional camera pose: a high three-quarter angle that previews the Phase 3
 * helicopter framing without committing to it. Phase 3 owns the real camera and
 * its go/no-go "does 100 mph read as fast?" gate; nothing here should be treated
 * as a decision.
 */
const CAMERA_POSITION = { x: 8, y: 9, z: 14 };

/**
 * Device-pixel-ratio ceiling. Uncapped, a 4K display at DPR 3 renders nine times
 * the pixels of DPR 1 and silently blows the 16.6 ms frame budget in
 * `docs/frame-budget.md` on fill alone (threat T-01-17).
 */
const MAX_PIXEL_RATIO = 2;

export interface RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  dispose(): void;
}

/**
 * Build the renderer and camera for `canvas`, sized to it and kept in sync with
 * window resizes.
 */
export function createRenderer(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // `renderer.info.autoReset` is left at its default `true`, which resets the
  // counters at the START of each draw — so the profiler HUD (plan 01-06) must
  // read `renderer.info.render.*` AFTER the draw returns, never before
  // (01-RESEARCH.md "Pitfall 5").
  //
  // If a later phase draws more than once per frame — post-processing, a minimap
  // render target, the CAM-04 occlusion pre-pass — this must become `false` with
  // a manual `renderer.info.reset()` at the top of the frame, or the HUD will
  // silently report only the last pass and every draw-call number in the frame
  // budget becomes a lie.

  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, NEAR, FAR);
  camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
  camera.lookAt(0, 0, 0);

  const handleResize = (): void => {
    // Read the CSS box, not `window.innerWidth`: `index.html` sizes the canvas
    // with `100vw`/`100vh` today, but a later HUD layout may not give it the
    // whole viewport.
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);

    // Third argument `false` — do NOT let three write inline `style.width` /
    // `style.height` onto the canvas. That would overwrite the CSS sizing in
    // `index.html` and, combined with the CSS, produce a feedback loop where the
    // canvas grows a little on every resize event.
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  // Exactly one listener, removed in `dispose()`. Called once now so the first
  // drawn frame is already correctly sized rather than square.
  handleResize();
  window.addEventListener("resize", handleResize);

  return {
    renderer,
    camera,
    dispose(): void {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
    },
  };
}
