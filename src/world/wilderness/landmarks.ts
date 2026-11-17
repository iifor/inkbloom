// Natural landmarks in the wilderness, each a pure function of (seed, cell) like the ruins:
// - hot springs: a steaming pool ringed with rocks on a gentle shelf in the hills, at most one
//   per `SPRING_GRID`×`SPRING_GRID` chunks;
// - lookouts: a cairn with a flag on the highest point of each `LOOKOUT_GRID`×`LOOKOUT_GRID`
//   chunks, where that point is high enough to see from: something to climb toward.
// Both keep clear of towns, ruins and footpaths.
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { pathsOf } from './paths';
import { ruinCellOf, ruinInCell } from './ruins';

export interface Spring {
  /** `s<gx>_<gz>` */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Ground height at the middle; the water lies a little above it. */
  readonly y: number;
  /** Pool radius, metres. */
  readonly r: number;
  readonly seed: number;
}

export interface Lookout {
  /** `l<gx>_<gz>` */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  /** Palette index of its flag. */
  readonly flag: number;
  readonly seed: number;
}

const SIZE = TUNING.world.chunkSize;
const SPRING_GRID = 5;
const SPRING_CHANCE = 0.5;
const LOOKOUT_GRID = 3;
/** A lookout needs at least this much height, metres (the plains are 0–10). */
const LOOKOUT_HEIGHT = 15;
const FLAGS = [color('red'), color('blue'), color('yellow'), color('orange')];

/** Whether a spot is clear of towns, the ruin of its cell, and footpaths. */
function clear(w: Wilderness, x: number, z: number, room: number): boolean {
  if (w.townAt(x, z, room + 20)) return false;
  const r = ruinInCell(w, ruinCellOf(Math.floor(x / SIZE)), ruinCellOf(Math.floor(z / SIZE)));
  if (r && Math.hypot(r.x - x, r.z - z) < room + 20) return false;
  return pathsOf(w).edgeDistance(x, z) > room;
}

