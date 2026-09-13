/**
 * The visual half of SURF-02: per-surface tire-smoke/dust/spray/fleck
 * particle sprites, plus a fixed-size skid-decal ring buffer (Task 2).
 *
 * D-09 (CONTEXT.md) reads all-six-surfaces-distinct LITERALLY -- the six
 * `THREE.Points` systems below differ across FIVE independent axes (colour,
 * particle size, lifetime, emission rate, fall behaviour via
 * `riseMps`/`gravityMps2`), not colour alone, per 03-RESEARCH.md's own
 * "Anti-Patterns to Avoid" ruling out one shared system with a per-particle
 * surface attribute for this phase's simple sprite scope. D-05's
 * Dukes-of-Hazzard dust anchor (gravel/dirt_road) is delivered by giving
 * those two surfaces the lowest `slipThreshold` and the biggest, longest-
 * lived plumes -- see `SURFACE_FX_PROFILES` below.
 *
 * DEFERRED (CONTEXT.md's Deferred Ideas entry): physics-based kicked-up
 * debris (gravity-affected mud clods as real Rapier bodies) is explicitly
 * NOT this phase's job. This module is a deliberate first stage -- cheap
 * GPU sprites and a pooled decal mesh -- not the end state.
 *
 * ONE PER-SPAWN ALLOCATION THIS FILE ACCEPTS: `DecalGeometry` always builds
 * a fresh `BufferGeometry` per projection (see `spawnDecal` below), which is
 * unavoidable with the bundled addon. Because D-01's ground is a single flat
 * plane this phase, a shared `THREE.PlaneGeometry` quad laid flat just above
 * y = 0 would be allocation-free instead -- but `DecalGeometry` is kept
 * because Phase 4's real map is not flat and this pool carries forward.
 * Revisit only if profiling shows this one allocation actually matters.
 *
 * NOT tunable via lil-gui or `localStorage`: every value below is a
 * render-only constant with no persistence boundary. Wiring a third
 * clamp/parse pipeline (mirroring `src/core/vehicle-tuning.ts`'s) for
 * render-only cosmetic constants would duplicate the ASVS V5 input-
 * validation boundary 03-RESEARCH.md's "Don't Hand-Roll" section already
 * says belongs to ONE shared `src/core/tuning-utils.ts` path for genuinely
 * persisted, user-editable values -- these aren't that. Plan 03-12's
 * playtest adjusts this table by editing it directly; Vite's HMR makes that
 * change visible instantly with no rebuild.
 *
 * Layering: reads sampled state passed in as plain values (surface,
 * grounded, slip magnitude, world position) and writes only to objects this
 * module owns (its own `THREE.Points`/`THREE.Mesh` instances). Never imports
 * `@dimforge/rapier3d` in any form and contains none of
 * `tests/layering.test.ts`'s banned simulation-write identifiers
 * (`world.step`, `applyImpulse`, `setTranslation`, `setRotation`,
 * `setNextKinematic`).
 */
import * as THREE from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
import { SURFACE_TYPES, type SurfaceType } from "../core/surface-types";

/**
 * One surface's full particle + skid-decal visual profile. Every field
 * carries its own rationale in `SURFACE_FX_PROFILES` below; this interface
 * is just the shape. The `decal*` fields are consumed by plan 03-10 Task 2's
 * skid-decal pool, defined here now so the profile table is authored once.
 */
