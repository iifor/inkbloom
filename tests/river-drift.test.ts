import { expect, it } from 'vitest';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { riverDriftTrack } from '@/world/wilderness/river-drift';
import { RIVER_ORIGIN } from '@/world/wilderness/river-corridors';

function channel(grade: number, basin = 0) {
  return {
    ...createWilderness(7),
    riverAt: () => ({ x: RIVER_ORIGIN, half: 20 }),
    rawHeightAt: (_x: number, z: number) => -z * grade,
    terrainHeightAt: () => WATER_LEVEL - 2,
    heightAt: (_x: number, z: number) => WATER_LEVEL + (z < 8 ? -2 : 1),
    waterGuidesAt: () => ({ basin, branch: null }),
  };
}

it('drifts with either current direction and stops before exposed ground', () => {
  for (const grade of [-0.02, 0.02]) {
    const w = channel(grade);
    const track = riverDriftTrack(w, 15, -1)!;
    expect(track).toEqual(riverDriftTrack(w, 15, -1));
    expect(track.points.length).toBeGreaterThan(4);
    for (const [i, p] of track.points.entries()) {
      expect(w.heightAt(p.x, p.z)).toBeLessThan(WATER_LEVEL);
      if (i) expect((p.z - track.points[i - 1]!.z) * grade).toBeGreaterThan(0);
    }
  }
});

it('leaves still water, lakes and dry ground clear', () => {
  expect(riverDriftTrack(channel(0), 15, 0)).toBeNull();
  expect(riverDriftTrack(channel(0.02, 1), 15, 0)).toBeNull();
  expect(riverDriftTrack(channel(0.02), 15, 2)).toBeNull();
});
