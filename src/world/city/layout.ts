// Town skeleton generator. Runs once per town, fully deterministic from the town's seed and the
// land under it, so the skeleton is never saved: only per-surface state is. A town grows the
// way a village does on a hillside:
//   1. a square on the flattest ground near the middle, and gates in the wall round it
//   2. a main street from each gate to the square, along the cheapest way there: climbing
//      costs, and a slow noise makes the streets wander
//   3. lanes out to points spread over the rest of the town, each joining the nearest street
//      (running along a street is cheap, so lanes branch off the streets like a tree)
//   4. houses along both sides of every street, turned to face it, each on a level pad
//   5. the land left over becomes yards: paintable ground, cut into patches per district
// Everything is also kept on a 4 m raster (streets, houses, yards) for walking, stains and
// patrols.
import { CITY_PREFIX, CITY_SUFFIX } from '@/content/names';
import { BUILDINGS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import { color } from '@/content/palette';
import { hashInts } from '../math/hash';
import { createNoise2D } from '../math/noise';
import { Rng } from '../math/rng';
import { Heap } from '../nav/path';
import type { SurfaceInfo, SurfaceKind } from '../paint/surfaces';
import type { Entrance, Wilderness } from '../wilderness/generator';
import { type CitySkeleton, placeFeatures } from './features';

export const ROAD_NONE = 0;
export const ROAD_ALLEY = 1;
export const ROAD_SIDE = 2;
export const ROAD_MAIN = 3;
export type RoadClass = typeof ROAD_ALLEY | typeof ROAD_SIDE | typeof ROAD_MAIN;

/** Directions: 0 +x, 1 +z, 2 -x, 3 -z. */
const DX = [1, 0, -1, 0] as const;
const DZ = [0, 1, 0, -1] as const;

export type Face = 'px' | 'nx' | 'pz' | 'nz';

export interface Gate {
  /** Cell on the town edge. */
  readonly ix: number;
  readonly iz: number;
  /** Direction pointing into the town. */
  readonly dir: number;
  readonly main: boolean;
}

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface Street {
  readonly cls: RoadClass;
  /** Metres. */
  readonly width: number;
  /** Centre line, smoothed, metres. */
  readonly points: readonly Point[];
}

export interface Building {
  readonly id: number;
  /** Centre of the footprint, metres. */
  readonly x: number;
  readonly z: number;
  /** Half the width along the front, and half the depth. */
  readonly hw: number;
  readonly hd: number;
  /** The way the front faces: (sin angle, cos angle). In the house's own frame the front is
   * +z and the door is in the middle of it. */
  readonly angle: number;
  /** Height of its level pad: the floor. */
  readonly base: number;
  /** Lowest ground under its footprint: where its plinth starts. */
  readonly foot: number;
  /** Ground in front of the door. */
  readonly step: number;
  /** Eaves above the floor. */
  readonly height: number;
  readonly template: number;
  /** Surface ids, by face in the house's own frame (pz is the front). */
  readonly walls: Readonly<Record<Face, number>>;
  readonly roof: number;
  readonly door: number;
}

export interface CityLayout extends CitySkeleton {
  /** Where the town stands: its north-west corner. Every metre position below (streets,
   * buildings, surfaces, stains, doors, spawn) is in world space; the rasters are cells counted
   * from this corner. */
  readonly ox: number;
  readonly oz: number;
  /** Blocks (districts) per side. */
  readonly chunks: number;
  readonly id: string;
  readonly seed: number;
  readonly name: string;
  /** Cells per side. */
  readonly n: number;
  readonly cell: number;
  /** Metres per side. */
  readonly size: number;
  /** Ground height at the cell corners, row-major [kz * (n + 1) + kx]. */
  readonly heights: Float32Array;
  /** Street class per cell, row-major [iz * n + ix]. */
  readonly roads: Uint8Array;
  /** Yard region id + 1 per cell (0 = street or wall). */
  readonly blockOf: Uint16Array;
  /** Building id + 1 per cell (0 = none). */
  readonly buildingOf: Uint16Array;
  /** Paintable ground surface per cell, or -1. */
  readonly groundOf: Int32Array;
  readonly gates: readonly Gate[];
  readonly streets: readonly Street[];
  readonly square: Point & { readonly r: number };
  readonly buildings: readonly Building[];
  readonly surfaces: readonly SurfaceInfo[];
  /** Where a player entering through the main gate appears. */
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
}

/** The wall a gate is in, and the direction into the town from it. */
const GATE_DIR: Record<Face, number> = { pz: 3, nz: 1, px: 2, nx: 0 };
/** For each main-gate wall: the two walls beside it, then the one across. */
const OTHER_WALLS: Record<Face, readonly [Face, Face, Face]> = {
  pz: ['nx', 'px', 'nz'],
  nz: ['px', 'nx', 'pz'],
  px: ['pz', 'nz', 'nx'],
  nx: ['nz', 'pz', 'px'],
};
/** Cells either side of a gate's middle left open in the wall. */
export const GATE_HALF = 2;

type Land = Pick<CityLayout, 'ox' | 'oz' | 'n' | 'cell' | 'heights'>;

/** Ground height inside a town, the way the wilderness interpolates it: two triangles per cell
 * split along the (x+1, z)–(x, z+1) diagonal. */
export function groundAt(l: Land, x: number, z: number): number {
  const n = l.n;
  const gx = Math.min(n, Math.max(0, (x - l.ox) / l.cell));
  const gz = Math.min(n, Math.max(0, (z - l.oz) / l.cell));
  const ix = Math.min(n - 1, Math.floor(gx));
  const iz = Math.min(n - 1, Math.floor(gz));
  const u = gx - ix;
  const v = gz - iz;
  const h = l.heights;
  const a = iz * (n + 1) + ix;
  const c10 = h[a + 1]!;
  const c01 = h[a + n + 1]!;
  if (u + v <= 1) return (1 - u - v) * h[a]! + u * c10 + v * c01;
  return (u + v - 1) * h[a + n + 2]! + (1 - v) * c10 + (1 - u) * c01;
}

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

type Rect = Pick<Building, 'x' | 'z' | 'angle' | 'hw' | 'hd'>;

/** Whether two turned rectangles overlap: no gap along any of their four edge directions. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  const corners = (r: Rect): Point[] => {
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => ({ x: r.x + c * u! * r.hw + s * v! * r.hd, z: r.z - s * u! * r.hw + c * v! * r.hd }));
  };
  const ca = corners(a);
  const cb = corners(b);
  for (const r of [a, b]) {
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    for (const [ax, az] of [
      [c, -s],
      [s, c],
    ] as const) {
      const span = (pts: Point[]): [number, number] => {
        const d = pts.map((p) => p.x * ax + p.z * az);
        return [Math.min(...d), Math.max(...d)];
      };
      const [a0, a1] = span(ca);
      const [b0, b1] = span(cb);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

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

/**
 * A town laid out with its north-west corner at the origin and its main gate in the `main`
 * wall, on ground of the given height (metres, town-local; flat when left out). Pass it through
 * `placeCity` to stand it in the world.
 */
export function generateCity(
  id: string,
  seed: number,
  chunks: number = TUNING.city.chunks,
  main: Face = 'pz',
  height: (x: number, z: number) => number = () => 0,
): CityLayout {
  const cfg = TUNING.city;
  const H = cfg.houses;
  const cell = cfg.cell;
  const n = Math.round((chunks * TUNING.world.chunkSize) / cell);
  const size = n * cell;
  const rng = new Rng(seed);
  const idx = (ix: number, iz: number): number => iz * n + ix;
  const inside = (ix: number, iz: number): boolean => ix >= 1 && iz >= 1 && ix < n - 1 && iz < n - 1;

  // ---- the land ---------------------------------------------------------------------------
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let kz = 0; kz <= n; kz++)
    for (let kx = 0; kx <= n; kx++) heights[kz * (n + 1) + kx] = height(kx * cell, kz * cell);
  const land: Land = { ox: 0, oz: 0, n, cell, heights };
  const ground = (x: number, z: number): number => groundAt(land, x, z);
  const corner = (kx: number, kz: number): number =>
    heights[Math.min(n, Math.max(0, kz)) * (n + 1) + Math.min(n, Math.max(0, kx))]!;
  /** Rise over run across each cell. */
  const slope = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const c = [corner(ix, iz), corner(ix + 1, iz), corner(ix, iz + 1), corner(ix + 1, iz + 1)];
      slope[idx(ix, iz)] = (Math.max(...c) - Math.min(...c)) / cell;
    }

  // ---- 1. gates and the square ------------------------------------------------------------
  const gates: Gate[] = [];
  const mid = Math.floor(n / 2);
  const jitter = (): number => rng.int(-Math.floor(n / 8), Math.floor(n / 8));
  const gateIn = (wall: Face, at: number, isMain: boolean): Gate => {
    const dir = GATE_DIR[wall];
    const edge = wall === 'px' || wall === 'pz' ? n - 1 : 0;
    return wall === 'px' || wall === 'nx'
      ? { ix: edge, iz: at, dir, main: isMain }
      : { ix: at, iz: edge, dir, main: isMain };
  };
  gates.push(gateIn(main, mid + jitter(), true));
  const [left, right, across] = OTHER_WALLS[main];
  if (rng.chance(0.7)) gates.push(gateIn(left, mid + jitter(), false));
  if (rng.chance(0.7)) gates.push(gateIn(right, mid + jitter(), false));
  if (rng.chance(0.5)) gates.push(gateIn(across, mid + jitter(), false));
  const gateCell = new Uint8Array(n * n);
  for (const g of gates)
    for (let k = -GATE_HALF; k <= GATE_HALF; k++) {
      const along = g.dir === 0 || g.dir === 2;
      gateCell[along ? idx(g.ix, g.iz + k) : idx(g.ix + k, g.iz)] = 1;
    }

  // the flattest patch of ground near the middle
  const reach = Math.max(2, Math.floor(n * 0.2));
  let sq = idx(mid, mid);
  let sqScore = Infinity;
  for (let iz = mid - reach; iz <= mid + reach; iz += 2)
    for (let ix = mid - reach; ix <= mid + reach; ix += 2) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const h = corner(ix + dx, iz + dz);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      const score = (hi - lo) / (6 * cell) + (0.25 * Math.hypot(ix - mid, iz - mid)) / reach;
      if (score < sqScore) {
        sqScore = score;
        sq = idx(ix, iz);
      }
    }
  const sqx = sq % n;
  const sqz = (sq - sqx) / n;
  const square = { x: (sqx + 0.5) * cell, z: (sqz + 0.5) * cell, r: cfg.square };

  // ---- 2 and 3. streets -------------------------------------------------------------------
  const roads = new Uint8Array(n * n);
  const wander = createNoise2D(hashInts(seed, 0x9a7e));
  const cost = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const i = idx(ix, iz);
      const s = slope[i]!;
      cost[i] =
        inside(ix, iz) || gateCell[i]
          ? 1 + cfg.climbCost * s * s + cfg.wander * (0.5 + 0.5 * wander(ix / 9, iz / 9))
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
  const centreOf = (i: number): Point => ({ x: ((i % n) + 0.5) * cell, z: (Math.floor(i / n) + 0.5) * cell });
  const streets: Street[] = [];
  const roadCells: number[] = [];
  /** Street segments by 16 m bucket, for checking a house keeps clear of every street. */
  const BUCKET = 16;
  const buckets = new Map<number, { a: Point; b: Point; half: number }[]>();
  const bucketKey = (bx: number, bz: number): number => bz * 4096 + bx;
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
          let list = buckets.get(key);
          if (!list) buckets.set(key, (list = []));
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
    if (slope[i]! > 0.4) continue;
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

  // ---- 4. houses --------------------------------------------------------------------------
  const surfaces: SurfaceInfo[] = [];
  const per = TUNING.world.chunkSize;
  const chunkOf = (x: number, z: number): number =>
    Math.min(chunks - 1, Math.max(0, Math.floor(z / per))) * chunks +
    Math.min(chunks - 1, Math.max(0, Math.floor(x / per)));
  const addSurface = (
    kind: SurfaceKind,
    chunk: number,
    c: number,
    area: number,
    x: number,
    z: number,
  ): number => {
    surfaces.push({ kind, chunk, color: c, area, x, z });
    return surfaces.length - 1;
  };
  const buildingOf = new Uint16Array(n * n);
  const buildings: Building[] = [];
  const pickTemplate = (centrality: number): number => {
    // shops gather round the square, barns sit out towards the fields
    const weight = (t: number): number => {
      const key = BUILDINGS[t]!.key;
      return (
        BUILDINGS[t]!.weight * (key === 'barn' ? 1.6 - centrality : key === 'shop' ? 0.4 + centrality : 1)
      );
    };
    const weights = BUILDINGS.map((_, t) => weight(t));
    let r = rng.next() * weights.reduce((a, b) => a + b, 0);
    for (let t = 0; t < BUILDINGS.length; t++) if ((r -= weights[t]!) <= 0) return t;
    return 0;
  };
  const range = (r: readonly number[]): number => r[0]! + (r[1]! - r[0]!) * rng.next();
  /** Cells whose centre lies within the turned rectangle grown by `margin` (-1 off the map). */
  const cellsUnder = (
    x: number,
    z: number,
    angle: number,
    hw: number,
    hd: number,
    margin: number,
  ): number[] => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const ex = Math.abs(c) * (hw + margin) + Math.abs(s) * (hd + margin);
    const ez = Math.abs(s) * (hw + margin) + Math.abs(c) * (hd + margin);
    const out: number[] = [];
    for (let iz = Math.floor((z - ez) / cell); iz <= Math.floor((z + ez) / cell); iz++)
      for (let ix = Math.floor((x - ex) / cell); ix <= Math.floor((x + ex) / cell); ix++) {
        const dx = (ix + 0.5) * cell - x;
        const dz = (iz + 0.5) * cell - z;
        // into the house's own frame
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) > hw + margin || Math.abs(lz) > hd + margin) continue;
        out.push(ix < 0 || iz < 0 || ix >= n || iz >= n ? -1 : idx(ix, iz));
      }
    return out;
  };
  /** Houses placed so far, by 16 m bucket of their centre. */
  const placed = new Map<number, Building[]>();
  /** Whether a turned rectangle keeps `gap` metres clear of every house placed so far. */
  const clearOfHouses = (
    x: number,
    z: number,
    angle: number,
    hw: number,
    hd: number,
    gap: number,
  ): boolean => {
    const reach = 2 * (Math.hypot(hw, hd) + 12);
    for (let bz = Math.floor((z - reach) / BUCKET); bz <= Math.floor((z + reach) / BUCKET); bz++)
      for (let bx = Math.floor((x - reach) / BUCKET); bx <= Math.floor((x + reach) / BUCKET); bx++)
        for (const o of placed.get(bucketKey(bx, bz)) ?? [])
          if (rectsOverlap({ x, z, angle, hw: hw + gap, hd: hd + gap }, o)) return false;
    return true;
  };
  /** Whether a turned rectangle keeps half a metre clear of every street's paving. */
  const clearOfStreets = (x: number, z: number, c: number, s: number, hw: number, hd: number): boolean => {
    const reach = Math.hypot(hw, hd) + cfg.square;
    const local = (p: Point): Point => ({
      x: (p.x - x) * c - (p.z - z) * s,
      z: (p.x - x) * s + (p.z - z) * c,
    });
    for (let bz = Math.floor((z - reach) / BUCKET); bz <= Math.floor((z + reach) / BUCKET); bz++)
      for (let bx = Math.floor((x - reach) / BUCKET); bx <= Math.floor((x + reach) / BUCKET); bx++)
        for (const seg of buckets.get(bucketKey(bx, bz)) ?? []) {
          // the segment in the house's own frame, against the house grown by the paving's half
          const a = local(seg.a);
          const b = local(seg.b);
          const ex = hw + seg.half + 0.5;
          const ez = hd + seg.half + 0.5;
          const len = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
          for (let k = 0; k <= len; k++) {
            const px = a.x + ((b.x - a.x) * k) / len;
            const pz = a.z + ((b.z - a.z) * k) / len;
            if (Math.abs(px) < ex && Math.abs(pz) < ez) return false;
          }
        }
    return true;
  };
  /** A house beside the street at `p`, on the side `out` points to; returns its width or 0. */
  const tryHouse = (p: Point, out: Point, roadHalf: number): number => {
    const fromSq = Math.min(1, Math.hypot(p.x - square.x, p.z - square.z) / (size * 0.6));
    if (!rng.chance(H.density[0]! + (H.density[1]! - H.density[0]!) * fromSq)) return 0;
    const t = pickTemplate(1 - fromSq);
    const tpl = BUILDINGS[t]!;
    const scale = tpl.key === 'barn' ? 1.3 : tpl.key === 'shop' ? 1.1 : 1;
    const hw = (range(H.width) * scale) / 2;
    const hd = (range(H.depth) * scale) / 2;
    const back = roadHalf + range(H.setback) + hd;
    const x = p.x + out.x * back;
    const z = p.z + out.z * back;
    // the front looks back at the street
    const angle = Math.atan2(-out.x, -out.z);
    const under = cellsUnder(x, z, angle, hw, hd, 0.4);
    const blocked = (i: number): boolean =>
      i < 0 || !inside(i % n, Math.floor(i / n)) || roads[i] !== ROAD_NONE || buildingOf[i] !== 0;
    if (!under.length || under.some(blocked)) return 0;
    // keep a little room between neighbours
    if (cellsUnder(x, z, angle, hw, hd, 1.6).some((i) => i >= 0 && buildingOf[i] !== 0)) return 0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (!clearOfStreets(x, z, c, s, hw, hd) || !clearOfHouses(x, z, angle, hw, hd, 1.2)) return 0;
    /** A point in the house's own frame, in the town. */
    const at = (u: number, v: number): Point => ({ x: x + c * u + s * v, z: z - s * u + c * v });
    let lo = Infinity;
    let hi = -Infinity;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 0],
    ] as const) {
      const q = at(u * hw, v * hd);
      const h = ground(q.x, q.z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (hi - lo > H.maxRise) return 0;
    const id = buildings.length;
    for (const i of under) buildingOf[i] = id + 1;
    const floors = rng.int(tpl.paintFloors.min, tpl.paintFloors.max);
    const paintHeight = floors * H.floorHeight;
    const chunk = chunkOf(x, z);
    const wall = rng.pick(tpl.walls);
    const side = (u: number, v: number, len: number): number => {
      const f = at(u, v);
      return addSurface('wall', chunk, wall, len * paintHeight, f.x, f.z);
    };
    const walls = {
      px: side(hw, 0, 2 * hd),
      nx: side(-hw, 0, 2 * hd),
      pz: side(0, hd, 2 * hw),
      nz: side(0, -hd, 2 * hw),
    };
    const roof = addSurface('roof', chunk, rng.pick(tpl.roofs), 4 * hw * hd, x, z);
    const front = at(0, hd);
    const door = addSurface('door', chunk, rng.pick(tpl.doors), 1.6 * 2.4, front.x, front.z);
    const stepAt = at(0, hd + 1.2);
    const key = bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
    let near = placed.get(key);
    if (!near) placed.set(key, (near = []));
    buildings.push({
      id,
      x,
      z,
      hw,
      hd,
      angle,
      base: hi + 0.12,
      foot: lo,
      step: ground(stepAt.x, stepAt.z),
      height: tpl.eaves + (floors - tpl.paintFloors.min) * 0.35,
      template: t,
      walls,
      roof,
      door,
    });
    near.push(buildings[id]!);
    return 2 * hw;
  };
  for (const st of streets) {
    if (st.points.length < 2) continue;
    for (const sideSign of [1, -1]) {
      // walk along the street, a house's width and a gap at a time
      let carry = 4 + rng.next() * 4;
      for (let k = 0; k < st.points.length - 1; k++) {
        const a = st.points[k]!;
        const b = st.points[k + 1]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 1e-6) continue;
        const tx = (b.x - a.x) / len;
        const tz = (b.z - a.z) / len;
        const out = { x: -tz * sideSign, z: tx * sideSign };
        let s = carry;
        while (s < len) {
          const width = tryHouse({ x: a.x + tx * s, z: a.z + tz * s }, out, st.width / 2);
          s += width ? width + range(H.gap) : 3;
        }
        carry = s - len;
      }
    }
  }

  // ---- 5. yards ---------------------------------------------------------------------------
  // open land between the streets, one region per district so no yard spans two of them
  const blockOf = new Uint16Array(n * n);
  const groundOf = new Int32Array(n * n).fill(-1);
  const district = (i: number): number => chunkOf(((i % n) + 0.5) * cell, (Math.floor(i / n) + 0.5) * cell);
  const yardColors = [color('grass'), color('sand'), color('green')];
  let regions = 0;
  for (let i0 = 0; i0 < n * n; i0++) {
    if (blockOf[i0] !== 0 || roads[i0] !== ROAD_NONE || !inside(i0 % n, Math.floor(i0 / n))) continue;
    const region = ++regions;
    const cells: number[] = [];
    const stack = [i0];
    blockOf[i0] = region;
    while (stack.length) {
      const j = stack.pop()!;
      cells.push(j);
      const x = j % n;
      const z = (j - x) / n;
      for (let d = 0; d < 4; d++) {
        const x2 = x + DX[d]!;
        const z2 = z + DZ[d]!;
        if (!inside(x2, z2)) continue;
        const k = idx(x2, z2);
        if (roads[k] === ROAD_NONE && blockOf[k] === 0 && district(k) === district(j)) {
          blockOf[k] = region;
          stack.push(k);
        }
      }
    }
    // the open part, cut into patches, each its own surface
    const patches = new Map<number, number[]>();
    for (const j of cells) {
      if (buildingOf[j] !== 0) continue;
      const key = Math.floor((j % n) / cfg.yardPatch) * 1000 + Math.floor(Math.floor(j / n) / cfg.yardPatch);
      let list = patches.get(key);
      if (!list) patches.set(key, (list = []));
      list.push(j);
    }
    const yardColor = rng.pick(yardColors);
    for (const key of [...patches.keys()].sort((a, b) => a - b)) {
      const list = patches.get(key)!;
      // a sliver left between houses stays plain ground
      if (list.length < 3) continue;
      let sx = 0;
      let sz = 0;
      for (const j of list) {
        sx += ((j % n) + 0.5) * cell;
        sz += (Math.floor(j / n) + 0.5) * cell;
      }
      const surface = addSurface(
        'ground',
        district(list[0]!),
        yardColor,
        list.length * cell * cell,
        sx / list.length,
        sz / list.length,
      );
      for (const j of list) groundOf[j] = surface;
    }
  }

  // Spawn on the main street a little way in from the main gate, looking up it.
  let spawn = { x: square.x, z: square.z, yaw: 0 };
  const entry = streets.find((s) => s.cls === ROAD_MAIN && s.points.length > 2);
  if (entry) {
    let walked = 0;
    for (let k = 0; k < entry.points.length - 1; k++) {
      const a = entry.points[k]!;
      const b = entry.points[k + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (walked + len < 16 && k < entry.points.length - 2) {
        walked += len;
        continue;
      }
      const t = Math.min(1, (16 - walked) / (len || 1));
      spawn = {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
      };
      break;
    }
  }
  const name = rng.pick(CITY_PREFIX) + rng.pick(CITY_SUFFIX);
  return {
    id,
    ox: 0,
    oz: 0,
    chunks,
    seed,
    name,
    n,
    cell,
    size,
    heights,
    roads,
    blockOf,
    buildingOf,
    groundOf,
    gates,
    streets,
    square,
    buildings,
    surfaces,
    spawn,
    ...placeFeatures({ seed, n, cell, chunks, roads, surfaces, buildings, spawn }),
  };
}

