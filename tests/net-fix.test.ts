import { describe, expect, it } from 'vitest';
import { applyFix, cityFix } from '@/world/net/fix';
import { type CitySave, createWorldState } from '@/world/state';

function save(n = 4): CitySave {
  return {
    fingerprint: null,
    states: new Uint8Array(n),
    stainFingerprint: null,
    stains: new Uint8Array(n),
    completed: false,
    monsterFingerprint: null,
    defeated: new Uint8Array(n),
    coloredOnce: new Uint8Array(n),
    requestFingerprint: null,
    requestsDone: new Uint8Array(n),
    stockFrom: Array.from({ length: n }, () => -1),
    tide: { nextIn: 60, wave: null },
  };
}

describe('the server’s fix values', () => {
  it('a fix holds only what changed, and nothing when nothing did', () => {
    const before = save();
    const after = structuredClone(before);
    expect(cityFix('c', before, after)).toBeUndefined();
    after.states[2] = 1;
    after.stains[0] = 1;
    after.completed = true;
    expect(cityFix('c', before, after)).toEqual({
      id: 'c',
      states: [[2, 1]],
      stains: [[0, 1]],
      completed: true,
    });
    // with no `before`, everything: the whole town as the server has it
    expect(cityFix('c', undefined, after)?.states).toHaveLength(4);
  });

  it('applying one sets the values and says what changed on screen', () => {
    const s = createWorldState('w', 1);
    s.cities.set('c', save());
    s.cities.get('c')!.states[1] = 1;
    const c = applyFix(s, {
      city: {
        id: 'c',
        states: [
          [0, 1],
          [1, 1],
        ],
        stains: [[3, 1]],
        defeated: [[2, 1]],
      },
      harvested: [['src', 12]],
    });
    expect(c).toEqual({ city: 'c', surfaces: [0], stains: [3], defeated: [2] });
    expect(Array.from(s.cities.get('c')!.states)).toEqual([1, 1, 0, 0]);
    expect(s.harvested.get('src')).toBe(12);
  });

  it('skips what does not fit, and a town this client has no save for', () => {
    const s = createWorldState('w', 1);
    s.cities.set('c', save());
    const c = applyFix(s, {
      city: {
        id: 'c',
        states: [
          [-1, 1],
          [9, 1],
          [0.5, 1],
          [0, Number.NaN],
        ],
      },
    });
    expect(c.surfaces).toEqual([]);
    expect(Array.from(s.cities.get('c')!.states)).toEqual([0, 0, 0, 0]);
    expect(applyFix(s, { city: { id: 'elsewhere', states: [[0, 1]] } }).city).toBeNull();
    expect(applyFix(s, null).city).toBeNull();
  });
});
