// Wilderness ruins, one chance per `ruinGrid`×`ruinGrid` chunks (like Minecraft structures).
// Each holds a crayon of one paintable colour. Pure function of (seed, cell).
import { PAINTABLE } from '@/content/palette';
import { RUINS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';

export interface Ruin {
  /** `r<gx>_<gz>` */
  readonly id: string;
  readonly template: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Palette index of the crayon it holds. */
  readonly color: number;
  readonly seed: number;
}

const S = TUNING.structures;
const ATTEMPTS = 12;

export function ruinCellOf(chunk: number): number {
  return Math.floor(chunk / S.ruinGrid);
}

export function ruinInCell(w: Wilderness, gx: number, gz: number): Ruin | null {
  const h0 = hashAt(w.seed, 'ruin', gx, gz);
  if (unit(h0) >= S.ruinChance) return null;
  const size = TUNING.world.chunkSize;
  const span = S.ruinGrid * size;
  for (let a = 0; a < ATTEMPTS; a++) {
    const h = hashAt(w.seed, 'ruin-spot', gx, gz, a);
    const x = gx * span + 24 + unit(h) * (span - 48);
    const z = gz * span + 24 + unit(h >>> 9) * (span - 48);
    const y = w.heightAt(x, z);
    if (y <= WATER_LEVEL + 0.75) continue;
    if (Math.hypot(x, z) < 80) continue;
    if (w.entrancesNear(x, z, 1).some((e) => Math.hypot(x - e.x, z - e.z) < S.entranceFlatRadius + 20))
      continue;
    return {
      id: `r${gx}_${gz}`,
      template: h0 % RUINS.length,
      x,
      y,
      z,
      color: PAINTABLE[(h0 >>> 8) % PAINTABLE.length]!,
      seed: h,
    };
  }
  return null;
}

/** Ruins whose centre lies in this chunk. */
export function ruinsInChunk(w: Wilderness, cx: number, cz: number): Ruin[] {
  const r = ruinInCell(w, ruinCellOf(cx), ruinCellOf(cz));
  const size = TUNING.world.chunkSize;
  return r && Math.floor(r.x / size) === cx && Math.floor(r.z / size) === cz ? [r] : [];
}

export function ruinById(w: Wilderness, id: string): Ruin | null {
  const m = /^r(-?\d+)_(-?\d+)$/.exec(id);
  if (!m) return null;
  const r = ruinInCell(w, Number(m[1]), Number(m[2]));
  return r?.id === id ? r : null;
}
