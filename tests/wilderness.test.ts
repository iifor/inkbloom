import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness, townDistance } from '@/world/wilderness/generator';
import { saturationAt } from '@/world/wilderness/drain';
import { ruinById, ruinInCell } from '@/world/wilderness/ruins';
import { WATER_LEVEL } from '@/world/wilderness/generator';

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

  it('rolls smoothly: nearby points never jump in height', () => {
    const w = createWilderness(SEED);
    let worst = 0;
    for (let x = -600; x < 600; x += 7.3)
      for (let z = -600; z < 600; z += 9.1)
        worst = Math.max(worst, Math.abs(w.heightAt(x + 0.25, z) - w.heightAt(x, z)) / 0.25);
    // a slope, not a step: rise over run stays in walkable-to-steep-hill range
    expect(worst).toBeLessThan(2.5);
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

  it('stands the first town where it is visible from spawn, its main gate facing it', () => {
    const w = createWilderness(SEED);
    const e = w.entranceInCell(0, 0)!;
    expect(e).not.toBeNull();
    expect(e.cityId).toBe(`c${TUNING.structures.firstCityChunk.join('_')}`);
    const spawn = TUNING.world.chunkSize / 2;
    expect(townDistance(e, spawn, spawn)).toBeLessThan(250);
    expect(townDistance(e, spawn, spawn)).toBeGreaterThan(100);
    expect(e.gate).toBe('nx');
    expect(spawn).toBeLessThan(e.ox);
  });

  it('keeps a gentler copy of the hills under a town and eases it back into the wild ones', () => {
    const w = createWilderness(SEED);
    const S = TUNING.structures;
    for (const e of w.entrancesNear(0, 0, 2)) {
      expect(Math.abs(e.ox % TUNING.world.cellSize)).toBe(0);
      expect(Math.abs(e.oz % TUNING.world.cellSize)).toBe(0);
      expect(e.y).toBeGreaterThan(WATER_LEVEL + 1);
      // inside: the land's own rise and fall about the town's level, scaled down, above the
      // water; a river running through only ever cuts it lower
      let kept = 0;
      for (let u = 0.05; u < 1; u += 0.15)
        for (let v = 0.05; v < 1; v += 0.15) {
          const x = e.ox + Math.round((u * e.size) / 4) * 4;
          const z = e.oz + Math.round((v * e.size) / 4) * 4;
          const want = Math.max(WATER_LEVEL + 0.6, e.y + S.townRelief * (w.rawHeightAt(x, z) - e.y));
          const h = w.heightAt(x, z);
          expect(h).toBeLessThanOrEqual(want + 1e-3);
          if (Math.abs(h - want) < 1e-3) kept++;
        }
      expect(kept).toBeGreaterThan(20);
      expect(w.townAt(e.x, e.z)).toBe(e);
      expect(w.townAt(e.ox - 5, e.z)).toBeNull();
      expect(w.townAt(e.ox - 5, e.z, 6)).toBe(e);
    }
  });

  it('keeps towns well apart and inside their own grid cell', () => {
    const w = createWilderness(SEED);
    const towns = w.entrancesNear(0, 0, 3);
    expect(towns.length).toBeGreaterThan(10);
    for (const a of towns)
      for (const b of towns) {
        if (a === b) continue;
        const gap = Math.max(
          b.ox - (a.ox + a.size),
          a.ox - (b.ox + b.size),
          b.oz - (a.oz + a.size),
          a.oz - (b.oz + b.size),
        );
        expect(gap).toBeGreaterThan(2 * TUNING.structures.townSkirt - 70);
      }
  });

  it('keeps trees, sources and ruins out of towns', () => {
    const w = createWilderness(SEED);
    const e = w.entranceInCell(0, 0)!;
    const size = TUNING.world.chunkSize;
    for (let cx = Math.floor(e.ox / size); cx <= Math.floor((e.ox + e.size) / size); cx++)
      for (let cz = Math.floor(e.oz / size); cz <= Math.floor((e.oz + e.size) / size); cz++) {
        const c = generateWildChunk(w, cx, cz);
        for (const t of [...c.trees, ...c.sources, ...c.ruins]) expect(w.townAt(t.x, t.z)).toBeNull();
      }
  });

  it('gives each entrance a stable city id', () => {
    const a = createWilderness(SEED).entrancesNear(3000, -2000, 2);
    const b = createWilderness(SEED).entrancesNear(3000, -2000, 2);
    expect(a.map((e) => e.cityId)).toEqual(b.map((e) => e.cityId));
    expect(new Set(a.map((e) => e.cityId)).size).toBe(a.length);
  });

  it('drains colour near an unrestored town, measured from its wall, and restores it with progress', () => {
    const town = { x: 0, z: 0, half: 100, progress: 0 };
    expect(saturationAt(10, 0, [town])).toBe(0);
    expect(saturationAt(130, 0, [town])).toBe(0);
    expect(saturationAt(5000, 0, [town])).toBe(1);
    expect(saturationAt(10, 0, [{ ...town, progress: 1 }])).toBe(1);
    expect(saturationAt(10, 0, [{ ...town, progress: 0.4 }])).toBeCloseTo(0.4);
  });
});

describe('ruins', () => {
  it('are placed deterministically, found by id, away from spawn, water and towers', () => {
    const w = createWilderness(SEED);
    const found = [];
    for (let gx = -4; gx <= 4; gx++)
      for (let gz = -4; gz <= 4; gz++) {
        const r = ruinInCell(w, gx, gz);
        if (!r) continue;
        found.push(r);
        expect(ruinById(createWilderness(SEED), r.id)).toEqual(r);
        expect(Math.hypot(r.x, r.z)).toBeGreaterThanOrEqual(80);
        expect(r.y).toBeGreaterThan(WATER_LEVEL);
        for (const e of w.entrancesNear(r.x, r.z, 1)) expect(townDistance(e, r.x, r.z)).toBeGreaterThan(20);
      }
    expect(found.length).toBeGreaterThan(81 * TUNING.structures.ruinChance * 0.5);
    expect(new Set(found.map((r) => r.template)).size).toBeGreaterThan(1);
  });
});
