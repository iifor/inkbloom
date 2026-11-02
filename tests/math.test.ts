import { describe, expect, it } from 'vitest';
import { hashAt, hashString, unit } from '@/world/math/hash';
import { createNoise2D, fbm } from '@/world/math/noise';
import { Rng } from '@/world/math/rng';

describe('hash', () => {
  it('is stable and salt-sensitive', () => {
    expect(hashString('inkbloom')).toBe(hashString('inkbloom'));
    expect(hashAt(1, 'a', 3, 4)).toBe(hashAt(1, 'a', 3, 4));
    expect(hashAt(1, 'a', 3, 4)).not.toBe(hashAt(1, 'b', 3, 4));
    expect(hashAt(1, 'a', 3, 4)).not.toBe(hashAt(1, 'a', 4, 3));
  });
  it('spreads over [0, 1)', () => {
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const u = unit(hashAt(7, 'spread', i));
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});

describe('rng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });
  it('keeps int() inside its bounds', () => {
    const r = new Rng(3);
    for (let i = 0; i < 500; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe('noise', () => {
  it('is deterministic per seed and bounded', () => {
    const a = createNoise2D(9);
    const b = createNoise2D(9);
    const c = createNoise2D(10);
    let differs = false;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      expect(a(x, y)).toBe(b(x, y));
      if (a(x, y) !== c(x, y)) differs = true;
      expect(Math.abs(fbm(a, x, y))).toBeLessThanOrEqual(1.05);
    }
    expect(differs).toBe(true);
  });
});
