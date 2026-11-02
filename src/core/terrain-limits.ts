/**
 * Single home for the gate-tuned terrain constants of phase 04.2. Pure
 * constants, no imports. Values marked provisional are re-signed at the plan 06
 * prototype gate; change them HERE only.
 */

/** D-03: maximum slope (degrees) the sculpt tool lets terrain reach. Signed off at the 04.2 prototype gate on 2026-11-02. */
export const MAX_SLOPE_DEG = 35;

/** D-14 (discretion): default maximum road bank angle (degrees). Signed off at the 04.2 prototype gate on 2026-11-02. */
export const DEFAULT_MAX_BANK_DEG = 8;

/** RESEARCH "collider resolution knob": heightfield collider subdivisions per grid cell. Signed off at the 04.2 prototype gate on 2026-11-02. Plan 05 gate: lowest subdiv passing the full verdict is 2 (subdiv 1 has a 1-tick contact flicker). */
export const DEFAULT_COLLIDER_SUBDIV: 1 | 2 = 2;

/** D-02: default height-grid cell size in metres (per-grid value). */
export const DEFAULT_CELL_SIZE_M = 3;

/** D-02: default paint resolution in metres per pixel (per-map value). */
export const DEFAULT_PAINT_METRES_PER_PIXEL = 0.5;

/** D-04: maximum authored area edge length in metres. */
export const MAX_AREA_SIZE_M = 2000;
