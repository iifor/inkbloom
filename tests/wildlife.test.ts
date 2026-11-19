import { describe, expect, it } from 'vitest';
import { createWilderness } from '@/world/wilderness/generator';
import { pathsOf } from '@/world/wilderness/paths';
import { herdInCell, herdsNear } from '@/world/wilderness/wildlife';

const w = createWilderness(4242);
const herds = herdsNear(w, 0, 0, 1500);

describe('deer herds', () => {
  it('graze in meadows at the edge of the woods, the same for everyone', () => {
    expect(herds.length).toBeGreaterThan(4);
    for (const h of herds) {
      expect(h.count).toBeGreaterThanOrEqual(3);
      expect(w.climate(h.x, h.z).moisture).toBeLessThan(0.15);
      let woods = false;
      for (let k = 0; k < 8; k++) {
        const angle = (k * Math.PI) / 4;
        if (w.climate(h.x + Math.cos(angle) * 45, h.z + Math.sin(angle) * 45).moisture >= 0.15) woods = true;
      }
      expect(woods).toBe(true);
      expect(w.townAt(h.x, h.z, 60)).toBeNull();
      expect(pathsOf(w).edgeDistance(h.x, h.z)).toBeGreaterThan(9);
    }
    expect(herdInCell(createWilderness(4242), 1, 2)).toEqual(herdInCell(w, 1, 2));
  });

  it('are found nearest first', () => {
    const d = herds.map((h) => Math.hypot(h.x, h.z));
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
});
