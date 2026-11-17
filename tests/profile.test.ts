import { describe, expect, it } from 'vitest';
import { defaultLook } from '@/content/characters';
import { color } from '@/content/palette';
import { DEFAULT_NAME, NAME_MAX, cleanName, loadProfile, saveProfile } from '@/world/profile';
import type { KeyValue } from '@/world/store';

function memory(): KeyValue & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

describe('player profile', () => {
  it('is null until a character has been chosen', () => {
    expect(loadProfile(memory())).toBeNull();
  });

  it('round-trips a name and a look', () => {
    const kv = memory();
    const look = { ...defaultLook('gardener'), skin: 2, hair: 3, accent: color('blue') };
    saveProfile(kv, { name: '  小满  ', look });
    expect(loadProfile(kv)).toEqual({ name: '小满', look });
  });

  it('drops a profile that no longer fits the game', () => {
    const kv = memory();
    const bad = (look: object): void => kv.setItem('inkbloom:profile', JSON.stringify({ name: 'x', look }));
    bad({ ...defaultLook('courier'), character: 'pirate' });
    expect(loadProfile(kv)).toBeNull();
    bad({ ...defaultLook('courier'), skin: 7 });
    expect(loadProfile(kv)).toBeNull();
    // an accent the brush cannot paint (the ink itself)
    bad({ ...defaultLook('courier'), accent: color('ink') });
    expect(loadProfile(kv)).toBeNull();
    kv.setItem('inkbloom:profile', '{not json');
    expect(loadProfile(kv)).toBeNull();
  });

  it('keeps names short and never empty', () => {
    expect(cleanName('')).toBe(DEFAULT_NAME);
    expect(cleanName(42)).toBe(DEFAULT_NAME);
    expect([...cleanName('一二三四五六七八九十一二三四')].length).toBe(NAME_MAX);
  });
});