export interface SurfaceFxProfile {
  /** Flat particle colour, hex. Fed to `THREE.PointsMaterial.color`. */
  readonly colour: number;
  /** `THREE.PointsMaterial.size`, metres, before `sizeAttenuation`. */
  readonly particleSizeM: number;
  /** Seconds a particle lives before it is retired back into the pool. */
  readonly lifetimeSec: number;
  /** Baseline particles/second emitted while at least one qualifying wheel is on this surface and sliding right at `slipThreshold`. */
  readonly emitPerSec: number;
  /**
   * Combined `hypot(wheelSideImpulse, wheelForwardImpulse)` a grounded wheel
   * on this surface must exceed before this system emits at all. Calibrated
   * against a real headless measurement session (recorded in this plan's
   * SUMMARY.md) rather than guessed: a full-throttle/full-brake straight
   * line on tarmac (zero lateral slip) peaks at a combined magnitude of
   * ~61; a genuine handbrake slide peaks at ~89 combined (side impulse alone
   * reaching ~88). `SLIP_THRESHOLD_HIGH`/`_MID`/`_LOW` below are the three
   * tiers every surface picks from.
   */
  readonly slipThreshold: number;
  /** Initial upward speed, m/s, given to a freshly spawned particle. */
  readonly riseMps: number;
  /** Constant vertical acceleration, m/s^2 (negative = falls). */
  readonly gravityMps2: number;
  /** Skid-decal colour, hex -- a darker, less saturated relative of `colour`: a skid mark is a scuff, not a dust cloud. */
  readonly decalColour: number;
  /** Skid-decal projector width/height, metres (the `DecalGeometry` size's X/Y; Z is the shared, shallow `DECAL_PROJECTION_DEPTH_M`). */
  readonly decalSizeM: number;
  /** Seconds a skid decal takes to fade from opaque to invisible. */
  readonly decalLifetimeSec: number;
}

/**
 * `[MEASURED]` -- a throwaway headless Vitest script (`createVehicle` +
 * `createWorld`, no `Routine` harness needed since raw
 * `wheelSideImpulse`/`wheelForwardImpulse` reads were wanted, not a
 * `RoutineResult`) drove three scenarios against `defaultTuning()` on flat
 * tarmac and logged `Math.hypot(wheelSideImpulse(i), wheelForwardImpulse(i))`
 * for the rear wheels every tick:
 *   - Straight-line full throttle (zero steer): forward impulse alone peaks
 *     at 60.83 (== `engineForcePerRearWheel` (3650 N) * `DT`), side impulse
 *     stays at essentially zero (1e-6 to 1e-8) -- confirming forward impulse
 *     tracks COMMANDED engine force, not slip, and that ordinary full-throttle
 *     driving must sit BELOW tarmac's threshold.
 *   - A scripted handbrake slide (full lock + handbrake, tick 180-300): side
 *     impulse climbs from ~8 at slide onset to a peak of 87.98, forward
 *     impulse simultaneously DROPS to 15.45 at that same peak (the friction-
 *     circle clamp trading forward grip for lateral grip) -- combined
 *     magnitude peaks at ~89.3.
 *   - Sustained gentle cornering (0.15 steer fraction, throttle 0.5): side
 *     impulse reaches 68.29 -- confirming even non-handbrake cornering can
 *     approach handbrake-slide magnitudes given enough sustained steer.
 * `SLIP_THRESHOLD_HIGH` sits above the full-throttle/full-brake ceiling
 * (~61) so ordinary tarmac driving never trips it. `SLIP_THRESHOLD_LOW` sits
 * far enough above the near-zero straight-line-idle floor (~0) that a parked
 * or gently-coasting car stays silent, but low enough to catch ordinary
 * throttle application early -- the D-05 anchor's "starts early" half.
 * `SLIP_THRESHOLD_MID` sits between the two.
 */
const SLIP_THRESHOLD_HIGH = 65;
const SLIP_THRESHOLD_MID = 30;
const SLIP_THRESHOLD_LOW = 12;

/**
 * D-08's colour language (grey smoke/tarmac, tan-brown dust/gravel-dirt,
 * green-tinted/grass, pale/sand, dark spray/mud) plus D-05's anchor (gravel
 * and dirt_road get the lowest `slipThreshold` and the biggest, heaviest,
 * longest-lived plumes) and D-09's five-axis distinctness requirement.
 * `slipThreshold` is one of the three tiers above, chosen per-surface
 * feel, not recomputed per surface.
 */