/** The hot spring of a cell, if it has one. */
export function springInCell(w: Wilderness, gx: number, gz: number): Spring | null {
  const h0 = hashAt(w.seed, 'spring', gx, gz);
  if (unit(h0) >= SPRING_CHANCE) return null;
  const span = SPRING_GRID * SIZE;
  for (let a = 0; a < 24; a++) {
    const h = hashAt(w.seed, 'spring-spot', gx, gz, a);
    const x = gx * span + 30 + unit(h) * (span - 60);
    const z = gz * span + 30 + unit(hashInts(h, 1)) * (span - 60);
    if (Math.hypot(x - SIZE / 2, z - SIZE / 2) < 150) continue;
    // in hilly country, above the valley floor
    if (w.climate(x, z).relief < -0.15) continue;
    const y = w.heightAt(x, z);
    if (y < WATER_LEVEL + 2.5) continue;
    const r = 2.6 + unit(hashInts(h, 2)) * 1.6;
    // a level shelf for the pool and its ring of rocks
    let lo = y;
    let hi = y;
    for (let k = 0; k < 8; k++) {
      const g = w.heightAt(
        x + Math.cos((k * Math.PI) / 4) * (r + 2),
        z + Math.sin((k * Math.PI) / 4) * (r + 2),
      );
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    if (hi - lo > 1.2) continue;
    if (!clear(w, x, z, r + 6)) continue;
    return { id: `s${gx}_${gz}`, x, z, y, r, seed: h };
  }
  return null;
}

/** The lookout of a cell: its highest ground, if that is high enough and clear. */
export function lookoutInCell(w: Wilderness, gx: number, gz: number): Lookout | null {
  const span = LOOKOUT_GRID * SIZE;
  const x0 = gx * span;
  const z0 = gz * span;
  // a coarse search for the highest ground, then a fine one round it (not at the cell's edge,
  // so a summit split between cells gets one lookout, in the cell its top is in)
  let bx = 0;
  let bz = 0;
  let by = -Infinity;
  for (let i = 1; i < 16; i++)
    for (let k = 1; k < 16; k++) {
      const x = x0 + (i / 16) * span;
      const z = z0 + (k / 16) * span;
      const y = w.heightAt(x, z);
      if (y > by) [bx, bz, by] = [x, z, y];
    }
  for (let i = -6; i <= 6; i++)
    for (let k = -6; k <= 6; k++) {
      const x = bx + i * 4;
      const z = bz + k * 4;
      if (x < x0 + 8 || z < z0 + 8 || x > x0 + span - 8 || z > z0 + span - 8) continue;
      const y = w.heightAt(x, z);
      if (y > by) [bx, bz, by] = [x, z, y];
    }
  // then up to the true top: step to higher ground round about until there is none. A summit
  // whose top is over the cell's edge belongs to the cell next door, which finds it too.
  for (let step = 0; step < 40; step++) {
    let moved = false;
    for (const d of [3, 8, 16])
      for (let k = 0; k < 8; k++) {
        const x = bx + Math.cos((k * Math.PI) / 4) * d;
        const z = bz + Math.sin((k * Math.PI) / 4) * d;
        const y = w.heightAt(x, z);
        if (y > by + 0.05) {
          [bx, bz, by] = [x, z, y];
          moved = true;
        }
      }
    if (!moved) break;
  }
  if (bx < x0 || bz < z0 || bx >= x0 + span || bz >= z0 + span) return null;
  if (by < LOOKOUT_HEIGHT) return null;
  if (!clear(w, bx, bz, 4)) return null;
  const h = hashAt(w.seed, 'lookout', gx, gz);
  return { id: `l${gx}_${gz}`, x: bx, z: bz, y: by, flag: FLAGS[h % FLAGS.length]!, seed: h };
}

/** A spring's water level: just over the highest ground under the pool, so none shows through. */
export function springLevel(s: Spring, w: Pick<Wilderness, 'heightAt'>): number {
  let top = w.heightAt(s.x, s.z);
  for (let k = 0; k < 8; k++)
    for (const f of [0.6, 1]) {
      const a = (k * Math.PI) / 4;
      top = Math.max(top, w.heightAt(s.x + Math.cos(a) * s.r * f, s.z + Math.sin(a) * s.r * f));
    }
  return top + 0.08;
}

const springs = new WeakMap<Wilderness, Map<string, Spring | null>>();
const lookouts = new WeakMap<Wilderness, Map<string, Lookout | null>>();
function cached<T>(
  store: WeakMap<Wilderness, Map<string, T | null>>,
  w: Wilderness,
  key: string,
  make: () => T | null,
): T | null {
  let m = store.get(w);
  if (!m) store.set(w, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key)!;
}

const cellOf = (v: number, grid: number): number => Math.floor(v / (grid * SIZE));

/** Hot springs whose middle is in this chunk. */
export function springsInChunk(w: Wilderness, cx: number, cz: number): Spring[] {
  const gx = Math.floor(cx / SPRING_GRID);
  const gz = Math.floor(cz / SPRING_GRID);
  const s = cached(springs, w, `${gx},${gz}`, () => springInCell(w, gx, gz));
  return s && Math.floor(s.x / SIZE) === cx && Math.floor(s.z / SIZE) === cz ? [s] : [];
}

/** Lookouts whose cairn is in this chunk. */
export function lookoutsInChunk(w: Wilderness, cx: number, cz: number): Lookout[] {
  const gx = Math.floor(cx / LOOKOUT_GRID);
  const gz = Math.floor(cz / LOOKOUT_GRID);
  const l = cached(lookouts, w, `${gx},${gz}`, () => lookoutInCell(w, gx, gz));
  return l && Math.floor(l.x / SIZE) === cx && Math.floor(l.z / SIZE) === cz ? [l] : [];
}

/** Hot springs within `reach` metres of (x, z), nearest first. */
export function springsNear(w: Wilderness, x: number, z: number, reach: number): Spring[] {
  const out: Spring[] = [];
  for (let gx = cellOf(x - reach, SPRING_GRID); gx <= cellOf(x + reach, SPRING_GRID); gx++)
    for (let gz = cellOf(z - reach, SPRING_GRID); gz <= cellOf(z + reach, SPRING_GRID); gz++) {
      const s = cached(springs, w, `${gx},${gz}`, () => springInCell(w, gx, gz));
      if (s && Math.hypot(s.x - x, s.z - z) <= reach) out.push(s);
    }
  return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}
