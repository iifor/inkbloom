import { TUNING } from '@/content/tuning';
import type { Entrance, Wilderness } from './generator';

export interface SettlementLink {
  readonly id: string;
  readonly a: Entrance;
  readonly b: Entrance;
}

/** A bounded relative-neighbourhood graph: nearby villages connect unless a third
 * village provides a shorter route on both sides. Includes diagonals and skips empty cells. */
export function createSettlementLinks(w: Wilderness) {
  const cache = new Map<string, readonly SettlementLink[]>();
  const reach = TUNING.structures.cityGrid * TUNING.world.chunkSize * 1.8;
  const distance = (a: Entrance, b: Entrance) => Math.hypot(a.x - b.x, a.z - b.z);
  return (a: Entrance): readonly SettlementLink[] => {
    const known = cache.get(a.cityId);
    if (known) return known;
    const nearby = w
      .entrancesNear(a.x, a.z, 2)
      .filter((b) => b.cityId !== a.cityId && distance(a, b) <= reach);
    const links = nearby
      .filter((b) => {
        const ab = distance(a, b);
        return !nearby.some((c) => c !== b && distance(a, c) < ab && distance(b, c) < ab);
      })
      .map((b) => {
        const [from, to] = a.cityId < b.cityId ? [a, b] : [b, a];
        return { id: `t:${from.cityId}:${to.cityId}`, a: from, b: to };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    cache.set(a.cityId, links);
    return links;
  };
}
