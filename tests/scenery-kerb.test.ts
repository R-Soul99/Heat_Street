import { describe, expect, it } from "vitest";
import type { InputFrame } from "../src/core/input-tape";
import type { RoadGraph } from "../src/core/road-graph";
import { FENCE_VARIANTS, HEDGE_VARIANTS } from "../src/core/scenery-catalog";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import type { TerrainFeature } from "../src/core/terrain-format";
import { createTerrainGrid } from "../src/core/terrain-grid";
import { createPaintMap } from "../src/core/terrain-paint";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createTerrainScene } from "../src/physics/terrain-scene";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const FULL: InputFrame = { steer: 0, throttle: 1, brake: 0, handbrake: false };

/** Drives at a line across x = 0 from x = -15 (+X heading). Returns final x and chassis y range. */
function run(kind: "hedge" | "fence", variant: string, heightM: number) {
  const world = createWorld();
  try {
    const grid = createTerrainGrid({
      rows: 30,
      cols: 30,
      cellSizeM: 4,
      originX: -60,
      originZ: -60,
    });
    const features: TerrainFeature[] = [
      {
        id: "l",
        kind,
        variant,
        points: [
          [0, -30],
          [0, 30],
        ],
        heightM,
      },
    ];
    const scene = createTerrainScene(
      world,
      {
        areaId: "kerb",
        grid,
        paint: createPaintMap({
          originX: -60,
          originZ: -60,
          widthM: 120,
          depthM: 120,
          metresPerPixel: 1,
          fill: "grass",
        }),
        graph: { areaId: "kerb", nodes: [], edges: [] } as unknown as RoadGraph,
        buildings: [],
        crests: [],
        groundSurface: "grass",
        features,
        spawnOverride: { x: -15, z: 0, headingRad: -Math.PI / 2 },
      },
      defaultTuning(),
      defaultSurfaceProfiles(),
    );
    let maxY = -Infinity;
    let minY = Infinity;
    let lastX = 0;
    for (let t = 0; t < 240; t++) {
      scene.applyInput(FULL);
      world.step();
      const s = sampleVehicle(scene.vehicle);
      maxY = Math.max(maxY, s.position.y);
      minY = Math.min(minY, s.position.y);
      lastX = s.position.x;
    }
    return { lastX, maxY, minY };
  } finally {
    world.free();
  }
}

describe("scenery kerb: car vs line at catalog minimum height", () => {
  const hedgeMin = HEDGE_VARIANTS[0]?.minHeightM ?? 1;
  const fenceMin = FENCE_VARIANTS[0]?.minHeightM ?? 1;

  it("does not climb over a hedge", () => {
    const r = run("hedge", "box", hedgeMin);
    console.log("kerb hedge", hedgeMin, r);
    expect(r.lastX).toBeLessThan(0);
    expect(r.maxY - r.minY).toBeLessThan(hedgeMin);
  });
  it("does not climb over a fence", () => {
    const r = run("fence", "post-rail", fenceMin);
    console.log("kerb fence", fenceMin, r);
    expect(r.lastX).toBeLessThan(0);
    expect(r.maxY - r.minY).toBeLessThan(fenceMin);
  });
  it("records the 0.5 m case", () => {
    console.log("kerb hedge 0.5 (recorded)", run("hedge", "box", 0.5));
    console.log("kerb fence 0.5 (recorded)", run("fence", "post-rail", 0.5));
  });
});
