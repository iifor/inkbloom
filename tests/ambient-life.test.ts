import { describe, expect, it } from 'vitest';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { lifeInChunk, lifeGround } from '@/world/wilderness/ambient-life';
import { pathsOf } from '@/world/wilderness/paths';

describe('wilderness life', () => {
  it('populates varied dry habitats and roadside outings reproducibly', () => {
    const w = createWilderness(4242);
    const kinds = new Set<string>();
    let people = 0,
      animals = 0;
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        const sites = lifeInChunk(w, x, z);
        expect(lifeInChunk(w, x, z)).toEqual(sites);
        expect(sites.length).toBeLessThanOrEqual(2);
        for (const s of sites) {
          kinds.add(s.kind);
          expect(lifeGround(w, s.x, s.z, s.person ? 7 : 5)).toBe(true);
          expect(w.heightAt(s.x, s.z)).toBeGreaterThan(WATER_LEVEL + 0.9);
          expect(w.townAt(s.x, s.z, 18)).toBeNull();
          expect(Math.floor(s.x / 128)).toBe(x);
          expect(Math.floor(s.z / 128)).toBe(z);
          if (s.person) {
            people++;
            expect(pathsOf(w).edgeDistance(s.x, s.z)).toBeLessThan(8);
          } else animals++;
        }
      }
    expect(people).toBeGreaterThan(8);
    expect(animals).toBeGreaterThan(30);
    expect([...kinds].sort()).toEqual(['bird', 'boar', 'gatherer', 'rabbit', 'ranger', 'walker']);
    expect(lifeInChunk(createWilderness(4242), 2, -3)).toEqual(lifeInChunk(w, 2, -3));
  });
});
