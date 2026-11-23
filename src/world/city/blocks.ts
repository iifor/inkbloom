// Street colour determines block state; existing studio production also counts towards prosperity.
import { TUNING } from '@/content/tuning';
import { coloredRatio, isColored, type SurfaceInfo } from '../paint/surfaces';

export type BlockState = 'drained' | 'cleared' | 'colored' | 'thriving';

export const BLOCK_NAMES: Record<BlockState, string> = {
  drained: '抽色',
  cleared: '清理中',
  colored: '有色',
  thriving: '繁荣',
};

/** Naturally full-colour blocks and older fully restored blocks have no recorded start.
 * They use the world clock origin until their first collection. */
export function studioStockSince(ratio: number, recorded = -1): number {
  if (recorded >= 0) return recorded;
  return ratio >= TUNING.blocks.thrivingAt ? 0 : -1;
}

/** A studio that already produces keeps its thriving status while the block has colour. */
export function blockState(ratio: number, stockFrom = -1): BlockState {
  const b = TUNING.blocks;
  if (ratio >= b.coloredAt) return studioStockSince(ratio, stockFrom) >= 0 ? 'thriving' : 'colored';
  if (ratio >= b.clearedAt) return 'cleared';
  return 'drained';
}

/** Directions between blocks: 0 +x, 1 +z, 2 -x, 3 -z. */
export const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** A city's block grid: `chunks` blocks per side, `size` metres per side, its north-west
 * corner at (ox, oz) (the origin when left out). */
export interface CityGrid {
  readonly size: number;
  readonly chunks: number;
  readonly ox?: number;
  readonly oz?: number;
}

/** Side length of a square block list. */
const sideOf = (blocks: readonly unknown[]): number => Math.round(Math.sqrt(blocks.length));

/** The neighbouring block in a direction, or -1 at the city edge. */
export function neighbour(chunk: number, dir: number, side: number): number {
  const x = (chunk % side) + DIRS[dir]![0];
  const z = Math.floor(chunk / side) + DIRS[dir]![1];
  return x < 0 || z < 0 || x >= side || z >= side ? -1 : z * side + x;
}

export function blockStates(
  states: Uint8Array,
  surfaces: readonly SurfaceInfo[],
  side: number,
  stockFrom: readonly number[] = [],
): BlockState[] {
  return Array.from({ length: side * side }, (_, c) =>
    blockState(coloredRatio(states, surfaces, c), stockFrom[c]),
  );
}

/** Drained neighbours of a block, as directions. Empty for blocks that are safe. */
export function drainedSides(blocks: readonly BlockState[], chunk: number): number[] {
  const side = sideOf(blocks);
  const out: number[] = [];
  for (let d = 0; d < 4; d++) {
    const nb = neighbour(chunk, d, side);
    if (nb >= 0 && blocks[nb] === 'drained') out.push(d);
  }
  return out;
}

/** Blocks that erode: cleared (not yet coloured) and touching a drained block. */
export function erodingBlocks(blocks: readonly BlockState[]): number[] {
  return blocks.flatMap((b, c) => (b === 'cleared' && drainedSides(blocks, c).length ? [c] : []));
}

/** Where an ink tide can strike: any cleared or coloured block with a drained neighbour. */
export function tideTargets(blocks: readonly BlockState[]): { chunk: number; from: number }[] {
  const out: { chunk: number; from: number }[] = [];
  blocks.forEach((b, c) => {
    if (b !== 'cleared' && b !== 'colored') return;
    for (const from of drainedSides(blocks, c)) out.push({ chunk: c, from });
  });
  return out;
}

/** World-space bounds of a block. */
export function blockBounds(
  chunk: number,
  grid: CityGrid,
): { x0: number; z0: number; x1: number; z1: number } {
  const per = grid.size / grid.chunks;
  const x0 = (grid.ox ?? 0) + (chunk % grid.chunks) * per;
  const z0 = (grid.oz ?? 0) + Math.floor(chunk / grid.chunks) * per;
  return { x0, z0, x1: x0 + per, z1: z0 + per };
}

/**
 * How far a surface is from the edge a drain comes in through (metres into the block).
 * Erosion and tides take surfaces in this order, so colour visibly recedes from that side.
 */
export function depthFrom(info: SurfaceInfo, from: number, bounds: ReturnType<typeof blockBounds>): number {
  switch (from) {
    case 0:
      return bounds.x1 - info.x;
    case 1:
      return bounds.z1 - info.z;
    case 2:
      return info.x - bounds.x0;
    default:
      return info.z - bounds.z0;
  }
}

/** The coloured surface of a block nearest the given edge, or -1 if none has colour. */
export function nextToErode(
  states: Uint8Array,
  surfaces: readonly SurfaceInfo[],
  chunk: number,
  from: number,
  grid: CityGrid,
): number {
  const bounds = blockBounds(chunk, grid);
  let best = -1;
  let bestD = Infinity;
  surfaces.forEach((s, i) => {
    if (s.chunk !== chunk || !isColored(states[i]!)) return;
    const d = depthFrom(s, from, bounds);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
