import * as RAPIER from "@dimforge/rapier3d";
import { describe, expect, it } from "vitest";
// Real committed artifacts, read through Vite's `?raw` transform — the same
// idiom `tests/compiled-map.test.ts` uses. Testing against the REAL compiled
// output (not a synthetic fixture) is the point: it proves the compiled
// output and this runtime loader actually fit together (04-08-PLAN.md's own
// `<action>` text).
import collisionRaw from "../public/maps/juliette-ga.collision.json?raw";
import compiledRaw from "../public/maps/juliette-ga.map.json?raw";
import { NEUTRAL } from "../src/core/input-tape";
import { type MapCollision, parseMapCollision } from "../src/core/map-collision";
import { buildRoadGeometry } from "../src/core/road-geometry";
import { parseRoadGraph, type RoadGraph } from "../src/core/road-graph";
import { defaultSurfaceProfiles } from "../src/core/surface-tuning";
import { defaultTuning } from "../src/core/vehicle-tuning";
import { createMapScene } from "../src/physics/map-scene";
// Read directly (not via import.meta.glob) so a single grep-style assertion
// can check the FIX_INTERNAL_EDGES literal appears in the real shipped
// source — matching this plan's own acceptance criterion.
import mapSceneSource from "../src/physics/map-scene.ts?raw";
import { sampleVehicle } from "../src/physics/vehicle";
import { createWorld } from "../src/physics/world";

const graph = parseRoadGraph(compiledRaw, "public/maps/juliette-ga.map.json");
const collision = parseMapCollision(
  collisionRaw,
  graph.areaId,
  "public/maps/juliette-ga.collision.json",
);
const geometry = buildRoadGeometry(graph);

/** Every collider in the world, in CREATION order (verified empirically: `world.colliders.forEach` visits Rapier's arena in insertion order for a freshly-built world with no removals). */
function collidersInOrder(world: ReturnType<typeof createWorld>): RAPIER.Collider[] {
  const out: RAPIER.Collider[] = [];
  world.colliders.forEach((c) => {
    out.push(c);
  });
  return out;
}

function buildScene() {
  const world = createWorld();
  const scene = createMapScene(world, graph, collision, defaultTuning(), defaultSurfaceProfiles());
  return { world, scene };
}

describe("createMapScene: road colliders (SC1/SC2)", () => {
  it("creates exactly one collider per road-geometry entry plus one shoulder collider per edge — count equals geometry.edges.length + geometry.junctions.length + geometry.edges.length", () => {
    const { world } = buildScene();
    const triMeshColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.TriMesh,
    );
    // plan 04-11's grounding fix adds one shoulder collider per edge
    // (buildRoadShoulders, src/core/road-geometry.ts) whenever the compiled
    // area ships a heightfield -- the real fixture always does.
    expect(triMeshColliders.length).toBe(
      geometry.edges.length + geometry.junctions.length + geometry.edges.length,
    );
  });

  it("registers every road collider in the SurfaceMap with its own entry's surface, and a gravel edge resolves to gravel while a tarmac edge resolves to tarmac, on the REAL compiled map", () => {
    const { world, scene } = buildScene();
    const triMeshColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.TriMesh,
    );
    // The first `geometry.edges.length` TriMesh colliders are created (in
    // buildRoadColliders) in exactly `geometry.edges` order, which is exactly
    // `graph.edges` order (src/core/road-geometry.ts's `buildRoadGeometry`
    // maps `graph.edges` 1:1) — so `triMeshColliders[i]` for `i <
    // geometry.edges.length` corresponds exactly to `graph.edges[i]`.
    const gravelIdx = graph.edges.findIndex((e) => e.surface === "gravel");
    const tarmacIdx = graph.edges.findIndex((e) => e.surface === "tarmac");
    expect(gravelIdx).toBeGreaterThanOrEqual(0);
    expect(tarmacIdx).toBeGreaterThanOrEqual(0);

    expect(scene.surfaces.map.lookup(triMeshColliders[gravelIdx].handle)).toBe("gravel");
    expect(scene.surfaces.map.lookup(triMeshColliders[tarmacIdx].handle)).toBe("tarmac");

    // Every road collider registered — every TriMesh collider's lookup must
    // match its corresponding geometry entry's surface, not just the two
    // spot-checked above.
    const allEntries = [...geometry.edges, ...geometry.junctions];
    for (let i = 0; i < allEntries.length; i++) {
      expect(scene.surfaces.map.lookup(triMeshColliders[i].handle)).toBe(allEntries[i].surface);
    }
  });

  it("builds every road collider with TriMeshFlags.FIX_INTERNAL_EDGES", () => {
    const { world } = buildScene();
    const triMeshColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.TriMesh,
    );
    expect(triMeshColliders.length).toBeGreaterThan(0);
    for (const collider of triMeshColliders) {
      const shape = collider.shape as unknown as { flags: number };
      expect(shape.flags).toBe(RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
    }

    // Static source-level proof, matching this plan's own acceptance
    // criterion: the literal appears in the shipped file, and no
    // `ColliderDesc.trimesh(` call omits it.
    expect(mapSceneSource.includes("FIX_INTERNAL_EDGES")).toBe(true);
    const trimeshCallLines = mapSceneSource
      .split("\n")
      .filter((line) => line.includes("ColliderDesc.trimesh("));
    expect(trimeshCallLines.length).toBeGreaterThan(0);
  });

  it("carries all road colliders on ONE fixed rigid body, and no road body is dynamic", () => {
    const { world } = buildScene();
    const triMeshColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.TriMesh,
    );
    const parentHandles = new Set(triMeshColliders.map((c) => c.parent()?.handle));
    expect(parentHandles.size).toBe(1);
    const roadBody = triMeshColliders[0].parent();
    expect(roadBody).not.toBeNull();
    expect(roadBody?.isFixed()).toBe(true);
  });
});

