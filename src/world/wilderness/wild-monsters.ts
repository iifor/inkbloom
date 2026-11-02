// Monsters roaming the wilderness. Where they are is a pure function of (seed, chunk, how
// drained the land is), so the host can re-derive any monster from its id to validate a kill.
// Restoring the nearby city makes the land colourful again and the monsters stop appearing.
import { enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { saturationAt } from './drain';

export interface WildMonster {
  /** `<cx>,<cz>:<k>`; stable across sessions for the same land. */
  readonly id: string;
  readonly type: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const ATTEMPTS = 10;

/** How many monsters a chunk holds at this saturation (0 grey .. 1 full colour). */
export function wildMonsterCount(seed: number, cx: number, cz: number, saturation: number): number {
  const W = TUNING.combat.wild;
  const [lo, hi] = saturation < W.drainedBelow ? W.drained : saturation < W.greyBelow ? W.grey : [0, 0];
  return lo + Math.floor(unit(hashAt(seed, 'wild-count', cx, cz)) * (hi - lo + 1));
}

export function wildMonstersInChunk(
  w: Wilderness,
  cx: number,
  cz: number,
  saturation: number,
): WildMonster[] {
  const size = TUNING.world.chunkSize;
  const cell = TUNING.world.cellSize;
  const n = size / cell;
  const count = wildMonsterCount(w.seed, cx, cz, saturation);
  const entrances = w.entrancesNear((cx + 0.5) * size, (cz + 0.5) * size, 1);
  const out: WildMonster[] = [];
  for (let k = 0; k < count; k++) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const h = hashAt(w.seed, 'wild-monster', cx, cz, k, attempt);
      const x = cx * size + ((h % n) + 0.5) * cell;
      const z = cz * size + (((h >>> 8) % n) + 0.5) * cell;
      const y = w.heightAt(x, z);
      if (y <= WATER_LEVEL + 0.5) continue;
      if (Math.hypot(x, z) < 60) continue; // leave the spawn area calm
      if (entrances.some((e) => Math.hypot(x - e.x, z - e.z) < TUNING.structures.entranceFlatRadius))
        continue;
      const type = unit(h >>> 16) < TUNING.combat.spitterChance ? enemyIndex('spitter') : enemyIndex('blot');
      out.push({ id: `${cx},${cz}:${k}`, type, x, y, z });
      break;
    }
  }
  return out;
}

/** Look a wilderness monster up by id at the given saturation, or null. */
export function wildMonsterById(w: Wilderness, id: string, saturation: number): WildMonster | null {
  const m = /^(-?\d+),(-?\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return wildMonstersInChunk(w, Number(m[1]), Number(m[2]), saturation).find((x) => x.id === id) ?? null;
}

/** Saturation at a chunk's centre, from the progress of the cities around it. */
export function chunkSaturation(
  w: Wilderness,
  cx: number,
  cz: number,
  progressOf: (cityId: string) => number,
): number {
  const size = TUNING.world.chunkSize;
  const x = (cx + 0.5) * size;
  const z = (cz + 0.5) * size;
  const cities = w.entrancesNear(x, z, 1).map((e) => ({ x: e.x, z: e.z, progress: progressOf(e.cityId) }));
  return saturationAt(x, z, cities);
}
