/**
 * Pure pixel pipeline for the editor's B&W image import: threshold, speck
 * removal, Zhang-Suen thinning to a one-pixel centreline, tracing into a
 * node/path graph with shared junction nodes, spur pruning, Douglas-Peucker
 * simplification and Chaikin smoothing.
 *
 * Everything here is in PIXEL units (metres never appear). Pixel (col,row) has
 * row 0 at the top; points are pixel centres `{x: col+0.5, y: row+0.5}`.
 * Stroke thickness is deliberately ignored: only the centreline survives.
 *
 * Layering: no DOM, no fs, no dependencies. Iterative (no recursion) so large
 * images cannot overflow the stack.
 */

export interface PxPoint {
  x: number;
  y: number;
}

export interface TraceOptions {
  /** Luminance below this (0..255) is road. */
  threshold: number;
  /** Black blobs smaller than this many pixels are noise. */
  minComponentPx: number;
  /** Junction pixels closer than this (or 3x the local half stroke width) become one node. */
  mergeJunctionPx: number;
  /** Dead-end branches shorter than this are removed. */
  minSpurPx: number;
  /** Douglas-Peucker tolerance. */
  simplifyPx: number;
  /** Chaikin corner-cutting passes. */
  smoothIterations: number;
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  threshold: 128,
  minComponentPx: 20,
  mergeJunctionPx: 4,
  minSpurPx: 12,
  simplifyPx: 1.5,
  smoothIterations: 2,
};

export interface GraphNodePx {
  id: number;
  x: number;
  y: number;
  degree: number;
}

export interface GraphPathPx {
  a: number;
  b: number;
  /** Includes both endpoint node positions as first / last point. */
  points: PxPoint[];
}

export interface RoadGraphPx {
  nodes: GraphNodePx[];
  paths: GraphPathPx[];
}

/** Mask: 1 = road (luminance strictly below `level`). */
export function threshold(lum: ArrayLike<number>, w: number, h: number, level: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (lum[i] as number) < level ? 1 : 0;
  return out;
}

/** 8-connected flood fill; drops components smaller than `minPx`. */
export function removeSpecks(mask: Uint8Array, w: number, h: number, minPx: number): Uint8Array {
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!out[start] || seen[start]) continue;
    comp.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      comp.push(p);
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const q = ny * w + nx;
          if (out[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (comp.length < minPx) for (const p of comp) out[p] = 0;
  }
  return out;
}

/**
 * Ring = N, NE, E, SE, S, SW, W, NW (1 = set). True when the centre pixel has
 * 2+ set neighbours, those form ONE 8-connected group (orthogonal neighbours
 * count as adjacent through the empty corner) and exactly one background run
 * touches the centre's 4-neighbours - i.e. removal changes no topology.
 */
function isRemovableSimplePoint(r: number[]): boolean {
  let count = 0;
  for (const v of r) count += v;
  if (count < 2) return false;
  const par = [0, 1, 2, 3, 4, 5, 6, 7];
  const find = (i: number): number => {
    let x = i;
    while (par[x] !== x) x = par[x] as number;
    return x;
  };
  const join = (i: number, j: number): void => {
    if (r[i] && r[j]) par[find(i)] = find(j);
  };
  for (let i = 0; i < 8; i++) join(i, (i + 1) % 8);
  for (const i of [0, 2, 4, 6]) join(i, (i + 2) % 8);
  const roots = new Set<number>();
  for (let i = 0; i < 8; i++) if (r[i]) roots.add(find(i));
  if (roots.size !== 1) return false;
  // Background runs (circular) that contain at least one orthogonal neighbour.
  const start = r.indexOf(1);
  let runs = 0;
  let inRun = false;
  let touches = false;
  for (let k = 1; k <= 8; k++) {
    const i = (start + k) % 8;
    if (!r[i]) {
      inRun = true;
      if (i % 2 === 0) touches = true;
    } else if (inRun) {
      if (touches) runs++;
      inRun = false;
      touches = false;
    }
  }
  return runs === 1;
}

/**
 * Zhang-Suen thinning (out-of-bounds counts as empty) followed by removal of
 * redundant staircase corner pixels so diagonals stay one pixel wide.
 */
