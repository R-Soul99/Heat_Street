/**
 * P43-RENDER (04.3-09): debug-only terrain texture-LOD cost for the profiler
 * HUD — average `updateTextures` ms over the frames since the last HUD read,
 * plus chunk-texture rebuilds in a rolling second.
 *
 * Lives under `src/debug/` because it reads the wall clock, which the layering
 * guard (T-01-26) confines to `src/loop.ts` and `src/debug/**`.
 */
export interface TerrainTexTimer {
  /** Mark the start of this frame's texture updates. */
  begin(): void;
  /** Record `rebuilt` chunk-texture rebuilds this frame. */
  rebuilt(count: number): void;
  /** Close this frame's timing window. */
  end(): void;
  /** Read and reset the averaged ms; flips/s is the rolling-second count. */
  sample(): { terrainTexMs: number; lodFlipsPerSec: number };
}

export function createTerrainTexTimer(): TerrainTexTimer {
  let t0 = 0;
  let ms = 0;
  let frames = 0;
  const flips: number[] = [];
  return {
    begin() {
      t0 = performance.now();
    },
    rebuilt(count) {
      if (count <= 0) return;
      const now = performance.now();
      for (let k = 0; k < count; k++) flips.push(now);
    },
    end() {
      const now = performance.now();
      ms += now - t0;
      frames++;
      while (flips.length > 0 && now - flips[0] > 1000) flips.shift();
    },
    sample() {
      const terrainTexMs = frames > 0 ? ms / frames : 0;
      ms = 0;
      frames = 0;
      return { terrainTexMs, lodFlipsPerSec: flips.length };
    },
  };
}
