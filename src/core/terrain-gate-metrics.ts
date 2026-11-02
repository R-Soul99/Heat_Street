/**
 * Pure metric functions and threshold evaluation for the D-01 prototype gate.
 *
 * Thresholds are derived from a flat-ground baseline measured in the SAME run
 * (threshold = max(factor * baseline, floor)); nothing here hard-codes a
 * measured number. GATE_FACTORS / GATE_FLOORS are the initial D-01 discretion
 * values; only the plan 06 human checkpoint may change them.
 *
 * Layering: pure, no three/rapier/DOM.
 */

export const GATE_FACTORS = { jitter: 1.5, maxTickDrop: 0.02, flatTolerance: 0.01 } as const;

/** Absolute floors so a near-zero flat baseline cannot make the gate unpassable. */
export const GATE_FLOORS = {
  verticalJitterMs: 0.02,
  suspensionJitterM: 0.005,
  speedJitterMs: 0.05,
} as const;

/** One lane/speed/direction run. */
export interface GateLaneMetrics {
  readonly laneId: string;
  readonly speedMs: number;
  readonly direction: 1 | -1;
  readonly colliderSubdiv: 1 | 2;
  /** High-pass RMS of chassis vertical velocity (m/s). */
  readonly verticalJitterMs: number;
  /** Worst-wheel high-pass RMS of suspension length (m). */
  readonly suspensionJitterM: number;
  /** Ticks with fewer than four wheels in contact. */
  readonly contactLossTicks: number;
  /** High-pass RMS of forward speed (m/s). */
  readonly speedJitterMs: number;
  /** Largest single-tick speed drop as a fraction of the target speed. */
  readonly maxTickDrop: number;
  readonly ticks: number;
}

/** RMS of (value - centred moving average over `window` samples). */
export function highPassRms(values: ArrayLike<number>, window: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const half = Math.floor(window / 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let avg = 0;
    for (let j = lo; j <= hi; j++) avg += values[j];
    avg /= hi - lo + 1;
    const d = values[i] - avg;
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

/** Largest per-tick speed drop divided by the target speed (0 if speed never drops). */
export function maxTickDropRatio(speeds: ArrayLike<number>, targetSpeed: number): number {
  let worst = 0;
  for (let i = 1; i < speeds.length; i++) {
    const drop = speeds[i - 1] - speeds[i];
    if (drop > worst) worst = drop;
  }
  return targetSpeed > 0 ? worst / targetSpeed : 0;
}

export interface GateMetricVerdict {
  readonly lane: string;
  readonly speedMs: number;
  readonly direction: 1 | -1;
  readonly colliderSubdiv: 1 | 2;
  readonly metric: string;
  readonly value: number;
  readonly threshold: number;
  readonly pass: boolean;
}

export interface GateRegressionVerdict {
  readonly id: string;
  readonly legacy: number;
  readonly terrain: number;
  readonly relDiff: number;
  readonly pass: boolean;
}

export interface GateVerdict {
  readonly metrics: readonly GateMetricVerdict[];
  readonly regression: readonly GateRegressionVerdict[];
  readonly pass: boolean;
}

function check(
  m: GateLaneMetrics,
  metric: string,
  value: number,
  threshold: number,
): GateMetricVerdict {
  return {
    lane: m.laneId,
    speedMs: m.speedMs,
    direction: m.direction,
    colliderSubdiv: m.colliderSubdiv,
    metric,
    value,
    threshold,
    pass: value <= threshold,
  };
}

/** Relative difference with an absolute floor of 1e-6 on the denominator. */
export function relativeDiff(legacy: number, terrain: number): number {
  if (legacy === terrain) return 0;
  if (!Number.isFinite(legacy) || !Number.isFinite(terrain)) return Number.POSITIVE_INFINITY;
  return Math.abs(terrain - legacy) / Math.max(Math.abs(legacy), 1e-6);
}

export function evaluateGate(
  lanes: readonly GateLaneMetrics[],
  flat: GateLaneMetrics,
  flatRegression: readonly { id: string; legacy: number; terrain: number }[],
): GateVerdict {
  const j = GATE_FACTORS.jitter;
  const tVert = Math.max(j * flat.verticalJitterMs, GATE_FLOORS.verticalJitterMs);
  const tSusp = Math.max(j * flat.suspensionJitterM, GATE_FLOORS.suspensionJitterM);
  const tSpeed = Math.max(j * flat.speedJitterMs, GATE_FLOORS.speedJitterMs);
  const metrics: GateMetricVerdict[] = [];
  for (const m of lanes) {
    metrics.push(check(m, "verticalJitterMs", m.verticalJitterMs, tVert));
    metrics.push(check(m, "suspensionJitterM", m.suspensionJitterM, tSusp));
    metrics.push(check(m, "contactLossTicks", m.contactLossTicks, 0));
    metrics.push(check(m, "speedJitterMs", m.speedJitterMs, tSpeed));
    metrics.push(check(m, "maxTickDrop", m.maxTickDrop, GATE_FACTORS.maxTickDrop));
  }
  const regression = flatRegression.map((r) => {
    const relDiff = relativeDiff(r.legacy, r.terrain);
    return { ...r, relDiff, pass: relDiff <= GATE_FACTORS.flatTolerance };
  });
  const pass = metrics.every((m) => m.pass) && regression.every((r) => r.pass);
  return { metrics, regression, pass };
}
