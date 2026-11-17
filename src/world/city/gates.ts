// Step 1 of a town's layout: gates in the wall round it, the main one in the wall the town is
// entered by, and a square on the flattest ground near the middle.
import { TUNING } from '@/content/tuning';
import { Rng } from '../math/rng';
import type { Entrance, Wilderness } from '../wilderness/generator';
import { DX, DZ, type Face, GATE_HALF, type Land, type Point, type Site, WET, groundAt } from './site';

export interface Gate {
  /** Cell on the town edge. */
  readonly ix: number;
  readonly iz: number;
  /** Direction pointing into the town. */
  readonly dir: number;
  readonly main: boolean;
}

export type Square = Point & { readonly r: number };

/** The wall a gate is in, and the direction into the town from it. */
const GATE_DIR: Record<Face, number> = { pz: 3, nz: 1, px: 2, nx: 0 };
/** For each main-gate wall: the two walls beside it, then the one across. */
const OTHER_WALLS: Record<Face, readonly [Face, Face, Face]> = {
  pz: ['nx', 'px', 'nz'],
  nz: ['px', 'nx', 'pz'],
  px: ['pz', 'nz', 'nx'],
  nx: ['nz', 'pz', 'px'],
};

/**
 * A town's gates: the main one in the `main` wall, and by chance one in each of the other
 * walls, each near its wall's middle and moved along it until the way in is dry. These are the
 * town's first draws from `rng` (generateCity makes them before anything else), which is what
 * lets `townGates` find them without laying the whole town out.
 */
function chooseGates(
  n: number,
  rng: Rng,
  main: Face,
  nearWater: (ix: number, iz: number, r: number) => boolean,
): Gate[] {
  const gates: Gate[] = [];
  const mid = Math.floor(n / 2);
  const jitter = (): number => rng.int(-Math.floor(n / 8), Math.floor(n / 8));
  const gateIn = (wall: Face, wanted: number, isMain: boolean): Gate => {
    const dir = GATE_DIR[wall];
    const edge = wall === 'px' || wall === 'pz' ? n - 1 : 0;
    const make = (at: number): Gate =>
      wall === 'px' || wall === 'nx'
        ? { ix: edge, iz: at, dir, main: isMain }
        : { ix: at, iz: edge, dir, main: isMain };
    // on dry land: where a river leaves the town, move along the wall till the way in is dry
    for (let k = 0; k < n / 2; k++)
      for (const at of [wanted + k, wanted - k]) {
        if (at < GATE_HALF + 2 || at > n - GATE_HALF - 3) continue;
        const g = make(at);
        if (!nearWater(g.ix + DX[dir]! * 2, g.iz + DZ[dir]! * 2, GATE_HALF + 1)) return g;
      }
    return make(wanted);
  };
  gates.push(gateIn(main, mid + jitter(), true));
  const [left, right, across] = OTHER_WALLS[main];
  if (rng.chance(0.7)) gates.push(gateIn(left, mid + jitter(), false));
  if (rng.chance(0.7)) gates.push(gateIn(right, mid + jitter(), false));
  if (rng.chance(0.5)) gates.push(gateIn(across, mid + jitter(), false));
  return gates;
}

/** The main gate in the `main` wall, and maybe one in each of the others. `gateCell` is 1 on
 * the wall's cells left open for them. */
export function placeGates(site: Site, main: Face): { gates: Gate[]; gateCell: Uint8Array } {
  const { n, rng, idx } = site;
  const gates = chooseGates(n, rng, main, (ix, iz, r) => site.nearWater(ix, iz, r));
  const gateCell = new Uint8Array(n * n);
  for (const g of gates)
    for (let k = -GATE_HALF; k <= GATE_HALF; k++) {
      const along = g.dir === 0 || g.dir === 2;
      gateCell[along ? idx(g.ix, g.iz + k) : idx(g.ix + k, g.iz)] = 1;
    }
  return { gates, gateCell };
}

/** The square: the flattest patch of ground near the middle, away from the river. `at` is its
 * cell. */
export function placeSquare(site: Site): { square: Square; at: number } {
  const { n, cell, idx, corner } = site;
  const mid = Math.floor(n / 2);
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
      const score =
        (hi - lo) / (6 * cell) +
        (0.25 * Math.hypot(ix - mid, iz - mid)) / reach +
        (site.nearWater(ix, iz, 5) ? 10 : 0);
      if (score < sqScore) {
        sqScore = score;
        sq = idx(ix, iz);
      }
    }
  const sqx = sq % n;
  const sqz = (sq - sqx) / n;
  return { square: { x: (sqx + 0.5) * cell, z: (sqz + 0.5) * cell, r: TUNING.city.square }, at: sq };
}

/** A town gate where it stands in the world: the middle of the opening, and the way out. */
export interface WorldGate {
  readonly x: number;
  readonly z: number;
  /** Unit vector pointing out of the town. */
  readonly outX: number;
  readonly outZ: number;
  readonly main: boolean;
}

/**
 * A town's gates without laying the town out: the same choice generateCity makes, reading only
 * the ground near the walls. For the wilderness paths that lead to them.
 */
export function townGates(e: Entrance, w: Pick<Wilderness, 'heightAt'>): WorldGate[] {
  const cell = TUNING.city.cell;
  const n = Math.round((e.chunks * TUNING.world.chunkSize) / cell);
  // the town's corner heights, read only where the gate search looks
  const heights = new Float32Array((n + 1) * (n + 1)).fill(Number.NaN);
  const land: Land = { ox: 0, oz: 0, n, cell, heights };
  const corner = (kx: number, kz: number): void => {
    const i = kz * (n + 1) + kx;
    if (Number.isNaN(heights[i]!)) heights[i] = w.heightAt(e.ox + kx * cell, e.oz + kz * cell);
  };
  const nearWater = (ix: number, iz: number, r: number): boolean => {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = ix + dx;
        const z = iz + dz;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        corner(x, z);
        corner(x + 1, z);
        corner(x, z + 1);
        corner(x + 1, z + 1);
        if (groundAt(land, (x + 0.5) * cell, (z + 0.5) * cell) < WET) return true;
      }
    return false;
  };
  return chooseGates(n, new Rng(e.seed), e.gate, nearWater).map((g) => ({
    x: e.ox + (g.ix + 0.5) * cell,
    z: e.oz + (g.iz + 0.5) * cell,
    outX: -DX[g.dir]!,
    outZ: -DZ[g.dir]!,
    main: g.main,
  }));
}
