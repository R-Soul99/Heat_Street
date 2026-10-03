import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createCarXray } from "../src/render/car-xray";

describe("createCarXray", () => {
  it("adds one depth-greater front-face ghost to the chassis only, and removes it on dispose", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const chassis = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    const wheel = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    chassis.add(wheel);
    const before = chassis.children.length;

    const xray = createCarXray(chassis);
    expect(chassis.children.length).toBe(before + 1);
    expect(wheel.children.length).toBe(0);

    const ghost = chassis.children[chassis.children.length - 1] as THREE.Mesh;
    const material = ghost.material as THREE.MeshBasicMaterial;
    expect(material.depthFunc).toBe(THREE.GreaterDepth);
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(THREE.FrontSide);

    xray.dispose();
    expect(chassis.children.length).toBe(before);
  });
});