export const SURFACE_FX_PROFILES: { readonly [K in SurfaceType]: SurfaceFxProfile } = {
  /**
   * Baseline. Grey tire smoke, only under genuinely heavy slip -- a car
   * cruising (or accelerating/braking hard in a straight line) on tarmac
   * must produce nothing, which is exactly what `SLIP_THRESHOLD_HIGH`
   * (above the measured ~61 full-throttle/full-brake ceiling) guarantees.
   */
  tarmac: {
    colour: 0x9aa0a8,
    particleSizeM: 0.9,
    lifetimeSec: 0.8,
    emitPerSec: 30,
    slipThreshold: SLIP_THRESHOLD_HIGH,
    riseMps: 1.2,
    gravityMps2: -0.4,
    decalColour: 0x101014,
    decalSizeM: 1.4,
    decalLifetimeSec: 8,
  },
  /**
   * The D-05 anchor's first half: a big, obvious tan plume that starts
   * early (`SLIP_THRESHOLD_LOW`), rises higher and hangs longer than
   * tarmac's smoke -- "heavy, obviously dusty" per the user's own words in
   * CONTEXT.md.
   */
  gravel: {
    colour: 0xc7b48a,
    particleSizeM: 1.6,
    lifetimeSec: 1.3,
    emitPerSec: 90,
    slipThreshold: SLIP_THRESHOLD_LOW,
    riseMps: 2.2,
    gravityMps2: -0.9,
    decalColour: 0x6b5c3f,
    decalSizeM: 1.8,
    decalLifetimeSec: 6,
  },
  /**
   * The D-05 anchor's other half: browner and the single heaviest plume
   * (`emitPerSec` 100 is the table's maximum) of the six.
   */
  dirt_road: {
    colour: 0xb08a5e,
    particleSizeM: 1.7,
    lifetimeSec: 1.4,
    emitPerSec: 100,
    slipThreshold: SLIP_THRESHOLD_LOW,
    riseMps: 2.4,
    gravityMps2: -0.9,
    decalColour: 0x5a4128,
    decalSizeM: 1.9,
    decalLifetimeSec: 6,
  },
  /**
   * Small green flecks that fall fast (steepest `gravityMps2` short of mud)
   * rather than hanging as a dust cloud -- grass sheds cut blades and dirt,
   * not a plume. `SLIP_THRESHOLD_MID` sits between tarmac's high bar and the
   * loose surfaces' low one.
   */
  grass: {
    colour: 0x6e9a5a,
    particleSizeM: 0.7,
    lifetimeSec: 0.6,
    emitPerSec: 45,
    slipThreshold: SLIP_THRESHOLD_MID,
    riseMps: 1.6,
    gravityMps2: -3.0,
    decalColour: 0x2d3a24,
    decalSizeM: 1.3,
    decalLifetimeSec: 5,
  },
  /**
   * Pale, wide, hangs almost as long as gravel -- sand kicks up a broad,
   * pale cloud rather than a directed plume.
   */
  sand: {
    colour: 0xe0cf9b,
    particleSizeM: 1.5,
    lifetimeSec: 1.2,
    emitPerSec: 80,
    slipThreshold: SLIP_THRESHOLD_LOW,
    riseMps: 1.8,
    gravityMps2: -1.4,
    decalColour: 0x8a7a52,
    decalSizeM: 1.9,
    decalLifetimeSec: 5,
  },
  /**
   * Spray, not dust: heavier particles that arc back down quickly (steepest
   * `gravityMps2` of the six) -- mud is flung, not lofted.
   */
  mud: {
    colour: 0x6b4a30,
    particleSizeM: 1.1,
    lifetimeSec: 0.9,
    emitPerSec: 60,
    slipThreshold: SLIP_THRESHOLD_LOW,
    riseMps: 1.4,
    gravityMps2: -5.0,
    decalColour: 0x2e1f14,
    decalSizeM: 1.6,
    decalLifetimeSec: 10,
  },
};

/** Fixed particle-pool capacity, per surface. Never grown -- a full pool simply declines to emit (T-03-03). */
const PARTICLE_POOL_SIZE = 96;

