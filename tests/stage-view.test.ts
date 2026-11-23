import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { StageRunCourse } from "../src/core/stage-run";
import { createStageView } from "../src/render/stage-view";

const course: StageRunCourse = {
  start: { x: 0, z: 0, headingRad: 0 },
  gates: [
    { id: "g1", x: 10, z: 0, headingRad: 0, widthM: 10 },
    { id: "g2", x: 30, z: 0, headingRad: 0, widthM: 10 },
    { id: "g3", x: 50, z: 0, headingRad: 0, widthM: 10 },
  ],
  finish: { x: 70, z: 0, headingRad: 0, widthM: 12 },
};

const heightAt = (x: number): number => x * 0.1;

function setup() {
  const parent = new THREE.Group();
  const view = createStageView(parent, heightAt);
  view.setStage(course);
  const posts = view.group.getObjectByName("stage-posts") as THREE.InstancedMesh;
  const banners = view.group.getObjectByName("stage-banners") as THREE.Mesh;
  const beam = view.group.getObjectByName("stage-beam") as THREE.Mesh;
  return { parent, view, posts, banners, beam };
}

function quadColors(banners: THREE.Mesh): number[][] {
  const color = banners.geometry.getAttribute("color");
  const count = banners.geometry.drawRange.count;
  const out: number[][] = [];
  for (let i = 0; i < count; i += 6) {
    out.push([color.getX(i), color.getY(i), color.getZ(i), color.getW(i)]);
  }
  return out;
}

function hex(c: string): number[] {
  const col = new THREE.Color(c);
  return [col.r, col.g, col.b];
}

function expectColor(actual: number[], hexColor: string, alpha: number): void {
  const [r, g, b] = hex(hexColor) as [number, number, number];
  expect(actual[0]).toBeCloseTo(r, 4);
  expect(actual[1]).toBeCloseTo(g, 4);
  expect(actual[2]).toBeCloseTo(b, 4);
  expect(actual[3]).toBeCloseTo(alpha, 4);
}

describe("createStageView", () => {
  it("builds exactly 3 children and 2 posts per gate and finish", () => {
    const { parent, view, posts } = setup();
    expect(parent.children).toHaveLength(1);
    expect(view.group.children).toHaveLength(3);
    expect(view.group.children[0]).toBeInstanceOf(THREE.InstancedMesh);
    expect(posts.count).toBe(8);
  });

  it("seats posts on terrain at gate x/z +/- right * width/2", () => {
    const { view, posts } = setup();
    view.update(null);
    const m = new THREE.Matrix4();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    posts.getMatrixAt(0, m);
    p0.setFromMatrixPosition(m);
    posts.getMatrixAt(1, m);
    p1.setFromMatrixPosition(m);
    expect(Math.abs(p0.x - 10)).toBeCloseTo(5, 5);
    expect(p0.z).toBeCloseTo(0, 5);
    expect(p0.x - 10).toBeCloseTo(-(p1.x - 10), 5);
    expect(p0.y).toBeCloseTo(heightAt(p0.x) + 3, 5);
  });

  it("posts on a slope differ in y", () => {
    const parent = new THREE.Group();
    const view = createStageView(parent, (x) => x * 0.5);
    view.setStage({
      ...course,
      gates: [{ id: "g1", x: 10, z: 0, headingRad: 0, widthM: 10 }],
    });
    view.update(null);
    const posts = view.group.getObjectByName("stage-posts") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    posts.getMatrixAt(0, m);
    a.setFromMatrixPosition(m);
    posts.getMatrixAt(1, m);
    b.setFromMatrixPosition(m);
    expect(a.y).not.toBeCloseTo(b.y, 3);
  });

  it("update(1) hides gate 0, highlights gate 1, dims gate 2 and puts the beam on gate 1", () => {
    const { view, posts, banners, beam } = setup();
    view.update(1);
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    posts.getMatrixAt(0, m);
    s.setFromMatrixScale(m);
    expect(s.x).toBe(0);
    const colors = quadColors(banners);
    expectColor(colors[0] as number[], "#ffd447", 1);
    expectColor(colors[1] as number[], "#9A9AA0", 0.4);
    expect(beam.visible).toBe(true);
    expect(beam.position.x).toBeCloseTo(30, 5);
  });

  it("update(3) puts the beam on the finish; update(5) shows nothing", () => {
    const { view, posts, banners, beam } = setup();
    view.update(3);
    expect(beam.visible).toBe(true);
    expect(beam.position.x).toBeCloseTo(70, 5);
    view.update(5);
    expect(beam.visible).toBe(false);
    expect(banners.geometry.drawRange.count).toBe(0);
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    for (let i = 0; i < posts.count; i++) {
      posts.getMatrixAt(i, m);
      s.setFromMatrixScale(m);
      expect(s.x).toBe(0);
    }
  });

  it("update(null) shows everything neutral with no beam; setDim multiplies alpha", () => {
    const { view, banners, beam } = setup();
    view.update(null);
    expect(beam.visible).toBe(false);
    const colors = quadColors(banners);
    expectColor(colors[0] as number[], "#F2EFE6", 1);
    expectColor(colors[2] as number[], "#F2EFE6", 1);
    view.setDim(true);
    for (const c of quadColors(banners)) expect(c[3]).toBeCloseTo(0.4, 5);
  });

  it("makes the finish banner a chequer of at least 8 alternating quads", () => {
    const { view, banners } = setup();
    view.update(3);
    const colors = quadColors(banners);
    const finishQuads = colors.slice(3);
    expect(finishQuads.length).toBeGreaterThanOrEqual(8);
    const distinct = new Set(finishQuads.map((c) => `${c[0]!.toFixed(3)}`));
    expect(distinct.size).toBe(2);
  });

  it("setStage(null) empties posts and banners; dispose removes the group", () => {
    const { parent, view, posts, banners } = setup();
    view.setStage(null);
    expect(posts.count).toBe(0);
    expect(banners.geometry.drawRange.count).toBe(0);
    view.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
