import { describe, expect, it } from "vitest";
import { createSurfaceMap } from "../src/physics/surface";

/**
 * Wave-0 gate for `SurfaceMap` (03-VALIDATION.md). Written FIRST, before
 * `src/physics/surface.ts` exists — must fail (module not found) until Task
 * 1's implementation lands, per this plan's TDD requirement.
 */

describe("createSurfaceMap: defaults", () => {
  it("with no argument defaults unknown handles to tarmac", () => {
    const map = createSurfaceMap();
    expect(map.lookup(42)).toBe("tarmac");
  });

  it("with an explicit default surface, unknown handles resolve to it", () => {
    const map = createSurfaceMap("grass");
    expect(map.lookup(42)).toBe("grass");
  });
});

describe("createSurfaceMap: register/lookup", () => {
  it("after register(7, mud), lookup(7) returns mud", () => {
    const map = createSurfaceMap();
    map.register(7, "mud");
    expect(map.lookup(7)).toBe("mud");
  });

  it("lookup(undefined) returns the default surface — the airborne-wheel case", () => {
    // wheelGroundObject(i) returning null and `?.handle` producing
    // `undefined` is the exact shape the vehicle tick hands this function.
    const map = createSurfaceMap("sand");
    expect(map.lookup(undefined)).toBe("sand");
  });

  it("lookup(999) for an unregistered handle returns the default surface, does not throw", () => {
    const map = createSurfaceMap();
    expect(() => map.lookup(999)).not.toThrow();
    expect(map.lookup(999)).toBe("tarmac");
  });

  it("register called twice for the same handle keeps the last value", () => {
    const map = createSurfaceMap();
    map.register(3, "gravel");
    map.register(3, "dirt_road");
    expect(map.lookup(3)).toBe("dirt_road");
  });

  it("a handle of 0 is a legitimate Rapier handle, not falsy/absent", () => {
    // register(0, ...) must not be confused with "no handle" — lookup uses
    // an explicit `=== undefined` check, never a truthiness test.
    const map = createSurfaceMap();
    map.register(0, "sand");
    expect(map.lookup(0)).toBe("sand");
  });
});
