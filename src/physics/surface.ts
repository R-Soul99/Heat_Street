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

/**
 * `register`/`lookup` over a `ColliderHandle -> SurfaceType` table. `lookup`
 * never throws — an unregistered or absent handle degrades to the map's
 * configured default surface (T-03-08).
 */
export interface SurfaceMap {
  register(colliderHandle: number, surface: SurfaceType): void;
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
}
