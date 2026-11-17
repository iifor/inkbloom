// Steps 2 and 3 of a town's layout: a main street from each gate to the square, along the
// cheapest way there (climbing costs, and a slow noise makes the streets wander), then lanes
// out to points spread over the rest of the town, each joining the nearest street. Running
// along a street is cheap, so lanes branch off the streets like a tree.
import { TUNING } from '@/content/tuning';
import { hashInts } from '../math/hash';
import { createNoise2D } from '../math/noise';
import { Heap } from '../nav/path';
import type { Gate, Square } from './gates';
import {
  DX,
  DZ,
  type Point,
  ROAD_ALLEY,
  ROAD_MAIN,
  ROAD_NONE,
  ROAD_SIDE,
  type RoadClass,
  type Site,
} from './site';

export interface Street {
  readonly cls: RoadClass;
  /** Metres. */
  readonly width: number;
  /** Centre line, smoothed, metres. */
  readonly points: readonly Point[];
}

/** One stretch of a street's centre line and half its paving's width. */
export interface Segment {
  readonly a: Point;
  readonly b: Point;
  readonly half: number;
}

export interface StreetPlan {
  /** Street class per cell. */
  readonly roads: Uint8Array;
  readonly streets: Street[];
  /** Street segments by bucket (see `bucketKey`), for checking a house keeps clear of every
   * street. */
  readonly segments: Map<number, Segment[]>;
}

/** Side of the buckets things are filed under for nearby checks, metres. */
export const BUCKET = 16;
export const bucketKey = (bx: number, bz: number): number => bz * 4096 + bx;

const NEIGHBOURS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/** Chaikin corner cutting, ends kept: a path of cells becomes a curve. */
function smooth(points: readonly Point[], rounds: number): Point[] {
  let p = points.slice();
  for (let r = 0; r < rounds && p.length > 2; r++) {
    const out: Point[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      if (i > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      if (i < p.length - 2) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]!);
    p = out;
  }
  return p;
}

