// Patches of one plant over a whole stretch of land, each a pure function of (seed, cell) like
// the ruins and springs:
// - bamboo groves: dense stands of swaying bamboo in damp woodland, in place of the trees there
//   (at most one per `GROVE_GRID`×`GROVE_GRID` chunks);
// - flower seas: a whole field of one flower out in the open grassland, in bloom for a few weeks
//   of its season: rapeseed in spring, lavender in summer, cosmos into autumn, red spider lilies
//   in autumn (at most one per `SEA_GRID`×`SEA_GRID` chunks).
// Both have a lobed, irregular edge (`patchMask`) that the meadow flowers and the paint shader
// share, so a sea's wash of colour seen from afar is where its flowers stand close by.
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { smoothstep } from '../math/noise';
import { type Wilderness, WATER_LEVEL } from './generator';

export interface Patch {
  /** `b<gx>_<gz>` for a grove, `f<gx>_<gz>` for a flower sea. */
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Mean radius, metres; the edge wanders in and out of it (see patchMask). */
  readonly r: number;
  /** Phases of the edge's two lobe waves. */
  readonly lobes: readonly [number, number];
  readonly seed: number;
}

export type Grove = Patch;

export interface FlowerSea extends Patch {
  /** Index into SEA_FLOWERS. */
  readonly kind: number;
}

/**
 * What a flower sea can be: its colour, a second colour dotted through it, and when it is in
 * flower (year phases, see `calendarAt`: 0 the first day of spring, 0.25 summer, 0.5 autumn).
 */
export const SEA_FLOWERS = [
  { name: '油菜花', colour: color('yellow'), dot: color('cream'), from: 0.02, to: 0.22 },
  { name: '薰衣草', colour: color('purple'), dot: color('sky'), from: 0.27, to: 0.47 },
  { name: '格桑花', colour: color('pink'), dot: color('cream'), from: 0.4, to: 0.6 },
  { name: '彼岸花', colour: color('red'), dot: color('red'), from: 0.52, to: 0.68 },
] as const;

const SIZE = TUNING.world.chunkSize;
const GROVE_GRID = 3;
const GROVE_CHANCE = 0.6;
const SEA_GRID = 3;
const SEA_CHANCE = 0.55;

/** How far inside a patch (x, z) is: 1 well inside, 0 outside, with a soft, lobed edge. */
export function patchMask(p: Patch, x: number, z: number): number {
  const dx = x - p.x;
  const dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > p.r * 1.3) return 0;
  const a = Math.atan2(dz, dx);
  const edge = p.r * (1 + 0.16 * Math.sin(3 * a + p.lobes[0]) + 0.09 * Math.sin(5 * a + p.lobes[1]));
  return smoothstep(edge, edge * 0.7, d);
}

/** How far a flower sea of `kind` is in bloom at `yearPhase`, 0..1. */
export function bloomOf(kind: number, yearPhase: number): number {
  const f = SEA_FLOWERS[kind]!;
  const p = ((yearPhase % 1) + 1) % 1;
  const ramp = (f.to - f.from) * 0.3;
  return smoothstep(f.from, f.from + ramp, p) * smoothstep(f.to, f.to - ramp, p);
}

/** Whether a patch of radius r round (x, z) is clear of towns and on dry, gentle land. */
function open(w: Wilderness, x: number, z: number, r: number, steep: number): boolean {
  if (Math.hypot(x - SIZE / 2, z - SIZE / 2) < 120) return false;
  if (w.townAt(x, z, r + 15)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 9; k++) {
    const a = (k * Math.PI * 2) / 8;
    const f = k === 8 ? 0 : 0.7;
    const g = w.heightAt(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f);
    if (g < WATER_LEVEL + 0.6) return false;
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  return hi - lo <= steep;
}

/** The k-th independent number in [0, 1) drawn from a hash. */
const roll = (h: number, k: number): number => unit(hashInts(h, k));
const lobesOf = (h: number): [number, number] => [roll(h, 4) * 6.283, roll(h, 5) * 6.283];

/** The bamboo grove of a cell, if it has one: in damp woodland. */
export function groveInCell(w: Wilderness, gx: number, gz: number): Grove | null {
  if (unit(hashAt(w.seed, 'grove', gx, gz)) >= GROVE_CHANCE) return null;
  const span = GROVE_GRID * SIZE;
  for (let a = 0; a < 16; a++) {
    const h = hashAt(w.seed, 'grove-spot', gx, gz, a);
    const x = gx * span + 40 + unit(h) * (span - 80);
    const z = gz * span + 40 + roll(h, 1) * (span - 80);
    const c = w.climate(x, z);
    if (c.moisture < 0.12 || c.relief > 0.3) continue;
    const r = 20 + roll(h, 2) * 16;
    if (!open(w, x, z, r, 9)) continue;
    return { id: `b${gx}_${gz}`, x, z, r, lobes: lobesOf(h), seed: h };
  }
  return null;
}

/** The flower sea of a cell, if it has one: out on open, gently rolling grassland. */
export function seaInCell(w: Wilderness, gx: number, gz: number): FlowerSea | null {
  const h0 = hashAt(w.seed, 'flower-sea', gx, gz);
  if (unit(h0) >= SEA_CHANCE) return null;
  const span = SEA_GRID * SIZE;
  for (let a = 0; a < 16; a++) {
    const h = hashAt(w.seed, 'flower-sea-spot', gx, gz, a);
    const x = gx * span + 40 + unit(h) * (span - 80);
    const z = gz * span + 40 + roll(h, 1) * (span - 80);
    const c = w.climate(x, z);
    if (c.moisture > 0.15 || c.relief > 0.25) continue;
    const r = 22 + roll(h, 2) * 20;
    if (!open(w, x, z, r, 5)) continue;
    const kind = Math.floor(roll(h0, 3) * SEA_FLOWERS.length);
    return { id: `f${gx}_${gz}`, x, z, r, lobes: lobesOf(h), seed: h, kind };
  }
  return null;
}

const groves = new WeakMap<Wilderness, Map<string, Grove | null>>();
const seas = new WeakMap<Wilderness, Map<string, FlowerSea | null>>();

function near<T extends Patch>(
  store: WeakMap<Wilderness, Map<string, T | null>>,
  make: (w: Wilderness, gx: number, gz: number) => T | null,
  grid: number,
  w: Wilderness,
  x: number,
  z: number,
  reach: number,
): T[] {
  let m = store.get(w);
  if (!m) store.set(w, (m = new Map()));
  const cell = (v: number): number => Math.floor(v / (grid * SIZE));
  const out: T[] = [];
  // a patch reaches out up to 1.3 of its radius (42 m at most) past its centre
  const pad = reach + 60;
  for (let gx = cell(x - pad); gx <= cell(x + pad); gx++)
    for (let gz = cell(z - pad); gz <= cell(z + pad); gz++) {
      const key = `${gx},${gz}`;
      if (!m.has(key)) m.set(key, make(w, gx, gz));
      const p = m.get(key);
      if (p && Math.hypot(p.x - x, p.z - z) <= reach + p.r * 1.3) out.push(p);
    }
  return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}

/** Bamboo groves reaching within `reach` metres of (x, z), nearest first. */
export const grovesNear = (w: Wilderness, x: number, z: number, reach: number): Grove[] =>
  near(groves, groveInCell, GROVE_GRID, w, x, z, reach);

/** Flower seas reaching within `reach` metres of (x, z), nearest first. */
export const seasNear = (w: Wilderness, x: number, z: number, reach: number): FlowerSea[] =>
  near(seas, seaInCell, SEA_GRID, w, x, z, reach);
