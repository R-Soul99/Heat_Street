import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { defaultCameraTuning } from "../src/core/camera-tuning";
import type { CameraRig } from "../src/render/camera/helicopter-camera";
import { createOcclusionController } from "../src/render/camera/occlusion-controller";
import type { OcclusionProbe } from "../src/render/camera/occlusion-probe";

/** Fade-in must end fully opaque with depth writes restored, or a building stays broken after its first fade. */
describe("occlusion controller fade", () => {
  it("restores opacity 1 and depthWrite after the occluder clears, at several frame rates", () => {
    for (const fps of [30, 60, 144, 240]) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true }),
      );
      let blocked = true;
      const probe: OcclusionProbe = {
        hits: () => (blocked ? [{ distance: 10, id: mesh.id }] : []),
        occludedFanRayCount: () => 0,
        dispose: () => {},
      };
      const rig = { setPitchBiasRad: () => {} } as unknown as CameraRig;
      const controller = createOcclusionController(
        probe,
        [mesh],
        rig,
        defaultCameraTuning(),
        "fade",
      );
      const cam = new THREE.Vector3(0, 0, 0);
      const target = new THREE.Vector3(0, 0, 100);
      const dtMs = 1000 / fps;

      for (let i = 0; i < fps * 2; i++) controller.update(cam, target, dtMs);
      const material = mesh.material as THREE.Material;
      expect(material.opacity).toBeLessThan(0.5);
      expect(material.depthWrite).toBe(false);

      blocked = false;
      for (let i = 0; i < fps * 10; i++) controller.update(cam, target, dtMs);
      expect(material.opacity).toBe(1);
      expect(material.depthWrite).toBe(true);
    }
  });
});