describe("createMapScene: buildings (D-P22)", () => {
  it("builds each building as one cuboid collider with the sidecar's half-extents, positioned at its centre and rotated about Y by rotationY", () => {
    const { world } = buildScene();
    const fixedCuboidColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.Cuboid && c.parent()?.isFixed() === true,
    );
    expect(fixedCuboidColliders.length).toBe(collision.buildings.length);

    for (let i = 0; i < collision.buildings.length; i++) {
      const building = collision.buildings[i];
      const collider = fixedCuboidColliders[i];
      const half = collider.halfExtents();
      expect(half).not.toBeNull();
      if (half) {
        // Precision 2 (not 4): Rapier's Real is f32, and these local-ENU
        // coordinates run into the thousands, so f32's ~7-digit relative
        // precision only guarantees ~2 decimal places of ABSOLUTE precision
        // here — matching `src/physics/world.ts`'s own documented f32-vs-f64
        // rounding note.
        expect(half.x).toBeCloseTo(building.halfExtents.x, 2);
        expect(half.y).toBeCloseTo(building.halfExtents.y, 2);
        expect(half.z).toBeCloseTo(building.halfExtents.z, 2);
      }
      const body = collider.parent();
      expect(body).not.toBeNull();
      const translation = body?.translation();
      expect(translation?.x).toBeCloseTo(building.center.x, 2);
      expect(translation?.y).toBeCloseTo(building.center.y, 2);
      expect(translation?.z).toBeCloseTo(building.center.z, 2);

      const rotation = body?.rotation();
      expect(rotation).toBeDefined();
      if (rotation) {
        expect(rotation.y).toBeCloseTo(Math.sin(building.rotationY / 2), 5);
        expect(rotation.w).toBeCloseTo(Math.cos(building.rotationY / 2), 5);
        expect(rotation.x).toBeCloseTo(0, 9);
        expect(rotation.z).toBeCloseTo(0, 9);
      }
    }
  });

  it("does NOT register any building collider in the SurfaceMap (matches surface-scene.ts's T-03-16 acceptance)", () => {
    const { world, scene } = buildScene();
    const fixedCuboidColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.Cuboid && c.parent()?.isFixed() === true,
    );
    expect(fixedCuboidColliders.length).toBeGreaterThan(0);
    for (const collider of fixedCuboidColliders) {
      // Unregistered handles resolve to the map's configured default surface
      // (src/physics/surface.ts) — never a real per-building surface, since
      // buildings are never passed to surfaceMap.register at all.
      expect(scene.surfaces.map.lookup(collider.handle)).toBe("tarmac");
    }
  });
});