/** The same town stood in the world with its north-west corner at (x, z). Heights belong to the
 * land, so they stay as they are. */
export function placeCity(c: CityLayout, at: Point): CityLayout {
  const move = <T extends Point>(p: T): T => ({ ...p, x: p.x + at.x, z: p.z + at.z });
  return {
    ...c,
    ox: c.ox + at.x,
    oz: c.oz + at.z,
    streets: c.streets.map((s) => ({ ...s, points: s.points.map(move) })),
    square: move(c.square),
    buildings: c.buildings.map(move),
    surfaces: c.surfaces.map(move),
    stains: c.stains.map(move),
    studios: c.studios.map((s) => ({ ...s, door: move(s.door) })),
    monsters: c.monsters.map(move),
    requests: c.requests.map((r) => ({ ...r, door: move(r.door) })),
    spawn: move(c.spawn),
  };
}

/** A town's layout on the land the wilderness gives it, where the wilderness put it. */
export function townLayout(e: Entrance, w: Pick<Wilderness, 'heightAt'>): CityLayout {
  const local = generateCity(e.cityId, e.seed, e.chunks, e.gate, (x, z) => w.heightAt(e.ox + x, e.oz + z));
  return placeCity(local, { x: e.ox, z: e.oz });
}

/** The yard surface on the ground at (x, z), or null on streets, under houses and outside. */
export function groundSurfaceAt(
  l: Pick<CityLayout, 'ox' | 'oz' | 'n' | 'cell' | 'groundOf'>,
  x: number,
  z: number,
): number | null {
  const ix = Math.floor((x - l.ox) / l.cell);
  const iz = Math.floor((z - l.oz) / l.cell);
  if (ix < 0 || iz < 0 || ix >= l.n || iz >= l.n) return null;
  const s = l.groundOf[iz * l.n + ix]!;
  return s >= 0 ? s : null;
}