/** Height above a spawning wheel's contact point a fresh particle starts at, metres. */
const PARTICLE_SPAWN_HEIGHT_OFFSET_M = 0.05;

/** Horizontal jitter applied to a fresh particle's spawn position, metres -- keeps four wheels' particles from stacking at one exact point. */
const PARTICLE_SPAWN_JITTER_M = 0.3;

/** Fixed skid-decal ring-buffer capacity, shared by the allocation loop and the write-cursor's wrap arithmetic -- a single named constant so the two can never silently diverge. */
const DECAL_POOL_SIZE = 48;

/** Minimum travel, metres, a wheel must cover since its last decal before it may spawn another -- the gate that stops a stationary spinning wheel from consuming the whole ring buffer in one second. */
const DECAL_MIN_SPACING_M = 1.2;

/** Shallow decal-projector depth along the surface normal, metres -- D-01's ground is a flat plane this phase, so this only needs to be a few centimetres either side of it. */
const DECAL_PROJECTION_DEPTH_M = 0.4;

/**
 * Upper bound on the emission-rate multiplier `1 + excess/threshold` can
 * reach -- an unbounded multiplier would let an extreme (or adversarial/NaN
 * clamped-to-Infinity) slip reading spike the emission rate arbitrarily,
 * even though the fixed pool already caps the RESULT. Bounding the rate too
 * keeps the accumulator from building a large backlog that would otherwise
 * burst-spawn many particles the instant pool headroom reopens.
 */
const EMIT_RATE_EXCESS_CAP = 3;

/** Canvas size, pixels, for the runtime-generated puff texture. */
const PUFF_TEXTURE_SIZE = 64;

/**
 * Build the shared soft round puff sprite at runtime from an offscreen
 * canvas radial gradient -- no shipped PNG, no network fetch
 * (03-RESEARCH.md Assumption A6). Per-surface distinctness comes from the
 * five axes documented above `SURFACE_FX_PROFILES`, not from the sprite's
 * shape, which is why every surface safely shares this ONE texture. A6's
 * documented fallback -- a single small PNG under `public/` -- is the path
 * to take if runtime generation ever proves awkward; not needed here.
 */
function createPuffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = PUFF_TEXTURE_SIZE;
  canvas.height = PUFF_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const r = PUFF_TEXTURE_SIZE / 2;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, PUFF_TEXTURE_SIZE, PUFF_TEXTURE_SIZE);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** One surface's fixed-capacity particle system: one `THREE.Points`, one pool, no per-frame allocation. */
interface ParticleSystem {
  readonly surface: SurfaceType;
  readonly profile: SurfaceFxProfile;
  readonly points: THREE.Points;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.PointsMaterial;
  /** Stride 3, world-space. Allocated once, mutated in place forever. */
  readonly positions: Float32Array;
  /** Stride 3, `1 - ageFraction` grey multiplier -- see `createParticleSystem`'s fade comment below. */
  readonly colours: Float32Array;
  /** Stride 1, current vertical speed, m/s (integrates `gravityMps2` each frame). */
  readonly velocitiesY: Float32Array;
  /** Stride 1, seconds since spawn. */
  readonly ages: Float32Array;
  /** How many of the pool's `PARTICLE_POOL_SIZE` slots (indices `[0, liveCount)`) are currently live. */
  liveCount: number;
  /** Fractional particle debt carried across frames so emission rate is frame-rate-independent. */
  emitAccumulator: number;
  /** Round-robins across this frame's qualifying wheels so emission doesn't always spawn from the same wheel index. */
  spawnCursor: number;
}

/**
 * `THREE.PointsMaterial` has no native per-vertex alpha -- only a single
 * material-wide `opacity`, which cannot fade six-plus SIMULTANEOUSLY-live
 * particles independently by age. Rather than a hand-rolled `ShaderMaterial`
 * (beyond this phase's simple-sprite scope, 03-RESEARCH.md's own framing for
 * this file), each particle's fade is approximated with `vertexColors`: a
 * per-vertex grey multiplier (1 at spawn, decaying to 0 at end of life) on
 * top of the material's own flat `color`. This is a genuine, documented
 * trade-off -- a particle visibly darkens as it fades rather than losing
 * true alpha -- acceptable for this phase's low-poly stylised sprites, with
 * a real per-vertex-alpha shader as the concrete future upgrade if a
 * playtest finds the darkening reads wrong.
 */
