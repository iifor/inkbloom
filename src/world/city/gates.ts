// Step 1 of a town's layout: gates in the wall round it, the main one in the wall the town is
// entered by, and a square on the flattest ground near the middle.
import { TUNING } from '@/content/tuning';
import { DX, DZ, type Face, GATE_HALF, type Point, type Site } from './site';

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

/** The main gate in the `main` wall, and maybe one in each of the others. `gateCell` is 1 on
 * the wall's cells left open for them. */
export function placeGates(site: Site, main: Face): { gates: Gate[]; gateCell: Uint8Array } {
  const { n, rng, idx } = site;
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
        if (!site.nearWater(g.ix + DX[dir]! * 2, g.iz + DZ[dir]! * 2, GATE_HALF + 1)) return g;
      }
    return make(wanted);
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