export function skeletonize(mask: Uint8Array, w: number, h: number): Uint8Array {
  const pw = w + 2;
  const img = new Uint8Array(pw * (h + 2));
  let cand: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        const p = (y + 1) * pw + x + 1;
        img[p] = 1;
        cand.push(p);
      }
    }
  }
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let sub = 0; sub < 2; sub++) {
      del.length = 0;
      for (const p of cand) {
        const p2 = img[p - pw] as number;
        const p3 = img[p - pw + 1] as number;
        const p4 = img[p + 1] as number;
        const p5 = img[p + pw + 1] as number;
        const p6 = img[p + pw] as number;
        const p7 = img[p + pw - 1] as number;
        const p8 = img[p - 1] as number;
        const p9 = img[p - pw - 1] as number;
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (!p2 && p3 ? 1 : 0) +
          (!p3 && p4 ? 1 : 0) +
          (!p4 && p5 ? 1 : 0) +
          (!p5 && p6 ? 1 : 0) +
          (!p6 && p7 ? 1 : 0) +
          (!p7 && p8 ? 1 : 0) +
          (!p8 && p9 ? 1 : 0) +
          (!p9 && p2 ? 1 : 0);
        if (a !== 1) continue;
        if (sub === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        del.push(p);
      }
      if (del.length > 0) {
        changed = true;
        for (const p of del) img[p] = 0;
        cand = cand.filter((p) => img[p] === 1);
      }
    }
  }
  // Cleanup: remove every remaining simple point (deleting it neither splits
  // nor holes the skeleton) that is not an endpoint, so staircases and 2x2
  // blobs left by thinning collapse to a one-pixel-wide line.
  let again = true;
  while (again) {
    again = false;
    for (const p of cand) {
      if (!img[p]) continue;
      const ringv = [
        img[p - pw],
        img[p - pw + 1],
        img[p + 1],
        img[p + pw + 1],
        img[p + pw],
        img[p + pw - 1],
        img[p - 1],
        img[p - pw - 1],
      ] as number[];
      if (isRemovableSimplePoint(ringv)) {
        img[p] = 0;
        again = true;
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = img[(y + 1) * pw + x + 1] as number;
  return out;
}

/** Chamfer distance to the nearest background pixel (approx. local half stroke width). */
function distanceToBackground(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const D2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i] as number;
      v = Math.min(v, x > 0 ? (d[i - 1] as number) + 1 : 1);
      v = Math.min(v, y > 0 ? (d[i - w] as number) + 1 : 1);
      if (x > 0 && y > 0) v = Math.min(v, (d[i - w - 1] as number) + D2);
      if (x < w - 1 && y > 0) v = Math.min(v, (d[i - w + 1] as number) + D2);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let v = d[i] as number;
      v = Math.min(v, x < w - 1 ? (d[i + 1] as number) + 1 : 1);
      v = Math.min(v, y < h - 1 ? (d[i + w] as number) + 1 : 1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, (d[i + w + 1] as number) + D2);
      if (x > 0 && y < h - 1) v = Math.min(v, (d[i + w - 1] as number) + D2);
      d[i] = v;
    }
  }
  return d;
}

const N8: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** The 8 neighbours in circular order (N, NE, E, SE, S, SW, W, NW). */
const N8_RING: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

function pathLength(pts: PxPoint[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) {
    l += Math.hypot(
      (pts[i] as PxPoint).x - (pts[i - 1] as PxPoint).x,
      (pts[i] as PxPoint).y - (pts[i - 1] as PxPoint).y,
    );
  }
  return l;
}

/**
 * Traces a one-pixel skeleton into nodes (endpoints, clustered junctions) and
 * paths. `radius` (optional, per pixel) widens junction clustering to the local
 * stroke width so a thick X collapses to one node.
 */
