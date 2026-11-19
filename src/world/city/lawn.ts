import { color } from '@/content/palette';
import type { CityLayout } from './layout';
import { villageGroundEdge } from './outline';

/** Where a town is paved (its streets' strips and the square), a metre to a cell, with half a
 * metre to spare; worked out once a town. */
const paving = new WeakMap<CityLayout, Uint8Array>();
function pavingOf(l: CityLayout): Uint8Array {
  let grid = paving.get(l);
  if (grid) return grid;
  const side = l.n * l.cell;
  grid = new Uint8Array(side * side);
  const stamp = (cx: number, cz: number, r: number, inside: (x: number, z: number) => boolean): void => {
    for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(side - 1, Math.ceil(cz + r)); z++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(side - 1, Math.ceil(cx + r)); x++)
        if (inside(x + 0.5, z + 0.5)) grid![z * side + x] = 1;
  };
  for (const st of l.streets) {
    const half = st.width / 2 + 0.5;
    for (let k = 0; k + 1 < st.points.length; k++) {
      const a = st.points[k]!;
      const b = st.points[k + 1]!;
      const ax = a.x - l.ox,
        az = a.z - l.oz,
        bx = b.x - l.ox,
        bz = b.z - l.oz;
      const len2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const r = Math.hypot(bx - ax, bz - az) / 2 + half;
      stamp((ax + bx) / 2, (az + bz) / 2, r, (x, z) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2));
        return Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)) < half;
      });
    }
  }
  const sq = l.square;
  stamp(
    sq.x - l.ox,
    sq.z - l.oz,
    sq.r + 1,
    (x, z) => Math.hypot(x - (sq.x - l.ox), z - (sq.z - l.oz)) < sq.r + 0.5,
  );
  paving.set(l, grid);
  return grid;
}
/** Yard colours that are lawn. */
const GRASSY = new Set([color('grass'), color('green')]);
/** -1 paving, house, water or outside; 0 bare yard; 1 grass. */
export function villageLawnKind(l: CityLayout, px: number, pz: number): -1 | 0 | 1 {
  const paved = pavingOf(l);
  const ix = Math.floor((px - l.ox) / l.cell);
  const iz = Math.floor((pz - l.oz) / l.cell);
  if (ix < 0 || iz < 0 || ix >= l.n || iz >= l.n) return -1;
  const i = iz * l.n + ix;
  if (l.buildingOf[i] || l.water[i]) return -1;
  const side = l.n * l.cell;
  const mx = Math.floor(px - l.ox);
  const mz = Math.floor(pz - l.oz);
  if (paved[mz * side + mx]) return -1;
  const s = l.groundOf[i]!;
  return s < 0 || GRASSY.has(l.surfaces[s]!.color) || villageGroundEdge(l, s, px, pz) > 0.5 ? 1 : 0;
}
