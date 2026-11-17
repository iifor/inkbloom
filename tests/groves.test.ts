import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness } from '@/world/wilderness/generator';
import {
  bloomOf,
  groveInCell,
  grovesNear,
  patchMask,
  SEA_FLOWERS,
  seaInCell,
  seasNear,
} from '@/world/wilderness/groves';

const w = createWilderness(4242);
const SIZE = TUNING.world.chunkSize;
const groves = grovesNear(w, 0, 0, 1500);
const seas = seasNear(w, 0, 0, 1500);

describe('bamboo groves', () => {
  it('turn up in damp woods, the same for everyone, each its own size', () => {
    expect(groves.length).toBeGreaterThan(3);
    expect(new Set(groves.map((g) => Math.round(g.r))).size).toBeGreaterThan(1);
    for (const g of groves) {
      expect(w.climate(g.x, g.z).moisture).toBeGreaterThanOrEqual(0.12);
      expect(w.townAt(g.x, g.z, g.r)).toBeNull();
    }
    expect(groveInCell(createWilderness(4242), 1, -1)).toEqual(groveInCell(w, 1, -1));
  });

  it('grow bamboo instead of trees, thick in the middle', () => {
    const g = groves[0]!;
    const chunk = generateWildChunk(w, Math.floor(g.x / SIZE), Math.floor(g.z / SIZE));
    const inside = chunk.trees.filter((t) => patchMask(g, t.x, t.z) > 0.5);
    expect(inside.length).toBeGreaterThan(5);
    for (const t of inside) expect(t.kind).toBe('bamboo');
    for (const t of chunk.trees.filter((t) => t.kind === 'bamboo')) expect(t.height).toBeGreaterThan(4);
  });
});

describe('flower seas', () => {
  it('lie out on open grassland, several kinds of flower', () => {
    expect(seas.length).toBeGreaterThan(3);
    expect(new Set(seas.map((s) => s.kind)).size).toBeGreaterThan(1);
    for (const s of seas) expect(w.climate(s.x, s.z).moisture).toBeLessThanOrEqual(0.15);
    expect(seaInCell(createWilderness(4242), 0, 1)).toEqual(seaInCell(w, 0, 1));
  });

  it('keep trees off them', () => {
    for (const s of seas.slice(0, 3)) {
      const chunk = generateWildChunk(w, Math.floor(s.x / SIZE), Math.floor(s.z / SIZE));
      for (const t of chunk.trees) if (t.kind !== 'great') expect(patchMask(s, t.x, t.z)).toBeLessThan(0.3);
    }
  });

  it('have a soft, lobed edge', () => {
    const s = seas[0]!;
    expect(patchMask(s, s.x, s.z)).toBe(1);
    expect(patchMask(s, s.x + s.r * 1.4, s.z)).toBe(0);
    const rim = [0, 1, 2, 3, 4, 5].map((k) => patchMask(s, s.x + Math.cos(k) * s.r, s.z + Math.sin(k) * s.r));
    expect(Math.max(...rim) - Math.min(...rim)).toBeGreaterThan(0.1);
  });

  it('bloom in their own season and are bare the rest of the year', () => {
    SEA_FLOWERS.forEach((f, k) => {
      expect(bloomOf(k, (f.from + f.to) / 2)).toBe(1);
      expect(bloomOf(k, f.from - 0.01)).toBe(0);
      expect(bloomOf(k, f.to + 0.01)).toBe(0);
      // nothing flowers in winter
      expect(bloomOf(k, 0.875)).toBe(0);
    });
  });
});