export function traceSkeleton(
  skel: Uint8Array,
  w: number,
  h: number,
  mergeJunctionPx = DEFAULT_TRACE_OPTIONS.mergeJunctionPx,
  radius?: Float32Array,
): RoadGraphPx {
  const nbrs = (p: number): number[] => {
    const x = p % w;
    const y = (p - x) / w;
    const out: number[] = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (skel[q]) out.push(q);
    }
    return out;
  };
  const cx = (p: number): number => (p % w) + 0.5;
  const cy = (p: number): number => Math.floor(p / w) + 0.5;

  const nodePix: number[] = [];
  const junctionPix: number[] = [];
  const clusterOf = new Map<number, number>(); // node pixel -> node index
  // Classify by ring transitions (0->1 around the 8-neighbourhood), not raw
  // neighbour count: staircase pixels on shallow lines have 3 neighbours but
  // are plain path pixels.
  const endpointPix: number[] = [];
  /** Pixels of a surviving 2x2 block (an X crossing thins to one): all junction pixels. */
  const blockPix = new Set<number>();
  for (let p = 0; p < w * h; p++) {
    if (!skel[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    const ring = N8_RING.map(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && skel[ny * w + nx] ? 1 : 0;
    });
    let count = 0;
    let trans = 0;
    for (let i = 0; i < 8; i++) {
      count += ring[i] as number;
      if (!ring[i] && ring[(i + 1) % 8]) trans++;
    }
    if (count === 0) continue;
    const block = x + 1 < w && y + 1 < h && skel[p + 1] && skel[p + w] && skel[p + w + 1];
    if (block) for (const q of [p, p + 1, p + w, p + w + 1]) blockPix.add(q);
    if (trans >= 3) junctionPix.push(p);
    else if (trans <= 1 && !blockPix.has(p)) endpointPix.push(p);
  }
  const isJunction = new Set(junctionPix);
  for (const q of blockPix) if (!isJunction.has(q)) junctionPix.push(q);
  // Union-find over junction pixels.
  const parent = junctionPix.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    let c = i;
    while (parent[c] !== r) {
      const nx = parent[c] as number;
      parent[c] = r;
      c = nx;
    }
    return r;
  };
  for (let i = 0; i < junctionPix.length; i++) {
    const pi = junctionPix[i] as number;
    const ri = Math.max(mergeJunctionPx, 3 * (radius?.[pi] ?? 0));
    for (let j = i + 1; j < junctionPix.length; j++) {
      const pj = junctionPix[j] as number;
      const rj = Math.max(mergeJunctionPx, 3 * (radius?.[pj] ?? 0));
      if (Math.hypot(cx(pi) - cx(pj), cy(pi) - cy(pj)) <= Math.max(ri, rj))
        parent[find(i)] = find(j);
    }
  }
  const nodes: GraphNodePx[] = [];
  /** Cluster reach per node; a loop back to the same junction shorter than 4x this is a hole, not a road. */
  const nodeReach: number[] = [];
  const members = new Map<number, number[]>();
  for (let i = 0; i < junctionPix.length; i++) {
    const r = find(i);
    const list = members.get(r) ?? [];
    list.push(junctionPix[i] as number);
    members.set(r, list);
  }
  for (const list of members.values()) {
    const id = nodes.length;
    let sx = 0;
    let sy = 0;
    let reach = mergeJunctionPx;
    for (const p of list) {
      reach = Math.max(reach, 3 * (radius?.[p] ?? 0));
      sx += cx(p);
      sy += cy(p);
      clusterOf.set(p, id);
    }
    nodes.push({ id, x: sx / list.length, y: sy / list.length, degree: 0 });
    nodeReach[id] = reach;
    nodePix.push(...list);
  }
  for (const p of endpointPix) {
    const id = nodes.length;
    nodes.push({ id, x: cx(p), y: cy(p), degree: 0 });
    clusterOf.set(p, id);
    nodePix.push(p);
  }

  const visited = new Uint8Array(w * h);
  const paths: GraphPathPx[] = [];
  const seenKey = new Set<string>();
  const addPath = (a: number, b: number, pts: PxPoint[]): void => {
    if (pts.length < 2) return;
    if (a === b) {
      if (pathLength(pts) < 4 * (nodeReach[a] ?? mergeJunctionPx)) return;
      // Split a real loop on one node at its middle so no way is a self-loop.
      const mid = Math.floor(pts.length / 2);
      const m = pts[mid] as PxPoint;
      const id = nodes.length;
      nodes.push({ id, x: m.x, y: m.y, degree: 0 });
      paths.push({ a, b: id, points: pts.slice(0, mid + 1) });
      paths.push({ a: id, b, points: pts.slice(mid) });
      return;
    }
    paths.push({ a, b, points: pts });
  };

  for (const np of nodePix) {
    const startNode = clusterOf.get(np) as number;
    for (const q of nbrs(np)) {
      const qn = clusterOf.get(q);
      if (qn !== undefined) {
        if (qn !== startNode) {
          const key = `${Math.min(np, q)}-${Math.max(np, q)}`;
          if (!seenKey.has(key)) {
            seenKey.add(key);
            addPath(startNode, qn, [
              { x: cx(np), y: cy(np) },
              { x: cx(q), y: cy(q) },
            ]);
          }
        }
        continue;
      }
      if (visited[q]) continue;
      const pts: PxPoint[] = [{ x: cx(np), y: cy(np) }];
      let prev = np;
      let cur = q;
      let endNode = -1;
      for (;;) {
        visited[cur] = 1;
        pts.push({ x: cx(cur), y: cy(cur) });
        const next = nbrs(cur).filter((r) => r !== prev && r !== np);
        // Hitting any node pixel ends the walk (own cluster only after a real run).
        const hit = next.find((r) => {
          const n = clusterOf.get(r);
          return n !== undefined && (n !== startNode || pts.length > 2 * mergeJunctionPx);
        });
        if (hit !== undefined) {
          endNode = clusterOf.get(hit) as number;
          pts.push({ x: cx(hit), y: cy(hit) });
          break;
        }
        const free = next.filter((r) => !visited[r] && !clusterOf.has(r));
        if (free.length === 0) break;
        const ortho = free.find(
          (r) => r % w === cur % w || Math.floor(r / w) === Math.floor(cur / w),
        );
        prev = cur;
        cur = ortho ?? (free[0] as number);
      }
      if (endNode >= 0) {
        // Snap the polyline ends to the (clustered) node positions.
        const a = nodes[startNode] as GraphNodePx;
        const b = nodes[endNode] as GraphNodePx;
        pts[0] = { x: a.x, y: a.y };
        pts[pts.length - 1] = { x: b.x, y: b.y };
        addPath(startNode, endNode, pts);
      }
    }
  }

  // Isolated closed loops: split into two paths between two opposite nodes.
  for (let p = 0; p < w * h; p++) {
    if (!skel[p] || visited[p] || clusterOf.has(p)) continue;
    const ring: PxPoint[] = [];
    let cur = p;
    for (;;) {
      visited[cur] = 1;
      ring.push({ x: cx(cur), y: cy(cur) });
      const free = nbrs(cur).filter((r) => !visited[r] && !clusterOf.has(r));
      if (free.length === 0) break;
      const ortho = free.find(
        (r) => r % w === cur % w || Math.floor(r / w) === Math.floor(cur / w),
      );
      cur = ortho ?? (free[0] as number);
    }
    if (ring.length < 8) continue;
    const mid = Math.floor(ring.length / 2);
    const na = nodes.length;
    nodes.push({ id: na, x: (ring[0] as PxPoint).x, y: (ring[0] as PxPoint).y, degree: 0 });
    const nb = nodes.length;
    nodes.push({ id: nb, x: (ring[mid] as PxPoint).x, y: (ring[mid] as PxPoint).y, degree: 0 });
    paths.push({ a: na, b: nb, points: ring.slice(0, mid + 1) });
    paths.push({ a: nb, b: na, points: [...ring.slice(mid), ring[0] as PxPoint] });
  }

  return finalize({ nodes, paths });
}

