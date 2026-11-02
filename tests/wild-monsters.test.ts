import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { createWilderness } from '@/world/wilderness/generator';
import { chunkSaturation, wildMonsterById, wildMonstersInChunk } from '@/world/wilderness/wild-monsters';

const SEED = 20261102;
const W = TUNING.combat.wild;

describe('wilderness monsters', () => {
  it('appear on drained land and not on restored land', () => {
    const w = createWilderness(SEED);
    let drained = 0;
    let restored = 0;
    for (let cx = -6; cx <= 6; cx++)
      for (let cz = -6; cz <= 6; cz++) {
        drained += wildMonstersInChunk(w, cx, cz, 0).length;
        restored += wildMonstersInChunk(w, cx, cz, 1).length;
      }
    expect(drained).toBeGreaterThan(13 * 13 * W.drained[0] * 0.5);
    expect(restored).toBe(0);
  });

  it('are stable by id, so a kill can be checked later', () => {
    const w = createWilderness(SEED);
    const list = wildMonstersInChunk(w, 3, -2, 0);
    expect(list.length).toBeGreaterThan(0);
    const again = createWilderness(SEED);
    for (const m of list) expect(wildMonsterById(again, m.id, 0)).toEqual(m);
    expect(new Set(list.map((m) => m.id)).size).toBe(list.length);
  });

  it('keep away from spawn, water and city towers', () => {
    const w = createWilderness(SEED);
    for (let cx = -3; cx <= 3; cx++)
      for (let cz = -3; cz <= 3; cz++)
        for (const m of wildMonstersInChunk(w, cx, cz, 0)) {
          expect(Math.hypot(m.x, m.z)).toBeGreaterThanOrEqual(60);
          expect(m.y).toBeGreaterThan(-0.75);
          for (const e of w.entrancesNear(m.x, m.z, 1))
            expect(Math.hypot(m.x - e.x, m.z - e.z)).toBeGreaterThanOrEqual(
              TUNING.structures.entranceFlatRadius,
            );
        }
  });

  it('thin out as the nearby city is restored', () => {
    const w = createWilderness(SEED);
    const e = w.entranceInCell(0, 0)!;
    const [cx, cz] = e.chunk;
    const grey = chunkSaturation(w, cx + 1, cz, () => 0);
    const bright = chunkSaturation(w, cx + 1, cz, () => 1);
    expect(grey).toBeLessThan(W.drainedBelow);
    expect(bright).toBe(1);
    expect(wildMonstersInChunk(w, cx + 1, cz, bright)).toHaveLength(0);
  });
});
