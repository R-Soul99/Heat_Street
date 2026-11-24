import * as THREE from "three";
import type { StageRunCourse } from "../core/stage-run";

/** Visual-only gates (D-10): no colliders. Three draw calls: posts, banners, beam. */
export interface StageView {
  readonly group: THREE.Group;
  setStage(course: StageRunCourse | null): void;
  /** 0..gates-1 = that gate is next; gates.length = finish next; greater = all passed; null = editor display. */
  update(nextGateIndex: number | null): void;
  setDim(dim: boolean): void;
  dispose(): void;
}

const MAX_GATES = 41;
const POST_CAPACITY = 2 * MAX_GATES;
const CHEQUER_COLS = 8;
const CHEQUER_ROWS = 2;
/** Direction chevrons on the ground before the next gate: distance of each from the gate line. */
const CHEVRON_OFFSETS_M = [-14, -9, -4] as const;
const CHEVRON_HALF_WIDTH_M = 3;
const CHEVRON_DEPTH_M = 3;
const CHEVRON_THICK_M = 1.5;
const CHEVRON_LIFT_M = 0.35;
const QUAD_CAPACITY = MAX_GATES + CHEQUER_COLS * CHEQUER_ROWS + CHEVRON_OFFSETS_M.length * 2;
const POST_HEIGHT = 6;
const BANNER_BOTTOM = 4.8;
const BANNER_TOP = 6;
const BEAM_HEIGHT = 60;
const DIM_FACTOR = 0.4;
const LATER_ALPHA = 0.4;

const NEXT_COLOR = new THREE.Color("#ffd447");
const LATER_COLOR = new THREE.Color("#9A9AA0");
const NEUTRAL_COLOR = new THREE.Color("#F2EFE6");
const CHEQUER_DARK = new THREE.Color("#111111");
const CHEQUER_LIGHT = new THREE.Color("#F2EFE6");

interface Post {
  readonly x: number;
  readonly z: number;
  readonly baseY: number;
}

interface Placement {
  readonly left: Post;
  readonly right: Post;
  readonly finish: boolean;
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
}

