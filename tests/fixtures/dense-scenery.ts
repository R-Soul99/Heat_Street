/**
 * Deterministic worst-case scenery for the D-09 triangle budget (plans 06 and 08).
 * Do not shrink it to pass a budget test.
 */
import type { TerrainBuilding, TerrainFeature } from "../../src/core/terrain-format";

function build(): { features: TerrainFeature[]; buildings: TerrainBuilding[] } {
  const features: TerrainFeature[] = [];
  const trees = [
    ...Array.from({ length: 300 }, () => "pine"),
    ...Array.from({ length: 300 }, () => "oak"),
    ...Array.from({ length: 200 }, () => "dead"),
  ];
  trees.forEach((variant, i) => {
    features.push({
      id: `tree-${i}`,
      kind: "tree",
      variant,
      x: (i % 40) * 10,
      z: Math.floor(i / 40) * 10,
      rotationY: 0,
      scale: 1,
    });
  });
  for (let i = 0; i < 400; i++) {
    features.push({
      id: `bush-${i}`,
      kind: "bush",
      variant: i < 200 ? "round" : "scrub",
      x: (i % 40) * 10 + 5,
      z: Math.floor(i / 40) * 10 + 5,
      rotationY: 0,
      scale: 1,
    });
  }
  const lineKinds: { kind: "hedge" | "fence"; variant: string }[] = [
    ...Array.from({ length: 30 }, () => ({ kind: "hedge" as const, variant: "box" })),
    // Slatted pickets cost far more than the old solid panel (11 boxes per 8 m), so the fence mix is
    // 1 post-rail + 3 picket + 6 chainlink lines: 252 + 3x1,452 + 6x492 = 7,560 triangles, the same
    // fence total as before, so the 37,900 worst case and its headroom are unchanged.
    ...Array.from({ length: 1 }, () => ({ kind: "fence" as const, variant: "post-rail" })),
    ...Array.from({ length: 3 }, () => ({ kind: "fence" as const, variant: "picket" })),
    ...Array.from({ length: 6 }, () => ({ kind: "fence" as const, variant: "chainlink" })),
  ];
  lineKinds.forEach((lk, i) => {
    features.push({
      id: `line-${i}`,
      kind: lk.kind,
      variant: lk.variant,
      points: Array.from({ length: 11 }, (_, p) => [p * 8, 200 + i * 6] as [number, number]),
      heightM: 1.5,
    });
  });
  const styles = ["shed", "house", "barn", "shop", "block"];
  const buildings: TerrainBuilding[] = [];
  for (let i = 0; i < 150; i++) {
    buildings.push({
      center: { x: (i % 15) * 30, y: 3, z: 600 + Math.floor(i / 15) * 30 },
      halfExtents: { x: 3, y: 3, z: 3 },
      rotationY: 0,
      style: styles[i % 5],
    });
  }
  return { features, buildings };
}

const built = build();
export const DENSE_FEATURES: readonly TerrainFeature[] = built.features;
export const DENSE_BUILDINGS: readonly TerrainBuilding[] = built.buildings;