/** Recomputes degrees and drops unused nodes (ids are renumbered densely). */
function finalize(g: RoadGraphPx): RoadGraphPx {
  const deg = new Map<number, number>();
  for (const p of g.paths) {
    deg.set(p.a, (deg.get(p.a) ?? 0) + 1);
    deg.set(p.b, (deg.get(p.b) ?? 0) + 1);
  }
  const remap = new Map<number, number>();
  const nodes: GraphNodePx[] = [];
  for (const n of g.nodes) {
    const d = deg.get(n.id) ?? 0;
    if (d === 0) continue;
    remap.set(n.id, nodes.length);
    nodes.push({ id: nodes.length, x: n.x, y: n.y, degree: d });
  }
  const paths = g.paths.map((p) => ({
    a: remap.get(p.a) as number,
    b: remap.get(p.b) as number,
    points: p.points,
  }));
  return { nodes, paths };
}

/** Removes short dead-end branches and merges the degree-2 nodes they leave. */
export function pruneSpurs(g: RoadGraphPx, minSpurPx: number): RoadGraphPx {
  let cur = finalize(g);
  for (let guard = 0; guard < 10000; guard++) {
    let changed = false;
    // 1) drop short branches touching a dead end.
    const kept = cur.paths.filter((p) => {
      const da = (cur.nodes[p.a] as GraphNodePx).degree;
      const db = (cur.nodes[p.b] as GraphNodePx).degree;
      if ((da === 1 || db === 1) && pathLength(p.points) < minSpurPx) {
        changed = true;
        return false;
      }
      return true;
    });
    cur = finalize({ nodes: cur.nodes, paths: kept });
    // 2) merge one degree-2 node at a time (ids shift, so rebuild each time).
    let merged = true;
    while (merged) {
      merged = false;
      for (const n of cur.nodes) {
        if (n.degree !== 2) continue;
        const inc = cur.paths.filter((p) => p.a === n.id || p.b === n.id);
        if (inc.length !== 2) continue;
        const [p1, p2] = inc as [GraphPathPx, GraphPathPx];
        if (p1.a === p1.b || p2.a === p2.b) continue;
        const otherA = p1.a === n.id ? p1.b : p1.a;
        const otherB = p2.a === n.id ? p2.b : p2.a;
        if (otherA === otherB) continue; // would create a self-loop
        const first = p1.b === n.id ? p1.points : [...p1.points].reverse();
        const second = p2.a === n.id ? p2.points : [...p2.points].reverse();
        const joined = [...first, ...second.slice(1)];
        const rest = cur.paths.filter((p) => p !== p1 && p !== p2);
        rest.push({ a: otherA, b: otherB, points: joined });
        cur = finalize({ nodes: cur.nodes, paths: rest });
        merged = true;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return cur;
}

/** Douglas-Peucker (iterative); endpoints kept. */
export function simplifyPath(points: PxPoint[], tolPx: number): PxPoint[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    const a = points[lo] as PxPoint;
    const b = points[hi] as PxPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let bestD = tolPx;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i] as PxPoint;
      const d =
        len === 0
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([lo, best], [best, hi]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Chaikin corner cutting with both endpoints pinned exactly. */
export function smoothPath(points: PxPoint[], iterations: number): PxPoint[] {
  let pts = points.slice();
  for (let it = 0; it < iterations; it++) {
    if (pts.length <= 2) return pts;
    const out: PxPoint[] = [pts[0] as PxPoint];
    const segs = pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const p = pts[i] as PxPoint;
      const q = pts[i + 1] as PxPoint;
      if (i > 0) out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      if (i < segs - 1) out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    out.push(pts[pts.length - 1] as PxPoint);
    pts = out;
  }
  return pts;
}

/** Full pipeline: luminance (0..255, row-major, row 0 top) -> pixel-unit road graph. */
export function imageToRoadGraph(
  lum: ArrayLike<number>,
  w: number,
  h: number,
  opts: Partial<TraceOptions> = {},
): RoadGraphPx {
  if (w * h !== lum.length)
    throw new Error(`image size ${w}x${h} does not match ${lum.length} pixels`);
  const o: TraceOptions = { ...DEFAULT_TRACE_OPTIONS, ...opts };
  const mask = removeSpecks(threshold(lum, w, h, o.threshold), w, h, o.minComponentPx);
  const dist = distanceToBackground(mask, w, h);
  const skel = skeletonize(mask, w, h);
  const raw = traceSkeleton(skel, w, h, o.mergeJunctionPx, dist);
  const pruned = pruneSpurs(raw, o.minSpurPx);
  const paths = pruned.paths.map((p) => {
    const s = simplifyPath(p.points, o.simplifyPx);
    const sm = smoothPath(s, o.smoothIterations);
    return { a: p.a, b: p.b, points: simplifyPath(sm, o.simplifyPx / 3) };
  });
  return { nodes: pruned.nodes, paths };
}
