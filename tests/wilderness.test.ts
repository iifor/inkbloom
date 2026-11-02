import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness } from '@/world/wilderness/generator';
import { saturationAt } from '@/world/wilderness/drain';

const SEED = 20261102;

describe('wilderness', () => {
  it('generates the same chunk regardless of order', () => {
    const a = createWilderness(SEED);
    const b = createWilderness(SEED);
    generateWildChunk(b, 5, -3); // warm b's caches with an unrelated chunk first
    const ca = generateWildChunk(a, 1, 2);
    const cb = generateWildChunk(b, 1, 2);
    expect([...ca.heights]).toEqual([...cb.heights]);
    expect(ca.trees).toEqual(cb.trees);
  });

  it('terraces every height to the step size', () => {
    const w = createWilderness(SEED);
    const c = generateWildChunk(w, -2, 4);
    for (const h of c.heights)
      expect(Math.abs(h / TUNING.world.terraceStep - Math.round(h / TUNING.world.terraceStep))).toBeLessThan(
        1e-6,
      );
  });

  it('keeps neighbouring chunks continuous along their shared edge', () => {
    const w = createWilderness(SEED);
    const left = generateWildChunk(w, 0, 0);
    const right = generateWildChunk(w, 1, 0);
    const n = left.n;
    let maxJump = 0;
    for (let iz = 0; iz < n; iz++)
      maxJump = Math.max(maxJump, Math.abs(left.heights[iz * n + n - 1]! - right.heights[iz * n]!));
    // adjacent cells across the seam differ no more than adjacent cells inside a chunk do
    let inner = 0;
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n - 1; ix++)
        inner = Math.max(inner, Math.abs(left.heights[iz * n + ix]! - left.heights[iz * n + ix + 1]!));
    expect(maxJump).toBeLessThanOrEqual(Math.max(inner, 1));
  });

  it('keeps the spawn area calm and walkable', () => {
    const w = createWilderness(SEED);
    const c = generateWildChunk(w, 0, 0);
    let max = -Infinity;
    let min = Infinity;
    for (const h of c.heights) {
      max = Math.max(max, h);
      min = Math.min(min, h);
    }
    expect(max - min).toBeLessThan(8);
    expect(c.trees.every((t) => Math.hypot(t.x, t.z) >= 14)).toBe(true);
  });

  it('places the first city entrance where it is visible from spawn', () => {
    const w = createWilderness(SEED);
    const e = w.entranceInCell(0, 0);
    expect(e).not.toBeNull();
    expect(e!.chunk).toEqual([...TUNING.structures.firstCityChunk]);
    expect(Math.hypot(e!.x, e!.z)).toBeLessThan(400);
    // the ground around the landmark is flattened to its plateau
    expect(w.heightAt(e!.x + 10, e!.z - 10)).toBeCloseTo(e!.y, 5);
  });

  it('gives each entrance a stable city id', () => {
    const a = createWilderness(SEED).entrancesNear(3000, -2000, 2);
    const b = createWilderness(SEED).entrancesNear(3000, -2000, 2);
    expect(a.map((e) => e.cityId)).toEqual(b.map((e) => e.cityId));
    expect(new Set(a.map((e) => e.cityId)).size).toBe(a.length);
  });

  it('drains colour near an unrestored city and restores it with progress', () => {
    const city = { x: 0, z: 0, progress: 0 };
    expect(saturationAt(10, 0, [city])).toBe(0);
    expect(saturationAt(5000, 0, [city])).toBe(1);
    expect(saturationAt(10, 0, [{ ...city, progress: 1 }])).toBe(1);
  });
});
