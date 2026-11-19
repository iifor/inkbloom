import type { CityLayout } from './layout';
import type { Point } from './site';
import { hashAt, unit } from '../math/hash';

const SECTORS = 96;
const TAU = Math.PI * 2;
interface Outline {
  readonly radii: Float64Array;
  readonly points: readonly Point[];
  readonly patches: ReadonlyMap<number, Point>;
}
const cache = new WeakMap<CityLayout, Outline>();

/** Grow the enclosure around existing houses without consuming layout RNG or changing
 * saved surface ids. The square raster remains a storage grid, not a visible border. */
export function villageOutline(city: CityLayout): Outline {
  const old = cache.get(city);
  if (old) return old;
  const half = city.size / 2,
    cx = city.ox + half,
    cz = city.oz + half;
  const phase = unit(hashAt(city.seed, 'village-outline')) * TAU;
  const angle = unit(hashAt(city.seed, 'village-axis')) * Math.PI;
  const radii = new Float64Array(SECTORS);
  for (let i = 0; i < SECTORS; i++) {
    const a = (i / SECTORS) * TAU;
    const ellipse = 0.78 / Math.hypot(Math.cos(a - angle), Math.sin(a - angle) * 1.18);
    radii[i] = half * ellipse * (1 + 0.075 * Math.sin(a * 3 + phase) + 0.045 * Math.cos(a * 5 - phase));
  }
  const include = (x: number, z: number) => {
    const a = Math.atan2(z - cz, x - cx),
      d = Math.hypot(x - cx, z - cz) + 6;
    for (let i = 0; i < SECTORS; i++) {
      const delta = Math.atan2(Math.sin(a - (i / SECTORS) * TAU), Math.cos(a - (i / SECTORS) * TAU));
      const shoulder = Math.max(0, 1 - (delta / 0.26) ** 2);
      if (shoulder > 0) radii[i] = Math.max(radii[i]!, d * shoulder);
    }
  };
  for (const b of city.buildings) {
    const c = Math.cos(b.angle),
      s = Math.sin(b.angle);
    for (const u of [-b.hw - 2, b.hw + 2])
      for (const v of [-b.hd - 2, b.hd + b.garden + 3]) include(b.x + c * u + s * v, b.z - s * u + c * v);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    include(city.square.x + Math.cos(a) * city.square.r, city.square.z + Math.sin(a) * city.square.r);
  }
  // Smooth outward only: soft bends without pulling a wall back through a house.
  for (let pass = 0; pass < 3; pass++) {
    const copy = radii.slice();
    for (let i = 0; i < SECTORS; i++)
      radii[i] = Math.max(
        copy[i]!,
        (copy[(i + SECTORS - 1) % SECTORS]! + 2 * copy[i]! + copy[(i + 1) % SECTORS]!) / 4,
      );
  }
  const points = Array.from(radii, (r, i) => {
    const a = (i / SECTORS) * TAU;
    radii[i] = Math.min(r, (half - city.cell / 2) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))));
    return { x: cx + Math.cos(a) * radii[i]!, z: cz + Math.sin(a) * radii[i]! };
  });
  // Peripheral yards retain real paintable patches outside the enclosure. Their centres
  // must be cells of that yard (a geometric centroid can be inside a house or river).
  const patches = new Map<number, Point>(),
    best = new Map<number, number>();
  for (let i = 0; i < city.groundOf.length; i++) {
    const id = city.groundOf[i]!;
    if (id < 0) continue;
    const x = city.ox + ((i % city.n) + 0.5) * city.cell;
    const z = city.oz + (Math.floor(i / city.n) + 0.5) * city.cell;
    const surface = city.surfaces[id]!;
    const d = (x - surface.x) ** 2 + (z - surface.z) ** 2;
    if (d < (best.get(id) ?? Infinity)) {
      best.set(id, d);
      patches.set(id, { x, z });
    }
  }
  const result = { radii, points, patches };
  cache.set(city, result);
  return result;
}

/** Signed radial distance, positive outside. */
export function outlineDistance(city: CityLayout, x: number, z: number): number {
  const { radii } = villageOutline(city);
  const dx = x - city.ox - city.size / 2,
    dz = z - city.oz - city.size / 2;
  const t = ((Math.atan2(dz, dx) / TAU + 1) % 1) * SECTORS;
  const i = Math.floor(t),
    f = t - i;
  return Math.hypot(dx, dz) - (radii[i]! * (1 - f) + radii[(i + 1) % SECTORS]! * f);
}

/** Stable ragged ground edge, using the footpath shader's mask. Every saved yard keeps
 * an uncut centre so restoration remains possible, including beyond the enclosure. */
export function villageGroundEdge(city: CityLayout, surface: number, x: number, z: number): number {
  const { patches } = villageOutline(city);
  let distance = outlineDistance(city, x, z) - 3;
  const patch = patches.get(surface);
  if (patch) distance = Math.min(distance, Math.hypot(x - patch.x, z - patch.z) - 5);
  return Math.max(0, 0.5 + distance / 5);
}
