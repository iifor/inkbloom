import { WILD_MODELS } from '@/content/wild-models';
import { describe, expect, it } from 'vitest';
import { enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import { createWilderness, townDistance } from '@/world/wilderness/generator';
import { chunkSaturation, wildMonsterById, wildMonstersInChunk } from '@/world/wilderness/wild-monsters';
import { wellOfGuard } from '@/world/wilderness/ink-wells';

const SEED = 20261102;
const W = TUNING.combat.wild;

describe('wilderness monsters', () => {
  it('populate drained land, with only sparse remote packs on colourful land', () => {
    const w = createWilderness(SEED);
    let drained = 0;
    let restored = 0;
    for (let cx = -6; cx <= 6; cx++)
      for (let cz = -6; cz <= 6; cz++) {
        drained += wildMonstersInChunk(w, cx, cz, 0).length;
        const packs = wildMonstersInChunk(w, cx, cz, 1);
        restored += packs.length;
        for (const m of packs) {
          expect(Number(m.id.split(':')[1])).toBeGreaterThanOrEqual(100);
          expect(w.townAt(m.x, m.z, TUNING.drain.outerRadius + 30)).toBeNull();
          expect(Math.hypot(m.x - 64, m.z - 64)).toBeGreaterThan(250);
          expect(wildMonsterById(w, m.id, 1)).toEqual(m);
          expect(wellOfGuard(m.id)).toBeNull();
        }
      }
    expect(drained).toBeGreaterThan(13 * 13 * W.drained[0] * 0.5);
    expect(restored).toBeGreaterThan(0);
    expect(restored).toBeLessThan(drained * 0.15);
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
    for (const key of [
      'frog',
      'rat',
      'snake',
      'snake-angry',
      'spider',
      'wasp',
      'star-mote',
      'star-orb',
      'star-wing',
      'star-brute',
    ] as const)
      expect(count.get(enemyIndex(key)) ?? 0, key).toBeGreaterThan(all * 0.006);
    const newModels = WILD_MODELS.reduce((sum, model) => sum + (count.get(enemyIndex(model.key)) ?? 0), 0);
    expect(newModels / all).toBeGreaterThan(0.065);
    expect(newModels / all).toBeLessThan(0.14);
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
    // Use the actual neighbouring chunk, not one an extra 128 m away (which used
    // to be drained by another village when every settlement cell was occupied).
    const grey = chunkSaturation(w, cx, cz, () => 0);
    const bright = chunkSaturation(w, cx, cz, () => 1);
    expect(grey).toBeLessThan(W.drainedBelow);
    expect(bright).toBe(1);
    expect(wildMonstersInChunk(w, cx, cz, bright)).toHaveLength(0);
  });
});
