// Monsters roaming the wilderness. Where they are is a pure function of (seed, chunk, how
// drained the land is), so the host can re-derive any monster from its id to validate a kill.
// Restoring the nearby city makes the land colourful again and the monsters stop appearing.
// A chunk with a seeping ink well also has its guards (see ink-wells.ts).
import { enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { influenceOf, saturationAt } from './drain';
import { inkWellInChunk, wellGuards } from './ink-wells';

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

/** A chunk's monsters, its ink well's guards among them (unless the well is `cleansed`). */
export function wildMonstersInChunk(
  w: Wilderness,
  cx: number,
  cz: number,
  saturation: number,
  cleansed = false,
): WildMonster[] {
  const size = TUNING.world.chunkSize;
  const cell = TUNING.world.cellSize;
  const n = size / cell;
  const count = wildMonsterCount(w.seed, cx, cz, saturation);
  const out: WildMonster[] = [];
  for (let k = 0; k < count; k++) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const h = hashAt(w.seed, 'wild-monster', cx, cz, k, attempt);
      const x = cx * size + ((h % n) + 0.5) * cell;
      const z = cz * size + (((h >>> 8) % n) + 0.5) * cell;
      const y = w.heightAt(x, z);
      if (y <= WATER_LEVEL + 0.5) continue;
      if (Math.hypot(x, z) < 60) continue; // leave the spawn area calm
      if (w.townAt(x, z, TUNING.structures.townClearance)) continue;
      const giant =
        k === 0 &&
        saturation < TUNING.combat.wild.drainedBelow &&
        unit(hashAt(w.seed, 'wild-giant', cx, cz)) < TUNING.combat.giantChance.wild;
      // its own hash for the kind: `h` shifted down is too few bits for `unit` (that made every
      // wild monster a spitter)
      const kind = unit(hashAt(w.seed, 'wild-kind', cx, cz, k));
      const type = giant
        ? enemyIndex('giant')
        : kind < TUNING.combat.spitterChance
          ? enemyIndex('spitter')
          : kind <
              TUNING.combat.spitterChance + (1 - TUNING.combat.spitterChance) * TUNING.combat.weaselChance
            ? enemyIndex('weasel')
            : enemyIndex('blot');
      out.push({ id: `${cx},${cz}:${k}`, type, x, y, z });
      break;
    }
  }
  const well = inkWellInChunk(w, cx, cz);
  if (well) out.push(...wellGuards(w, well, saturation, cleansed));
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
  const cities = w.entrancesNear(x, z, 1).map((e) => influenceOf(e, progressOf(e.cityId)));
  return saturationAt(x, z, cities);
}