export function createStageView(
  parent: THREE.Object3D,
  heightAt: (x: number, z: number) => number,
): StageView {
  const group = new THREE.Group();
  group.name = "stage-view";
  parent.add(group);

  const postGeometry = new THREE.BoxGeometry(0.4, POST_HEIGHT, 0.4);
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf2efe6 });
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, POST_CAPACITY);
  posts.name = "stage-posts";
  posts.castShadow = false;
  posts.count = 0;
  posts.frustumCulled = false;

  const positions = new Float32Array(QUAD_CAPACITY * 6 * 3);
  const colors = new Float32Array(QUAD_CAPACITY * 6 * 4);
  const bannerGeometry = new THREE.BufferGeometry();
  bannerGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  bannerGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  bannerGeometry.setDrawRange(0, 0);
  const bannerMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const banners = new THREE.Mesh(bannerGeometry, bannerMaterial);
  banners.name = "stage-banners";
  banners.frustumCulled = false;

  const beamGeometry = new THREE.CylinderGeometry(0.6, 0.6, BEAM_HEIGHT, 8, 1, true);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd447,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.name = "stage-beam";
  beam.visible = false;
  beam.frustumCulled = false;

  group.add(posts, banners, beam);

  let placements: Placement[] = [];
  let nextIndex: number | null = null;
  let dim = false;
  const matrix = new THREE.Matrix4();
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  function makePost(x: number, z: number): Post {
    return { x, z, baseY: heightAt(x, z) };
  }

  function rebuild(): void {
    // Posts: two per placement, zero scale when passed.
    posts.count = placements.length * 2;
    let quad = 0;
    const colorOut = new THREE.Color();

    function writeQuad(
      a: Post,
      b: Post,
      t0: number,
      t1: number,
      y0: number,
      y1: number,
      color: THREE.Color,
      alpha: number,
    ): void {
      const lerp = (p: number, q: number, t: number): number => p + (q - p) * t;
      const corner = (t: number, yOff: number, which: "x" | "y" | "z"): number => {
        const baseY = lerp(a.baseY, b.baseY, t);
        if (which === "x") return lerp(a.x, b.x, t);
        if (which === "z") return lerp(a.z, b.z, t);
        return baseY + yOff;
      };
      const verts: [number, number][] = [
        [t0, y0],
        [t1, y0],
        [t1, y1],
        [t0, y0],
        [t1, y1],
        [t0, y1],
      ];
      for (let v = 0; v < 6; v++) {
        const [t, y] = verts[v] as [number, number];
        const i = quad * 6 + v;
        positions[i * 3] = corner(t, y, "x");
        positions[i * 3 + 1] = corner(t, y, "y");
        positions[i * 3 + 2] = corner(t, y, "z");
        colors[i * 4] = color.r;
        colors[i * 4 + 1] = color.g;
        colors[i * 4 + 2] = color.b;
        colors[i * 4 + 3] = alpha;
      }
      quad += 1;
    }

    function writeChevrons(p: Placement): void {
      const fx = -Math.sin(p.headingRad);
      const fz = -Math.cos(p.headingRad);
      const rx = Math.cos(p.headingRad);
      const rz = -Math.sin(p.headingRad);
      for (const offset of CHEVRON_OFFSETS_M) {
        const tip = offset + CHEVRON_DEPTH_M / 2;
        const tail = offset - CHEVRON_DEPTH_M / 2;
        for (const side of [-CHEVRON_HALF_WIDTH_M, CHEVRON_HALF_WIDTH_M]) {
          const a: [number, number] = [0, tip];
          const b: [number, number] = [side, tail];
          const c: [number, number] = [side, tail - CHEVRON_THICK_M];
          const d: [number, number] = [0, tip - CHEVRON_THICK_M];
          const verts = [a, b, c, a, c, d];
          for (let v = 0; v < 6; v++) {
            const [across, along] = verts[v] as [number, number];
            const x = p.x + rx * across + fx * along;
            const z = p.z + rz * across + fz * along;
            const i = quad * 6 + v;
            positions[i * 3] = x;
            positions[i * 3 + 1] = heightAt(x, z) + CHEVRON_LIFT_M;
            positions[i * 3 + 2] = z;
            colors[i * 4] = NEXT_COLOR.r;
            colors[i * 4 + 1] = NEXT_COLOR.g;
            colors[i * 4 + 2] = NEXT_COLOR.b;
            colors[i * 4 + 3] = dim ? DIM_FACTOR : 1;
          }
          quad += 1;
        }
      }
    }

    for (let g = 0; g < placements.length; g++) {
      const p = placements[g] as Placement;
      const passed = nextIndex !== null && g < nextIndex;
      for (let side = 0; side < 2; side++) {
        const post = side === 0 ? p.left : p.right;
        const slot = g * 2 + side;
        if (passed) {
          posts.setMatrixAt(slot, zeroMatrix);
        } else {
          matrix.makeTranslation(post.x, post.baseY + POST_HEIGHT / 2, post.z);
          posts.setMatrixAt(slot, matrix);
        }
      }
      if (passed) continue;
      const dimMul = dim ? DIM_FACTOR : 1;
      if (p.finish) {
        for (let c = 0; c < CHEQUER_COLS; c++) {
          for (let r = 0; r < CHEQUER_ROWS; r++) {
            const rowH = (BANNER_TOP - BANNER_BOTTOM) / CHEQUER_ROWS;
            writeQuad(
              p.left,
              p.right,
              c / CHEQUER_COLS,
              (c + 1) / CHEQUER_COLS,
              BANNER_BOTTOM + r * rowH,
              BANNER_BOTTOM + (r + 1) * rowH,
              (c + r) % 2 === 0 ? CHEQUER_DARK : CHEQUER_LIGHT,
              (nextIndex === null || g === nextIndex ? 1 : LATER_ALPHA) * dimMul,
            );
          }
        }
      } else {
        let alpha = 1;
        colorOut.copy(NEUTRAL_COLOR);
        if (nextIndex !== null) {
          if (g === nextIndex) colorOut.copy(NEXT_COLOR);
          else {
            colorOut.copy(LATER_COLOR);
            alpha = LATER_ALPHA;
          }
        }
        writeQuad(p.left, p.right, 0, 1, BANNER_BOTTOM, BANNER_TOP, colorOut, alpha * dimMul);
      }
    }
    const next = nextIndex === null ? undefined : placements[nextIndex];
    if (next !== undefined) writeChevrons(next);
    posts.instanceMatrix.needsUpdate = true;
    bannerGeometry.setDrawRange(0, quad * 6);
    (bannerGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (bannerGeometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

    // Beam at the next gate / finish only.
    const target = nextIndex === null ? undefined : placements[nextIndex];
    if (target === undefined) {
      beam.visible = false;
    } else {
      const cx = (target.left.x + target.right.x) / 2;
      const cz = (target.left.z + target.right.z) / 2;
      beam.position.set(cx, heightAt(cx, cz) + BEAM_HEIGHT / 2, cz);
      beam.visible = true;
    }
  }

  return {
    group,
    setStage(course): void {
      if (course === null) {
        placements = [];
      } else {
        const build = (
          point: { x: number; z: number; headingRad: number },
          widthM: number,
          finish: boolean,
        ): Placement => {
          const rx = Math.cos(point.headingRad);
          const rz = -Math.sin(point.headingRad);
          const half = widthM / 2;
          return {
            left: makePost(point.x - rx * half, point.z - rz * half),
            right: makePost(point.x + rx * half, point.z + rz * half),
            finish,
            x: point.x,
            z: point.z,
            headingRad: point.headingRad,
          };
        };
        placements = [
          ...course.gates.slice(0, MAX_GATES - 1).map((g) => build(g, g.widthM, false)),
          build(course.finish, course.finish.widthM, true),
        ];
      }
      rebuild();
    },
    update(next): void {
      if (next === nextIndex) return;
      nextIndex = next;
      rebuild();
    },
    setDim(next): void {
      dim = next;
      rebuild();
    },
    dispose(): void {
      group.removeFromParent();
      postGeometry.dispose();
      postMaterial.dispose();
      posts.dispose();
      bannerGeometry.dispose();
      bannerMaterial.dispose();
      beamGeometry.dispose();
      beamMaterial.dispose();
    },
  };
}
