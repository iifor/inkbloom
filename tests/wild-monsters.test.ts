import { describe, expect, it } from 'vitest';
import { enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import { createWilderness, townDistance } from '@/world/wilderness/generator';
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

  it('bring the odd 墨巨 to drained land only, at most one a chunk', () => {
    const w = createWilderness(SEED);
    const giant = enemyIndex('giant');
    let drained = 0;
    let grey = 0;
    for (let cx = -8; cx <= 8; cx++)
      for (let cz = -8; cz <= 8; cz++) {
        const here = wildMonstersInChunk(w, cx, cz, 0).filter((m) => m.type === giant).length;
        expect(here).toBeLessThanOrEqual(1);
        drained += here;
        grey += wildMonstersInChunk(w, cx, cz, (W.drainedBelow + W.greyBelow) / 2).filter(
          (m) => m.type === giant,
        ).length;
      }
    expect(drained).toBeGreaterThan(0);
    expect(drained).toBeLessThan(17 * 17 * 0.3);
    expect(grey).toBe(0);
  });

  it('come in every common kind, spitters about as often as tuned', () => {
    const w = createWilderness(SEED);
    const count = new Map<number, number>();
    let all = 0;
    for (let cx = -8; cx <= 8; cx++)
      for (let cz = -8; cz <= 8; cz++)
        for (const m of wildMonstersInChunk(w, cx, cz, 0)) {
          count.set(m.type, (count.get(m.type) ?? 0) + 1);
          all++;
        }
    for (const key of ['blot', 'spitter', 'weasel'] as const)
      expect(count.get(enemyIndex(key)) ?? 0, key).toBeGreaterThan(all * 0.1);
    expect((count.get(enemyIndex('spitter')) ?? 0) / all).toBeCloseTo(TUNING.combat.spitterChance, 1);
  });

  it('are stable by id, so a kill can be checked later', () => {
    const w = createWilderness(SEED);
    const list = wildMonstersInChunk(w, 3, -2, 0);
    expect(list.length).toBeGreaterThan(0);
    const again = createWilderness(SEED);
    for (const m of list) expect(wildMonsterById(again, m.id, 0)).toEqual(m);
    expect(new Set(list.map((m) => m.id)).size).toBe(list.length);
  });

  it('keep away from spawn, water and towns', () => {
    const w = createWilderness(SEED);
    for (let cx = -3; cx <= 3; cx++)
      for (let cz = -3; cz <= 3; cz++)
        for (const m of wildMonstersInChunk(w, cx, cz, 0)) {
          expect(Math.hypot(m.x, m.z)).toBeGreaterThanOrEqual(60);
          expect(m.y).toBeGreaterThan(-0.75);
          for (const e of w.entrancesNear(m.x, m.z, 1))
            expect(townDistance(e, m.x, m.z)).toBeGreaterThanOrEqual(TUNING.structures.townClearance);
        }
  });

  it('thin out as the nearby town is restored', () => {
    const w = createWilderness(SEED);
    const e = w.entranceInCell(0, 0)!;
    // the chunk just outside the town's east wall
    const cx = Math.floor((e.ox + e.size) / TUNING.world.chunkSize);
    const cz = Math.floor(e.z / TUNING.world.chunkSize);
    const grey = chunkSaturation(w, cx + 1, cz, () => 0);
    const bright = chunkSaturation(w, cx + 1, cz, () => 1);
    expect(grey).toBeLessThan(W.drainedBelow);
    expect(bright).toBe(1);
    expect(wildMonstersInChunk(w, cx + 1, cz, bright)).toHaveLength(0);
  });
});
