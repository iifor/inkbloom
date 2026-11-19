import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';

export type SettlementSize = 'small' | 'medium' | 'town';
export type BoundaryKind = 'fence' | 'wall' | 'stone' | 'none';

export function settlementSize(chunks: number): SettlementSize {
  return chunks <= 2 ? 'small' : chunks <= 3 ? 'medium' : 'town';
}

/** Independent rolls: changing a boundary must not move houses or change the town's size. */
export function settlementChunks(seed: number, cx: number, cz: number): number {
  const roll = unit(hashAt(seed, 'settlement-size', cx, cz));
  const sizes = TUNING.city.settlements;
  const range =
    roll < sizes.smallShare
      ? sizes.small
      : roll < sizes.smallShare + sizes.mediumShare
        ? sizes.medium
        : sizes.town;
  return range[hashAt(seed, 'settlement-size-variant', cx, cz) % range.length]!;
}

export function settlementBoundary(seed: number, chunks: number): BoundaryKind {
  const typical = { small: 'fence', medium: 'wall', town: 'stone' } as const;
  const main = typical[settlementSize(chunks)];
  if (unit(hashAt(seed, 'settlement-boundary')) < TUNING.city.settlements.typicalBoundary) return main;
  const others = (['fence', 'wall', 'stone', 'none'] as const).filter((kind) => kind !== main);
  return others[hashAt(seed, 'settlement-boundary-other') % others.length]!;
}
