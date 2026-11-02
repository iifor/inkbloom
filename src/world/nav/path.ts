// A* on a square cell grid. Both worlds are rasters already (city: 4 m road/lot cells,
// wilderness: 4 m terrace cells), so one small pathfinder serves both. Pure; tested in Node.

export interface NavGrid {
  /** Cell size in metres; cell (ix, iz) covers [ix*cell, (ix+1)*cell). */
  readonly cell: number;
  /** Can a monster stand in this cell? */
  walkable(ix: number, iz: number): boolean;
  /** Can it step from one cell to a neighbouring one (terrace heights)? Default: yes. */
  passable?(ax: number, az: number, bx: number, bz: number): boolean;
}

export interface Waypoint {
  readonly x: number;
  readonly z: number;
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

const OFFSET = 1 << 15;
const key = (ix: number, iz: number): number => (ix + OFFSET) * 65536 + (iz + OFFSET);

/** Binary min-heap of node keys by f-score. */
class Heap {
  private readonly keys: number[] = [];
  private readonly f: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, f: number): void {
    this.keys.push(k);
    this.f.push(f);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p]! <= this.f[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.keys[0]!;
    const lastK = this.keys.pop()!;
    const lastF = this.f.pop()!;
    if (this.keys.length) {
      this.keys[0] = lastK;
      this.f[0] = lastF;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.f[l]! < this.f[m]!) m = l;
        if (r < this.keys.length && this.f[r]! < this.f[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.f[a], this.f[b]] = [this.f[b]!, this.f[a]!];
  }
}

function step(g: NavGrid, ax: number, az: number, bx: number, bz: number): boolean {
  return g.walkable(bx, bz) && (g.passable?.(ax, az, bx, bz) ?? true);
}

/**
 * Path from one world point to another as cell-centre waypoints (start excluded, goal
 * included), straightened where the grid allows. Null when the goal cannot be reached within
 * `maxExpand` cells. A goal in a blocked cell (e.g. a player on a roof edge) is approached as
 * close as the grid allows.
 */
export function findPath(g: NavGrid, from: Waypoint, to: Waypoint, maxExpand = 2500): Waypoint[] | null {
  const c = g.cell;
  const sx = Math.floor(from.x / c);
  const sz = Math.floor(from.z / c);
  const gx = Math.floor(to.x / c);
  const gz = Math.floor(to.z / c);
  if (sx === gx && sz === gz) return [to];
  const goalOpen = g.walkable(gx, gz);
  const h = (ix: number, iz: number): number => {
    const dx = Math.abs(ix - gx);
    const dz = Math.abs(iz - gz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const open = new Heap();
  const gScore = new Map<number, number>();
  const came = new Map<number, number>();
  const start = key(sx, sz);
  gScore.set(start, 0);
  open.push(start, h(sx, sz));
  let best = start;
  let bestH = h(sx, sz);
  let expanded = 0;
  let reached = -1;
  while (open.size && expanded < maxExpand) {
    const k = open.pop();
    const ix = Math.floor(k / 65536) - OFFSET;
    const iz = (k % 65536) - OFFSET;
    expanded++;
    const hk = h(ix, iz);
    if (hk < bestH) {
      bestH = hk;
      best = k;
    }
    if ((ix === gx && iz === gz) || (!goalOpen && hk <= 1.5)) {
      reached = k;
      break;
    }
    const gk = gScore.get(k)!;
    for (const [dx, dz, cost] of DIRS) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (!step(g, ix, iz, nx, nz)) continue;
      // no cutting corners past a blocked cell
      if (dx !== 0 && dz !== 0 && (!step(g, ix, iz, ix + dx, iz) || !step(g, ix, iz, ix, iz + dz))) continue;
      const nk = key(nx, nz);
      const ng = gk + cost;
      if (ng >= (gScore.get(nk) ?? Infinity)) continue;
      gScore.set(nk, ng);
      came.set(nk, k);
      open.push(nk, ng + h(nx, nz));
    }
  }
  if (reached < 0) {
    // unreachable within budget: only accept a partial path for a blocked goal
    if (goalOpen || bestH > 2.5) return null;
    reached = best;
  }
  const cells: [number, number][] = [];
  for (let k = reached; k !== start; k = came.get(k)!)
    cells.push([Math.floor(k / 65536) - OFFSET, (k % 65536) - OFFSET]);
  cells.reverse();
  const pts = smooth(g, [sx, sz], cells).map(([ix, iz]) => ({ x: (ix + 0.5) * c, z: (iz + 0.5) * c }));
  if (reached === key(gx, gz)) pts[pts.length - 1] = to;
  return pts;
}

/** Drop waypoints that can be skipped in a straight, walkable line. */
function smooth(g: NavGrid, start: [number, number], cells: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let anchor = start;
  for (let i = 0; i < cells.length; i++) {
    const next = cells[i + 1];
    if (next && clearLine(g, anchor, next)) continue;
    out.push(cells[i]!);
    anchor = cells[i]!;
  }
  return out;
}

/** Every cell a straight line between two cells passes through is walkable and passable. */
function clearLine(g: NavGrid, a: [number, number], b: [number, number]): boolean {
  let [x, z] = a;
  const [x1, z1] = b;
  const dx = Math.abs(x1 - x);
  const dz = Math.abs(z1 - z);
  const sx = x < x1 ? 1 : -1;
  const sz = z < z1 ? 1 : -1;
  let err = dx - dz;
  while (x !== x1 || z !== z1) {
    const e2 = 2 * err;
    const px = x;
    const pz = z;
    if (e2 > -dz) {
      err -= dz;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      z += sz;
    }
    if (!step(g, px, pz, x, z)) return false;
    if (px !== x && pz !== z && (!step(g, px, pz, x, pz) || !step(g, px, pz, px, z))) return false;
  }
  return true;
}