function createParticleSystem(
  surface: SurfaceType,
  profile: SurfaceFxProfile,
  puffTexture: THREE.CanvasTexture,
): ParticleSystem {
  const positions = new Float32Array(PARTICLE_POOL_SIZE * 3);
  const colours = new Float32Array(PARTICLE_POOL_SIZE * 3);
  const velocitiesY = new Float32Array(PARTICLE_POOL_SIZE);
  const ages = new Float32Array(PARTICLE_POOL_SIZE);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    map: puffTexture,
    color: profile.colour,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    size: profile.particleSizeM,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.visible = false;
  points.frustumCulled = false;

  return {
    surface,
    profile,
    points,
    geometry,
    material,
    positions,
    colours,
    velocitiesY,
    ages,
    liveCount: 0,
    emitAccumulator: 0,
    spawnCursor: 0,
  };
}

/** Spawn one particle into `sys`'s pool at `position`, with jitter. Caller must have already checked `sys.liveCount < PARTICLE_POOL_SIZE`. */
function spawnParticle(sys: ParticleSystem, position: THREE.Vector3): void {
  const i = sys.liveCount;
  const o = i * 3;
  sys.positions[o] = position.x + (Math.random() - 0.5) * PARTICLE_SPAWN_JITTER_M;
  sys.positions[o + 1] = position.y + PARTICLE_SPAWN_HEIGHT_OFFSET_M;
  sys.positions[o + 2] = position.z + (Math.random() - 0.5) * PARTICLE_SPAWN_JITTER_M;
  sys.colours[o] = 1;
  sys.colours[o + 1] = 1;
  sys.colours[o + 2] = 1;
  sys.velocitiesY[i] = sys.profile.riseMps * (0.75 + Math.random() * 0.5);
  sys.ages[i] = 0;
  sys.liveCount++;
}

/** Swap live-particle slots `a` and `b` within `sys`'s pool -- the compaction step a retirement uses to keep `[0, liveCount)` contiguous with no allocation. */
function swapParticle(sys: ParticleSystem, a: number, b: number): void {
  if (a === b) return;
  for (let k = 0; k < 3; k++) {
    const pTmp = sys.positions[a * 3 + k];
    sys.positions[a * 3 + k] = sys.positions[b * 3 + k];
    sys.positions[b * 3 + k] = pTmp;
    const cTmp = sys.colours[a * 3 + k];
    sys.colours[a * 3 + k] = sys.colours[b * 3 + k];
    sys.colours[b * 3 + k] = cTmp;
  }
  const vTmp = sys.velocitiesY[a];
  sys.velocitiesY[a] = sys.velocitiesY[b];
  sys.velocitiesY[b] = vTmp;
  const aTmp = sys.ages[a];
  sys.ages[a] = sys.ages[b];
  sys.ages[b] = aTmp;
}

/** Module-scope scratch: which of the (at most 4) wheels qualify for a given surface this frame. Reused across every system's per-frame scan so `update` allocates nothing (mirrors `vehicle-view.ts`'s `SCRATCH_AXLE` convention). */
const QUALIFYING_WHEEL_INDICES = new Int8Array(4);

/** One render frame's input for one wheel. */
export interface SurfaceFxWheelInput {
  readonly surface: SurfaceType;
  readonly grounded: boolean;
  /** Combined slip magnitude -- see `SurfaceFxProfile.slipThreshold`'s doc comment for how this is expected to be derived. */
  readonly slip: number;
  readonly position: THREE.Vector3;
}

