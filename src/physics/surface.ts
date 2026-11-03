/**
 * `SurfaceMap`: a `ColliderHandle -> SurfaceType` side-table, plus the
 * `SurfaceContext` `Vehicle.tick()` consumes (plan 03-03 Task 2).
 *
 * Verified against the installed `@dimforge/rapier3d@0.20.0` `.d.ts` files
 * (03-RESEARCH.md "Surface-to-Collider Mapping"): `Collider`/`ColliderDesc`
 * have NO `userData` slot at all in this binding — grepping the package
 * finds `setUserData`/`.userData` only on `RigidBodyDesc`/`RigidBody`. The
 * alternative that DOES work, `wheelGroundObject(i)?.parent()?.userData`,
 * allocates a fresh `RigidBody` WASM wrapper object on every call for every
 * wheel every tick (up to 4 allocations/tick, forever) — this side-table
 * exists specifically to avoid that per-tick allocation, not as an
 * arbitrary style choice. This closes CLAUDE.md's "Gaps / Open Items"
 * entry on surface-type-to-collider mapping (user data vs. a
 * `Map<colliderHandle, SurfaceType>` vs. collision groups): collider-level
 * userData does not exist in this binding, so the real choice was between
 * this `Map`-backed side-table and the allocating `.parent()` path above —
 * resolved in favour of the `Map`. Consider this gap closed; do not reopen
 * it in a future phase without new evidence the shipped binding has changed.
 *
 * Built once at scene-construction time (`register` calls happen inside the
 * surface-zone collider construction loop), read every physics tick
 * (`lookup`), with zero per-tick allocation — the same "allocate once at
 * construction, write/read in place forever" discipline
 * `src/physics/transform-cache.ts` already establishes for its typed-array
 * buffers.
 *
 * Layering: may import `@dimforge/rapier3d` and `src/core/`. Must not import
 * `three` and must not touch the DOM or any wall clock.
 */

import type { SurfaceProfiles } from "../core/surface-tuning";
import type { SurfaceType } from "../core/surface-types";
import { decodePaintSurface, type PaintMap, paintIndexAt } from "../core/terrain-paint";

/**
 * `register`/`lookup` over a `ColliderHandle -> SurfaceType` table. `lookup`
 * never throws — an unregistered or absent handle degrades to the map's
 * configured default surface (T-03-08).
 */
export interface SurfaceMap {
  register(colliderHandle: number, surface: SurfaceType): void;
  /** Drop a handle (a removed collider, e.g. a retired wheel-ray patch window). */
  unregister(colliderHandle: number): void;
  lookup(colliderHandle: number | undefined): SurfaceType;
}

/**
 * Build an empty `SurfaceMap` defaulting unregistered/absent handles to
 * `defaultSurface` (default `"tarmac"`). Backed by a private
 * `Map<number, SurfaceType>` — plain `number` keys, zero extra WASM-wrapper
 * allocation per registration or lookup.
 */
export function createSurfaceMap(defaultSurface: SurfaceType = "tarmac"): SurfaceMap {
  const table = new Map<number, SurfaceType>();
  return {
    register(colliderHandle: number, surface: SurfaceType): void {
      table.set(colliderHandle, surface);
    },
    unregister(colliderHandle: number): void {
      table.delete(colliderHandle);
    },
    lookup(colliderHandle: number | undefined): SurfaceType {
      // Explicit `=== undefined` check, NEVER a truthiness test — handle `0`
      // is a legitimate Rapier ColliderHandle and must not be treated as
      // absent. `undefined` itself arises from the airborne-wheel case:
      // `wheelGroundObject(i)` returned `null` and `?.handle` produced
      // `undefined`.
      if (colliderHandle === undefined) {
        return defaultSurface;
      }
      return table.get(colliderHandle) ?? defaultSurface;
    },
  };
}

/**
 * The single object `Vehicle.tick()` takes for surface-aware friction (plan
 * 03-03 Task 2). Bundling `map` and `profiles` here means a future
 * per-surface field is a one-line addition at every call site instead of a
 * signature churn across `src/physics/vehicle.ts` and every caller.
 */
export interface SurfaceContext {
  readonly map: SurfaceMap;
  readonly profiles: SurfaceProfiles;
  /**
   * Position-based surface lookup for a terrain collider (one heightfield with
   * ONE handle, so the handle cannot say which surface a wheel is on). When
   * present, wheels whose ground collider is `paint.colliderHandle` read the
   * paint map at their contact point; every other collider uses `map`.
   */
  readonly paint?: SurfacePaintLookup;
}

/** Position-based surface lookup bound to the terrain collider's handle. */
export interface SurfacePaintLookup {
  readonly colliderHandle: number;
  /**
   * Extra collider handles that are the SAME surface as `colliderHandle` (the
   * per-vehicle wheel-ray patch trimeshes). Mutated by the patch as windows
   * are rebuilt; a wheel standing on any of them reads this paint map.
   */
  readonly aliasHandles?: Set<number>;
  surfaceAt(x: number, z: number): SurfaceType;
  /**
   * Another painted heightfield in the same scene (e.g. the 04.2 gate course
   * beside feel-test). Wheels on `next.colliderHandle` read `next`'s paint.
   */
  readonly next?: SurfacePaintLookup;
}

/**
 * Build a `SurfacePaintLookup` closing over a paint map. No per-call
 * allocation: `paintIndexAt` + `decodePaintSurface` are allocation-free.
 */
export function createPaintLookup(
  colliderHandle: number,
  paint: PaintMap,
  fallback: SurfaceType,
  next?: SurfacePaintLookup,
): SurfacePaintLookup {
  return {
    colliderHandle,
    aliasHandles: new Set<number>(),
    surfaceAt(x: number, z: number): SurfaceType {
      const i = paintIndexAt(paint, x, z);
      return i < 0 ? fallback : decodePaintSurface(paint.data[i], fallback);
    },
    next,
  };
}