/** Pave the square, then the main streets and the lanes. `sq` is the square's cell. */
export function layStreets(
  site: Site,
  gates: readonly Gate[],
  gateCell: Uint8Array,
  square: Square,
  sq: number,
): StreetPlan {
  const cfg = TUNING.city;
  const { n, cell, rng, idx, inside, water, slope, centreOf } = site;
  const sqx = sq % n;
  const sqz = (sq - sqx) / n;
  const roads = new Uint8Array(n * n);
  const wander = createNoise2D(hashInts(site.seed, 0x9a7e));
  const cost = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const i = idx(ix, iz);
      const s = slope[i]!;
      cost[i] =
        inside(ix, iz) || gateCell[i]
          ? 1 +
            cfg.climbCost * s * s +
            cfg.wander * (0.5 + 0.5 * wander(ix / 9, iz / 9)) +
            (water[i] ? cfg.bridgeCost : 0)
          : Infinity;
    }
  const g = new Float32Array(n * n);
  const came = new Int32Array(n * n);
  /** Cheapest cell path from `from` to the first cell `done` accepts, heading for `to`. */
  const cheapest = (from: number, done: (i: number) => boolean, to: number): number[] | null => {
    const tx = to % n;
    const tz = (to - tx) / n;
    g.fill(Infinity);
    came.fill(-1);
    const open = new Heap();
    g[from] = 0;
    open.push(from, 0);
    while (open.size) {
      const i = open.pop();
      if (done(i)) {
        const path = [i];
        for (let k = i; k !== from;) path.push((k = came[k]!));
        return path.reverse();
      }
      const x = i % n;
      const z = (i - x) / n;
      for (const [dx, dz, len] of NEIGHBOURS) {
        const x2 = x + dx;
        const z2 = z + dz;
        if (x2 < 0 || z2 < 0 || x2 >= n || z2 >= n) continue;
        const j = idx(x2, z2);
        const step = ((cost[i]! + cost[j]!) / 2) * len;
        if (!Number.isFinite(step) || g[i]! + step >= g[j]!) continue;
        g[j] = g[i]! + step;
        came[j] = i;
        open.push(j, g[j]! + cfg.reuse * Math.hypot(x2 - tx, z2 - tz));
      }
    }
    return null;
  };
  const streets: Street[] = [];
  const roadCells: number[] = [];
  const segments = new Map<number, Segment[]>();
  /** Mark every cell the street covers, and make running along it cheap from now on. */
  const lay = (points: readonly Point[], cls: RoadClass, width: number): void => {
    streets.push({ cls, width, points });
    for (let k = 0; k < points.length; k++) {
      const a = points[k]!;
      const b = points[Math.min(k + 1, points.length - 1)]!;
      const seg = { a, b, half: width / 2 };
      for (
        let bz = Math.floor(Math.min(a.z, b.z) / BUCKET);
        bz <= Math.floor(Math.max(a.z, b.z) / BUCKET);
        bz++
      )
        for (
          let bx = Math.floor(Math.min(a.x, b.x) / BUCKET);
          bx <= Math.floor(Math.max(a.x, b.x) / BUCKET);
          bx++
        ) {
          const key = bucketKey(bx, bz);
          let list = segments.get(key);
          if (!list) segments.set(key, (list = []));
          list.push(seg);
        }
    }
    // wide enough that a diagonal street still joins edge to edge on the raster
    const r = Math.max(width / 2 + 0.8, 3);
    for (let k = 0; k < Math.max(1, points.length - 1); k++) {
      const a = points[k]!;
      const b = points[Math.min(k + 1, points.length - 1)]!;
      const ix0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r) / cell));
      const ix1 = Math.min(n - 1, Math.floor((Math.max(a.x, b.x) + r) / cell));
      const iz0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - r) / cell));
      const iz1 = Math.min(n - 1, Math.floor((Math.max(a.z, b.z) + r) / cell));
      const ux = b.x - a.x;
      const uz = b.z - a.z;
      const len2 = ux * ux + uz * uz || 1;
      for (let iz = iz0; iz <= iz1; iz++)
        for (let ix = ix0; ix <= ix1; ix++) {
          const i = idx(ix, iz);
          if (!inside(ix, iz) && !gateCell[i]) continue;
          const cx = (ix + 0.5) * cell;
          const cz = (iz + 0.5) * cell;
          const t = Math.max(0, Math.min(1, ((cx - a.x) * ux + (cz - a.z) * uz) / len2));
          if (Math.hypot(cx - a.x - ux * t, cz - a.z - uz * t) > r) continue;
          if (roads[i] === ROAD_NONE) roadCells.push(i);
          if (roads[i]! < cls) roads[i] = cls;
          cost[i] = Math.min(cost[i]!, cfg.reuse);
        }
    }
  };
  // the square is paved
  lay([square], ROAD_MAIN, cfg.square * 2);
  // a main street from every gate to the square, straight in through the gateway first
  for (const gate of gates) {
    const start = idx(gate.ix + DX[gate.dir]! * 3, gate.iz + DZ[gate.dir]! * 3);
    const path = cheapest(start, (i) => i === sq, sq);
    if (!path) continue;
    const outside = {
      x: (gate.ix + 0.5 - DX[gate.dir]! * 0.5) * cell,
      z: (gate.iz + 0.5 - DZ[gate.dir]! * 0.5) * cell,
    };
    const cells = [
      outside,
      centreOf(idx(gate.ix + DX[gate.dir]!, gate.iz + DZ[gate.dir]!)),
      ...path.map(centreOf),
    ];
    lay(smooth(cells, 2), ROAD_MAIN, cfg.streets.main);
  }
  // lanes out to points spread over the town, nearest the square first
  const spacing = cfg.reachSpacing / cell;
  const reaches: number[] = [];
  for (let tries = 0; tries < (n * n * 3) / (spacing * spacing); tries++) {
    const ix = rng.int(3, n - 4);
    const iz = rng.int(3, n - 4);
    const i = idx(ix, iz);
    if (slope[i]! > 0.4 || site.nearWater(ix, iz, 2)) continue;
    if (reaches.some((j) => Math.hypot((j % n) - ix, Math.floor(j / n) - iz) < spacing)) continue;
    reaches.push(i);
  }
  const fromSquare = (i: number): number => Math.hypot((i % n) - sqx, Math.floor(i / n) - sqz);
  reaches.sort((a, b) => fromSquare(a) - fromSquare(b));
  for (const target of reaches) {
    const tx = target % n;
    const tz = (target - tx) / n;
    let near = -1;
    let nearD = Infinity;
    for (const r of roadCells) {
      const d = Math.hypot((r % n) - tx, Math.floor(r / n) - tz);
      if (d < nearD) {
        nearD = d;
        near = r;
      }
    }
    // already served by a street close by
    if (near < 0 || nearD < 4.5) continue;
    const path = cheapest(target, (i) => roads[i] !== ROAD_NONE, near);
    if (!path || path.length < 3) continue;
    const long = path.length >= 16;
    lay(
      smooth(path.reverse().map(centreOf), 2),
      long ? ROAD_SIDE : ROAD_ALLEY,
      long ? cfg.streets.side : cfg.streets.lane,
    );
  }
  return { roads, streets, segments };
}