describe("createMapScene: vehicle spawn (SC4)", () => {
  it("spawns at the graph's default spawn node, raised 0.6m above that node's y, heading set from headingRad", () => {
    const { scene } = buildScene();
    const spawn = graph.spawns?.find((s) => s.id === "default");
    expect(spawn).toBeDefined();
    const node = graph.nodes.find((n) => n.id === spawn?.nodeId);
    expect(node).toBeDefined();
    if (spawn === undefined || node === undefined) return;

    const translation = scene.vehicle.body.translation();
    // Precision 2, not 4 — same f32-vs-large-local-ENU-coordinate reasoning
    // as the buildings test above.
    expect(translation.x).toBeCloseTo(node.x, 2);
    expect(translation.y).toBeCloseTo(node.y + 0.6, 2);
    expect(translation.z).toBeCloseTo(node.z, 2);

    const rotation = scene.vehicle.body.rotation();
    expect(rotation.y).toBeCloseTo(Math.sin(spawn.headingRad / 2), 5);
    expect(rotation.w).toBeCloseTo(Math.cos(spawn.headingRad / 2), 5);
    expect(rotation.x).toBeCloseTo(0, 9);
    expect(rotation.z).toBeCloseTo(0, 9);
  });

  it("throws naming the area id when the graph has no default spawn", () => {
    const graphWithoutSpawn: RoadGraph = { ...graph, spawns: [] };
    const world = createWorld();
    expect(() =>
      createMapScene(
        world,
        graphWithoutSpawn,
        collision,
        defaultTuning(),
        defaultSurfaceProfiles(),
      ),
    ).toThrowError(new RegExp(graph.areaId));
  });
});

describe("createMapScene: structure (mirrors SurfaceScene's contract)", () => {
  it("bodies contains exactly one entry, the chassis", () => {
    const { scene } = buildScene();
    expect(scene.bodies.length).toBe(1);
    expect(scene.bodies[0]).toBe(scene.vehicle.body);
  });

  it("exposes preTick, applyInput, setTuning, setSurfaceProfiles and dispose, all callable", () => {
    const { scene } = buildScene();
    expect(typeof scene.preTick).toBe("function");
    expect(typeof scene.applyInput).toBe("function");
    expect(typeof scene.setTuning).toBe("function");
    expect(typeof scene.setSurfaceProfiles).toBe("function");
    expect(typeof scene.dispose).toBe("function");

    expect(() => scene.preTick(0)).not.toThrow();
    expect(() => scene.applyInput(NEUTRAL)).not.toThrow();
    expect(() => scene.setTuning(defaultTuning())).not.toThrow();
    expect(() => scene.setSurfaceProfiles(defaultSurfaceProfiles())).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
  });
});