export interface SurfaceFx {
  readonly group: THREE.Group;
  /**
   * Advance every particle system and skid decal by one render frame.
   * Allocates nothing beyond the one documented per-spawn `DecalGeometry`
   * exception: reuses module- and pool-level scratch state otherwise.
   * `dtMs` is a variable RENDER-frame delta, matching every other render-
   * tier `update` in this codebase -- never the fixed physics tick.
   */
  update(wheels: readonly SurfaceFxWheelInput[], dtMs: number): void;
  /** Dispose every geometry, material and texture this module created. */
  dispose(): void;
}

/**
 * One skid-decal ring-buffer slot: a persistent `Mesh` + persistent per-slot
 * material clone (mutated in place at every spawn, never re-cloned -- only
 * `DecalGeometry` itself is the one per-spawn allocation this module
 * deliberately accepts), reassigned to a fresh `DecalGeometry` on every
 * (re)spawn.
 */
interface DecalSlot {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  geometry: THREE.BufferGeometry;
  active: boolean;
  ageSec: number;
  lifetimeSec: number;
}

/**
 * Build the six per-surface particle systems and the skid-decal ring
 * buffer. `zoneMeshes`/`zoneSurfaces` are the `DecalGeometry` projection
 * targets -- parallel arrays, same order, exactly `src/render/surface-
 * view.ts`'s `SurfaceWorldView.zoneMeshes` and `SURFACE_ZONE_ORDER`.
 */
