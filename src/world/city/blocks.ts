// Block (city chunk) rules as pure functions of the skeleton and the surface states. Nothing
// here is saved: a block's state is read from how much of it has colour.
import { TUNING } from '@/content/tuning';
import { coloredRatio, isColored, type SurfaceInfo } from '../paint/surfaces';

export type BlockState = 'drained' | 'cleared' | 'colored' | 'thriving';

export const BLOCK_NAMES: Record<BlockState, string> = {
  drained: '抽色',
  cleared: '清理中',
  colored: '有色',
  thriving: '繁荣',
};

export function blockState(ratio: number): BlockState {
  const b = TUNING.blocks;
  if (ratio >= b.thrivingAt) return 'thriving';
  if (ratio >= b.coloredAt) return 'colored';
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

/** The neighbouring block in a direction, or -1 at the city edge. */
export function neighbour(chunk: number, dir: number, side: number = TUNING.city.chunks): number {
  const x = (chunk % side) + DIRS[dir]![0];
  const z = Math.floor(chunk / side) + DIRS[dir]![1];
  return x < 0 || z < 0 || x >= side || z >= side ? -1 : z * side + x;
}

export function blockStates(
  states: Uint8Array,
  surfaces: readonly SurfaceInfo[],
  side: number = TUNING.city.chunks,
): BlockState[] {
  return Array.from({ length: side * side }, (_, c) => blockState(coloredRatio(states, surfaces, c)));
}

/** Drained neighbours of a block, as directions. Empty for blocks that are safe. */
export function drainedSides(
  blocks: readonly BlockState[],
  chunk: number,
  side: number = TUNING.city.chunks,
): number[] {
  const out: number[] = [];
  for (let d = 0; d < 4; d++) {
    const nb = neighbour(chunk, d, side);
    if (nb >= 0 && blocks[nb] === 'drained') out.push(d);
  }
  return out;
}

/** Blocks that erode: cleared (not yet coloured) and touching a drained block. */
export function erodingBlocks(blocks: readonly BlockState[], side: number = TUNING.city.chunks): number[] {
  return blocks.flatMap((b, c) => (b === 'cleared' && drainedSides(blocks, c, side).length ? [c] : []));
}

/** Where an ink tide can strike: any cleared or coloured block with a drained neighbour. */
export function tideTargets(
  blocks: readonly BlockState[],
  side: number = TUNING.city.chunks,
): { chunk: number; from: number }[] {
  const out: { chunk: number; from: number }[] = [];
  blocks.forEach((b, c) => {
    if (b !== 'cleared' && b !== 'colored') return;
    for (const from of drainedSides(blocks, c, side)) out.push({ chunk: c, from });
  });
  return out;
}

/** World-space bounds of a block. */
export function blockBounds(
  chunk: number,
  citySize: number,
  side: number = TUNING.city.chunks,
): { x0: number; z0: number; x1: number; z1: number } {
  const per = citySize / side;
  const x0 = (chunk % side) * per;
  const z0 = Math.floor(chunk / side) * per;
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
  citySize: number,
): number {
  const bounds = blockBounds(chunk, citySize);
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