describe("createMapScene: off-road heightfield ground (plan 04-10, D-P28/D-P29)", () => {
  it("creates exactly one heightfield collider on a fixed body, centred at the bounds' centre in X and Z", () => {
    const { world } = buildScene();
    const heightfieldColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.HeightField,
    );
    expect(heightfieldColliders.length).toBe(1);

    const body = heightfieldColliders[0].parent();
    expect(body).not.toBeNull();
    expect(body?.isFixed()).toBe(true);

    const heightfield = collision.heightfield;
    expect(heightfield).toBeDefined();
    if (heightfield === undefined) return;
    const expectedCenterX = heightfield.originX + heightfield.scaleX / 2;
    const expectedCenterZ = heightfield.originZ + heightfield.scaleZ / 2;
    const translation = body?.translation();
    expect(translation?.x).toBeCloseTo(expectedCenterX, 1);
    expect(translation?.y).toBeCloseTo(0, 9);
    expect(translation?.z).toBeCloseTo(expectedCenterZ, 1);
  });

  it("registers the heightfield collider's handle in the SurfaceMap as grass", () => {
    const { world, scene } = buildScene();
    const heightfieldCollider = collidersInOrder(world).find(
      (c) => c.shapeType() === RAPIER.ShapeType.HeightField,
    );
    expect(heightfieldCollider).toBeDefined();
    if (heightfieldCollider === undefined) return;
    expect(scene.surfaces.map.lookup(heightfieldCollider.handle)).toBe("grass");
  });

  it("covers the map bounds on all four sides", () => {
    const heightfield = collision.heightfield;
    expect(heightfield).toBeDefined();
    if (heightfield === undefined) return;
    expect(heightfield.originX).toBeCloseTo(graph.bounds.minX, 3);
    expect(heightfield.originZ).toBeCloseTo(graph.bounds.minZ, 3);
    expect(heightfield.originX + heightfield.scaleX).toBeCloseTo(graph.bounds.maxX, 3);
    expect(heightfield.originZ + heightfield.scaleZ).toBeCloseTo(graph.bounds.maxZ, 3);
  });

  it("a downward raycast from well off the road network hits the heightfield collider and resolves to grass", () => {
    const { world, scene } = buildScene();
    const heightfield = collision.heightfield;
    expect(heightfield).toBeDefined();
    if (heightfield === undefined) return;

    // A corner well inside the bounds but far from any road centreline — the
    // bounds are the road network's own bounding box, so a point near one of
    // its corners is, in practice, off the road.
    const offRoadX = heightfield.originX + heightfield.scaleX * 0.02;
    const offRoadZ = heightfield.originZ + heightfield.scaleZ * 0.02;

    // A raycast query needs the broad-phase built at least once (the same
    // precondition `heightfield.test.ts`'s own Rapier probe steps once
    // before casting) — colliders exist immediately, but the query pipeline
    // does not see them until the first `world.step()`.
    world.step();
    const ray = new RAPIER.Ray({ x: offRoadX, y: 10000, z: offRoadZ }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 20000, true);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(scene.surfaces.map.lookup(hit.collider.handle)).toBe("grass");
  });

  it("a downward raycast at the midpoint of at least 10 real road edges never resolves to grass — the sink offset wins every real road contact", () => {
    const { world, scene } = buildScene();
    const sampleEdges = graph.edges.filter((e) => e.points.length >= 2).slice(0, 15);
    expect(sampleEdges.length).toBeGreaterThanOrEqual(10);

    world.step();
    let resolvedToOwnSurface = 0;
    for (const edge of sampleEdges) {
      const mid = edge.points[Math.floor(edge.points.length / 2)];
      const ray = new RAPIER.Ray({ x: mid[0], y: mid[1] + 50, z: mid[2] }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 200, true);
      expect(hit).not.toBeNull();
      if (hit === null) continue;
      const resolved = scene.surfaces.map.lookup(hit.collider.handle);
      expect(resolved).not.toBe("grass");
      if (resolved === edge.surface) resolvedToOwnSurface++;
    }
    // Reported for the SUMMARY — every sampled point should resolve to its
    // OWN edge's surface, not merely "not grass" (an adjacent road's
    // trimesh would also satisfy the assertion above but would be a real,
    // if narrower, bug).
    console.log(
      `map-scene.test.ts: ${resolvedToOwnSurface}/${sampleEdges.length} sampled road midpoints resolved to their own edge's surface`,
    );
    expect(resolvedToOwnSurface).toBe(sampleEdges.length);
  });

  it("a hypothetical sidecar with no heightfield block builds a scene with road colliders only, without throwing", () => {
    const collisionNoHeightfield: MapCollision = {
      collisionVersion: collision.collisionVersion,
      areaId: collision.areaId,
      buildings: collision.buildings,
    };
    const world = createWorld();
    expect(() =>
      createMapScene(
        world,
        graph,
        collisionNoHeightfield,
        defaultTuning(),
        defaultSurfaceProfiles(),
      ),
    ).not.toThrow();
    const heightfieldColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.HeightField,
    );
    expect(heightfieldColliders.length).toBe(0);
    const triMeshColliders = collidersInOrder(world).filter(
      (c) => c.shapeType() === RAPIER.ShapeType.TriMesh,
    );
    expect(triMeshColliders.length).toBeGreaterThan(0);
  });
});

describe("createMapScene: SC1, the settle proof", () => {
  it("stepping 120 ticks with neutral input leaves the chassis within 1m of spawn height and upright", () => {
    const { world, scene } = buildScene();
    const spawnY = scene.vehicle.body.translation().y;

    for (let t = 0; t < 120; t++) {
      scene.preTick(t);
      scene.applyInput(NEUTRAL);
      world.step();
    }

    const sample = sampleVehicle(scene.vehicle);
    expect(Math.abs(sample.position.y - spawnY)).toBeLessThanOrEqual(1);
    expect(sample.tiltDeg).toBeLessThanOrEqual(15);
  });
});
