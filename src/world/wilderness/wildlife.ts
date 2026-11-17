// Where the wild animals live, as a pure function of (seed, cell) like the ruins and springs:
// a herd of deer grazes the open ground at the edge of a wood, at most one herd per
// `HERD_GRID`×`HERD_GRID` chunks. Only where they live is shared; how they wander and bolt is
// each client's own (they are scenery, nothing hunts them).
import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { pathsOf } from './paths';

export interface Herd {
  /** `d<gx>_<gz>` */
  readonly id: string;
  /** Where it grazes. */
  readonly x: number;
  readonly z: number;
  /** Deer in it. */
  readonly count: number;
  readonly seed: number;
}

const SIZE = TUNING.world.chunkSize;
const HERD_GRID = 2;
const HERD_CHANCE = 0.6;
/** Moisture where the woods begin (see content/biomes.ts RULES). */
const WOODS = 0.15;

/** The herd of a cell, if it has one: in a meadow with woods close by to run to. */
export function herdInCell(w: Wilderness, gx: number, gz: number): Herd | null {
  const h0 = hashAt(w.seed, 'herd', gx, gz);
  if (unit(h0) >= HERD_CHANCE) return null;
  const span = HERD_GRID * SIZE;
  for (let a = 0; a < 16; a++) {
    const h = hashAt(w.seed, 'herd-spot', gx, gz, a);
    const x = gx * span + 20 + unit(h) * (span - 40);
    const z = gz * span + 20 + unit(hashInts(h, 1)) * (span - 40);
    if (Math.hypot(x - SIZE / 2, z - SIZE / 2) < 90) continue;
    const c = w.climate(x, z);
    if (c.moisture >= WOODS || c.moisture < WOODS - 0.12 || c.relief > 0.35) continue;
    // the woods' edge within a short dash
    let woods = false;
    for (let k = 0; k < 8 && !woods; k++) {
      const ang = (k * Math.PI) / 4;
      woods = w.climate(x + Math.cos(ang) * 45, z + Math.sin(ang) * 45).moisture >= WOODS;
    }
    if (!woods) continue;
    const y = w.heightAt(x, z);
    if (y < WATER_LEVEL + 1) continue;
    if (w.townAt(x, z, 60)) continue;
    if (pathsOf(w).edgeDistance(x, z) < 10) continue;
    return { id: `d${gx}_${gz}`, x, z, count: 3 + Math.floor(unit(hashInts(h0, 2)) * 4), seed: h };
  }
  return null;
}

const herds = new WeakMap<Wilderness, Map<string, Herd | null>>();

/** Herds grazing within `reach` metres of (x, z), nearest first. */
export function herdsNear(w: Wilderness, x: number, z: number, reach: number): Herd[] {
  let m = herds.get(w);
  if (!m) herds.set(w, (m = new Map()));
  const cell = (v: number): number => Math.floor(v / (HERD_GRID * SIZE));
  const out: Herd[] = [];
  for (let gx = cell(x - reach); gx <= cell(x + reach); gx++)
    for (let gz = cell(z - reach); gz <= cell(z + reach); gz++) {
      const key = `${gx},${gz}`;
      if (!m.has(key)) m.set(key, herdInCell(w, gx, gz));
      const herd = m.get(key);
      if (herd && Math.hypot(herd.x - x, herd.z - z) <= reach) out.push(herd);
    }
  return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}
