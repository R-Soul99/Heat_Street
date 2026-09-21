import * as THREE from "three";
import type { CourseCheckpoint } from "../core/course";
import type { RaceSnapshot } from "../core/race-state";

export interface ObjectiveView {
  update(snapshot: RaceSnapshot, checkpoints: readonly CourseCheckpoint[]): void;
  dispose(): void;
}

const ACTIVE_COLOR = 0xffd447;

export function createObjectiveView(parent: THREE.Object3D): ObjectiveView {
  const pillars = new Map<string, THREE.Mesh>();
  const material = new THREE.MeshBasicMaterial({
    color: ACTIVE_COLOR,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const geometry = new THREE.CylinderGeometry(2.2, 2.2, 28, 12, 1, true);

  function update(snapshot: RaceSnapshot, checkpoints: readonly CourseCheckpoint[]): void {
    const visible = new Set(snapshot.visitedIds);
    const targetId = snapshot.currentTargetId;
    for (const checkpoint of checkpoints) {
      if (visible.has(checkpoint.id)) {
        const old = pillars.get(checkpoint.id);
        if (old !== undefined) {
          old.removeFromParent();
          pillars.delete(checkpoint.id);
        }
        continue;
      }
      let pillar = pillars.get(checkpoint.id);
      if (pillar === undefined) {
        pillar = new THREE.Mesh(geometry, material.clone());
        pillar.name = `checkpoint-${checkpoint.id}`;
        pillar.position.set(
          checkpoint.position[0],
          checkpoint.position[1] + 14,
          checkpoint.position[2],
        );
        parent.add(pillar);
        pillars.set(checkpoint.id, pillar);
      }
      const pillarMaterial = pillar.material as THREE.MeshBasicMaterial;
      pillarMaterial.color.setHex(checkpoint.id === targetId ? ACTIVE_COLOR : 0x43d9ff);
      pillarMaterial.opacity = checkpoint.id === targetId ? 0.5 : 0.22;
    }
  }

  return {
    update,
    dispose(): void {
      for (const pillar of pillars.values()) {
        pillar.removeFromParent();
        (pillar.material as THREE.Material).dispose();
      }
      geometry.dispose();
      material.dispose();
      pillars.clear();
    },
  };
}
