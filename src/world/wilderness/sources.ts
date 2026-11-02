// Where pigment sources sit in the wilderness. Pure function of (seed, chunk), so a source id
// alone is enough to look it up again (the host validating a guest's harvest does exactly that).
import { BIOMES } from '@/content/biomes';
import { PIGMENT_SOURCES, type Placement } from '@/content/pigment-sources';
import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';

export interface PigmentSource {
  /** `<cx>,<cz>:<kind index>`; stable across sessions. */
  readonly id: string;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  readonly amount: number;
  readonly ink: number;
}

const ATTEMPTS = 16;

function fits(placement: Placement, h: number): boolean {
  switch (placement) {
    case 'land':
      return h > WATER_LEVEL + 0.75;
    case 'shore':
      return h >= WATER_LEVEL + 0.25 && h <= WATER_LEVEL + 1.75;
    case 'high':
      return h >= 8;
  }
}

export function sourcesInChunk(w: Wilderness, cx: number, cz: number): PigmentSource[] {
  const size = TUNING.world.chunkSize;
  const cell = TUNING.world.cellSize;
  const n = size / cell;
  const out: PigmentSource[] = [];
  const entrances = w.entrancesNear((cx + 0.5) * size, (cz + 0.5) * size, 1);
  PIGMENT_SOURCES.forEach((def, kind) => {
    const roll = hashAt(w.seed, 'source', cx, cz, kind);
    if (unit(roll) >= def.perChunk) return;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const h = hashAt(w.seed, 'source-cell', cx, cz, kind, attempt);
      const ix = h % n;
      const iz = (h >>> 8) % n;
      const x = cx * size + (ix + 0.5) * cell;
      const z = cz * size + (iz + 0.5) * cell;
      const biome = BIOMES[w.biomeAt(x, z)]!.key;
      if (!(def.biomes as readonly string[]).includes(biome)) continue;
      const y = w.heightAt(x, z);
      if (!fits(def.placement, y)) continue;
      if (Math.hypot(x, z) < 12) continue;
      if (entrances.some((e) => Math.hypot(x - e.x, z - e.z) < TUNING.structures.entranceFlatRadius))
        continue;
      out.push({
        id: `${cx},${cz}:${kind}`,
        kind,
        x,
        y,
        z,
        color: def.colors[(h >>> 16) % def.colors.length]!,
        amount: def.amount,
        ink: def.ink,
      });
      return;
    }
  });
  return out;
}

/** Look a source up by id, or null if the id does not name one. */
export function sourceById(w: Wilderness, id: string): PigmentSource | null {
  const m = /^(-?\d+),(-?\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return sourcesInChunk(w, Number(m[1]), Number(m[2])).find((s) => s.id === id) ?? null;
}
