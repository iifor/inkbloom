import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';

/** Independent of layout generation and visit order; old saves override this default. */
export function startsPeaceful(seed: number, cityId: string): boolean {
  const match = /^c(-?\d+)_(-?\d+)$/.exec(cityId);
  if (!match) return false;
  const cx = Number(match[1]);
  const cz = Number(match[2]);
  const [firstX, firstZ] = TUNING.structures.firstCityChunk;
  return (
    (cx === firstX && cz === firstZ) ||
    unit(hashAt(seed, 'peaceful-village', cx, cz)) < TUNING.city.peacefulChance
  );
}