export function createSurfaceFx(
  zoneMeshes: readonly THREE.Mesh[],
  zoneSurfaces: readonly SurfaceType[],
): SurfaceFx {
  const group = new THREE.Group();

  const puffTexture = createPuffTexture();

  // Exactly one `new THREE.Points` call, inside this six-iteration
  // construction loop -- never called again from `update`.
  const systems = {} as Record<SurfaceType, ParticleSystem>;
  for (const surface of SURFACE_TYPES) {
    const sys = createParticleSystem(surface, SURFACE_FX_PROFILES[surface], puffTexture);
    systems[surface] = sys;
    group.add(sys.points);
  }

  // ---- Skid decals: a fixed-size recycled ring buffer (T-03-03/T-03-33) ----

  const zoneMeshBySurface = new Map<SurfaceType, THREE.Mesh>();
  for (let i = 0; i < zoneSurfaces.length; i++) {
    zoneMeshBySurface.set(zoneSurfaces[i], zoneMeshes[i]);
  }

  // One template per surface, used only as the initial colour/settings seed
  // for each ring-buffer slot's persistent material clone below -- never
  // assigned directly onto a mesh, so mutating a slot's own clone at spawn
  // time can never bleed into another slot or another surface's template.
  const decalMaterialTemplates: Record<SurfaceType, THREE.MeshStandardMaterial> = {} as Record<
    SurfaceType,
    THREE.MeshStandardMaterial
  >;
  for (const surface of SURFACE_TYPES) {
    decalMaterialTemplates[surface] = new THREE.MeshStandardMaterial({
      color: SURFACE_FX_PROFILES[surface].decalColour,
      roughness: 0.9,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  }

  const decalSlots: DecalSlot[] = [];
  for (let i = 0; i < DECAL_POOL_SIZE; i++) {
    const material = decalMaterialTemplates.tarmac.clone();
    material.opacity = 0;
    const geometry = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    decalSlots.push({ mesh, material, geometry, active: false, ageSec: 0, lifetimeSec: 0 });
  }
  let decalWriteCursor = 0;

  // Per-wheel (FL/FR/RL/RR) last-decal position -- `null` until that wheel's
  // first decal, so the very first spawn is never blocked by the spacing
  // gate. Populated lazily with cloned Vector3s (once per wheel, on that
  // wheel's first spawn), then mutated in place forever after.
  const lastDecalPos: (THREE.Vector3 | null)[] = [null, null, null, null];

  // Reused scratch for every `DecalGeometry` construction -- the projector
  // position/orientation/size objects are read once by the constructor and
  // never retained, so these are safe to overwrite and reuse every spawn.
  const DECAL_POSITION = new THREE.Vector3();
  // A flat -X-rotation aligns the projector's local Z axis (its projection/
  // depth axis) with world +Y, matching D-01's flat ground -- every zone's
  // top face normal is world up this phase.
  const DECAL_ORIENTATION = new THREE.Euler(-Math.PI / 2, 0, 0);
  const DECAL_SIZE = new THREE.Vector3();

  function spawnDecal(position: THREE.Vector3, surface: SurfaceType): void {
    const zoneMesh = zoneMeshBySurface.get(surface);
    if (!zoneMesh) return; // Defensive: an unmapped surface spawns nothing rather than throwing.

    const slot = decalSlots[decalWriteCursor];
    decalWriteCursor = (decalWriteCursor + 1) % DECAL_POOL_SIZE;
    const profile = SURFACE_FX_PROFILES[surface];
    DECAL_POSITION.set(position.x, 0.02, position.z);
    DECAL_SIZE.set(profile.decalSizeM, profile.decalSizeM, DECAL_PROJECTION_DEPTH_M);

    // Dispose the previous geometry before assigning the new one below -- see
    // the module header's "one per-spawn allocation this file accepts" note:
    // `DecalGeometry` always builds a fresh `BufferGeometry` per projection.
    slot.geometry.dispose();
    const geometry = new DecalGeometry(zoneMesh, DECAL_POSITION, DECAL_ORIENTATION, DECAL_SIZE);

    slot.geometry = geometry;
    slot.mesh.geometry = geometry;
    slot.material.color.setHex(profile.decalColour);
    slot.material.opacity = 1;
    slot.mesh.visible = true;
    slot.active = true;
    slot.ageSec = 0;
    slot.lifetimeSec = profile.decalLifetimeSec;
  }

  return {
    group,

    update(wheels: readonly SurfaceFxWheelInput[], dtMs: number): void {
      const dtSec = dtMs / 1000;

      for (const surface of SURFACE_TYPES) {
        const sys = systems[surface];
        const profile = sys.profile;

        // Only systems whose surface at least one wheel is currently on may
        // emit (03-RESEARCH.md Pitfall 5) -- an idle system with zero live
        // particles costs effectively nothing, but six SIMULTANEOUSLY
        // emitting systems (a diagonal zone-boundary crossing) is the real
        // case to budget for.
        let qualifyingCount = 0;
        let maxExcess = 0;
        for (let w = 0; w < wheels.length; w++) {
          const wheel = wheels[w];
          if (wheel.grounded && wheel.surface === surface) {
            const excess = wheel.slip - profile.slipThreshold;
            if (excess > 0) {
              QUALIFYING_WHEEL_INDICES[qualifyingCount] = w;
              qualifyingCount++;
              if (excess > maxExcess) maxExcess = excess;
            }
          }
        }

        if (qualifyingCount > 0) {
          const rateMultiplier =
            1 + Math.min(maxExcess / profile.slipThreshold, EMIT_RATE_EXCESS_CAP);
          sys.emitAccumulator += profile.emitPerSec * rateMultiplier * dtSec;
          while (sys.emitAccumulator >= 1 && sys.liveCount < PARTICLE_POOL_SIZE) {
            const wheelIndex = QUALIFYING_WHEEL_INDICES[sys.spawnCursor % qualifyingCount];
            sys.spawnCursor++;
            spawnParticle(sys, wheels[wheelIndex].position);
            sys.emitAccumulator -= 1;
          }
        }

        // Integrate + retire existing live particles, compacting `[0,
        // liveCount)` in place -- no allocation, no `push`.
        let i = 0;
        while (i < sys.liveCount) {
          sys.ages[i] += dtSec;
          sys.velocitiesY[i] += profile.gravityMps2 * dtSec;
          sys.positions[i * 3 + 1] += sys.velocitiesY[i] * dtSec;
          const fade = 1 - sys.ages[i] / profile.lifetimeSec;
          if (fade <= 0) {
            const last = sys.liveCount - 1;
            swapParticle(sys, i, last);
            sys.liveCount--;
            continue; // re-check this slot -- it now holds the swapped-in particle.
          }
          sys.colours[i * 3] = fade;
          sys.colours[i * 3 + 1] = fade;
          sys.colours[i * 3 + 2] = fade;
          i++;
        }

        (sys.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (sys.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        sys.geometry.setDrawRange(0, sys.liveCount);
        // Idle systems cost nothing: skip the draw call entirely rather than
        // submitting an empty `THREE.Points` object every frame (the
        // `renderer.info.render.calls` warning sign 03-RESEARCH.md's
        // Pitfall 5 names).
        sys.points.visible = sys.liveCount > 0;
      }

      // ---- Skid decals ----
      // Interpreting "crosses its surface's slipThreshold upward" as the
      // qualifying CONDITION (grounded + slip > threshold), with the
      // DISTANCE gate as the actual repeat-spawn limiter: a strict one-shot
      // edge trigger would make the distance gate's own stated purpose ("a
      // stationary spinning wheel consuming the whole ring buffer in ONE
      // SECOND") impossible to reach in the first place, since an edge
      // trigger alone already caps a continuously-slipping stationary wheel
      // at exactly one decal. A repeated condition gated by travelled
      // distance is what actually produces a continuous skid-mark TRAIL
      // while a moving car slides, and is what the distance gate is
      // protecting against for a wheel that never moves.
      for (let w = 0; w < wheels.length; w++) {
        const wheel = wheels[w];
        if (!wheel.grounded) continue;
        const profile = SURFACE_FX_PROFILES[wheel.surface];
        if (wheel.slip <= profile.slipThreshold) continue;
        const last = lastDecalPos[w];
        if (last !== null && last.distanceTo(wheel.position) < DECAL_MIN_SPACING_M) continue;
        spawnDecal(wheel.position, wheel.surface);
        const existing = lastDecalPos[w];
        if (existing === null) {
          lastDecalPos[w] = wheel.position.clone();
        } else {
          existing.copy(wheel.position);
        }
      }

      for (let i = 0; i < DECAL_POOL_SIZE; i++) {
        const slot = decalSlots[i];
        if (!slot.active) continue;
        slot.ageSec += dtSec;
        const fade = 1 - slot.ageSec / slot.lifetimeSec;
        if (fade <= 0) {
          slot.material.opacity = 0;
          slot.mesh.visible = false;
          slot.active = false;
          continue;
        }
        slot.material.opacity = fade;
      }
    },

    dispose(): void {
      // Six particle geometries and six particle materials, plus the shared
      // texture -- unrolled rather than looped so this module's disposal
      // discipline stays visually auditable at a glance, mirroring
      // `vehicle-view.ts`'s own one-resource-per-line `dispose()` (lines
      // 441-452).
      systems.tarmac.geometry.dispose();
      systems.tarmac.material.dispose();
      systems.gravel.geometry.dispose();
      systems.gravel.material.dispose();
      systems.dirt_road.geometry.dispose();
      systems.dirt_road.material.dispose();
      systems.grass.geometry.dispose();
      systems.grass.material.dispose();
      systems.sand.geometry.dispose();
      systems.sand.material.dispose();
      systems.mud.geometry.dispose();
      systems.mud.material.dispose();
      puffTexture.dispose();

      // 48 decal geometries and 48 per-slot material clones, plus the six
      // templates those clones were seeded from -- see this plan's
      // SUMMARY.md for why every clone (not just the six templates) is
      // disposed here, beyond this plan's own threat-model shorthand.
      for (const slot of decalSlots) {
        slot.geometry.dispose();
        slot.material.dispose();
      }
      decalMaterialTemplates.tarmac.dispose();
      decalMaterialTemplates.gravel.dispose();
      decalMaterialTemplates.dirt_road.dispose();
      decalMaterialTemplates.grass.dispose();
      decalMaterialTemplates.sand.dispose();
      decalMaterialTemplates.mud.dispose();
    },
  };
}
