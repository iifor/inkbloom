import { describe, expect, it } from 'vitest';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import {
  blockBounds,
  blockState,
  blockStates,
  depthFrom,
  drainedSides,
  erodingBlocks,
  neighbour,
  nextToErode,
  tideTargets,
  type BlockState,
} from '@/world/city/blocks';
import { generateCity } from '@/world/city/layout';
import { ORIGINAL, type SurfaceInfo } from '@/world/paint/surfaces';

const B = TUNING.blocks;

describe('block states', () => {
  it('follow the colour thresholds', () => {
    expect(blockState(0)).toBe('drained');
    expect(blockState(B.clearedAt)).toBe('cleared');
    expect(blockState(B.coloredAt - 0.01)).toBe('cleared');
    expect(blockState(B.coloredAt)).toBe('colored');
    expect(blockState(B.coloredAt, false)).toBe('colored');
    expect(blockState(B.coloredAt, true)).toBe('thriving');
    expect(blockState(B.coloredAt - 0.01, true)).toBe('cleared');
  });

  it('find neighbours and stop at the city edge', () => {
    expect(neighbour(0, 0, 3)).toBe(1);
    expect(neighbour(0, 1, 3)).toBe(3);
    expect(neighbour(0, 2, 3)).toBe(-1);
    expect(neighbour(0, 3, 3)).toBe(-1);
    expect(neighbour(8, 0, 3)).toBe(-1);
  });

  // 3×3:  D C K
  //       D T D
  //       K K K     (D drained, C cleared, K coloured, T thriving)
  const grid: BlockState[] = [
    'drained',
    'cleared',
    'colored',
    'drained',
    'thriving',
    'drained',
    'colored',
    'colored',
    'colored',
  ];

  it('erode only cleared blocks touching a drained one', () => {
    expect(erodingBlocks(grid)).toEqual([1]);
    expect(drainedSides(grid, 1)).toEqual([2]); // drained block 0 is to its west
  });

  it('send tides at cleared or coloured blocks next to drained ones, never thriving ones', () => {
    const targets = tideTargets(grid);
    expect(targets).toContainEqual({ chunk: 1, from: 2 });
    expect(targets).toContainEqual({ chunk: 2, from: 1 }); // block 5 below is drained
    expect(targets.some((t) => t.chunk === 4)).toBe(false);
    expect(targets.some((t) => t.chunk === 7)).toBe(false); // coloured but no drained neighbour
  });
});

describe('erosion order', () => {
  const city = { size: TUNING.city.chunks * TUNING.world.chunkSize, chunks: TUNING.city.chunks };
  const b = blockBounds(0, city);
  const at = (x: number): SurfaceInfo => ({
    kind: 'wall',
    chunk: 0,
    color: color('cream'),
    area: 10,
    x,
    z: b.z0 + 10,
  });
  const surfaces = [at(b.x0 + 100), at(b.x0 + 5), at(b.x0 + 60)];

  it('measures depth from the entry edge', () => {
    expect(depthFrom(surfaces[1]!, 2, b)).toBeCloseTo(5);
    expect(depthFrom(surfaces[1]!, 0, b)).toBeCloseTo(b.x1 - b.x0 - 5);
  });

  it('takes the coloured surface nearest the drained side first', () => {
    const states = new Uint8Array([ORIGINAL, ORIGINAL, ORIGINAL]);
    expect(nextToErode(states, surfaces, 0, 2, city)).toBe(1); // from the west: x0 + 5 first
    expect(nextToErode(states, surfaces, 0, 0, city)).toBe(0); // from the east: x0 + 100 first
    states[1] = 0;
    expect(nextToErode(states, surfaces, 0, 2, city)).toBe(2);
    expect(nextToErode(new Uint8Array(3), surfaces, 0, 2, city)).toBe(-1);
  });

  it('gives a fresh city nothing to erode and no tide target', () => {
    const fresh = generateCity('x', 7);
    const blocks = blockStates(new Uint8Array(fresh.surfaces.length), fresh.surfaces, fresh.chunks);
    expect(blocks.every((s) => s === 'drained')).toBe(true);
    expect(erodingBlocks(blocks)).toEqual([]);
    expect(tideTargets(blocks)).toEqual([]);
  });
});
