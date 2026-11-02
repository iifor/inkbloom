import { describe, expect, it } from 'vitest';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { applyPatch, type PatchContext } from '@/world/patch';
import { DRAINED, ORIGINAL, coloredRatio, graffiti, type SurfaceInfo } from '@/world/paint/surfaces';
import { SaveError, cityStates, createWorldState, deserializeWorld, serializeWorld } from '@/world/state';
import { KeyValueStore, MemoryKeyValue } from '@/world/store';

const SURFACES: SurfaceInfo[] = [
  { kind: 'wall', chunk: 0, color: color('cream'), area: 40 },
  { kind: 'roof', chunk: 0, color: color('red'), area: 400 },
  { kind: 'door', chunk: 1, color: color('blue'), area: 4 },
];
const ctx: PatchContext = { surfacesOf: (id) => (id === 'c' ? SURFACES : null) };

describe('patches', () => {
  it('restores a drained surface for one generic pigment', () => {
    const s = createWorldState('w', 1);
    const before = s.inventory.generic;
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx)).toEqual({ ok: true });
    expect(cityStates(s, 'c', SURFACES).states[0]).toBe(ORIGINAL);
    expect(s.inventory.generic).toBe(before - 1);
  });

  it('charges double for large surfaces and refuses a second restore', () => {
    const s = createWorldState('w', 1);
    const before = s.inventory.generic;
    applyPatch(s, { kind: 'restore', city: 'c', surface: 1 }, ctx);
    expect(s.inventory.generic).toBe(before - 2);
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 1 }, ctx).ok).toBe(false);
    expect(s.inventory.generic).toBe(before - 2);
  });

  it('paints only with unlocked colours the player has pigment for', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'paint', city: 'c', surface: 0, color: color('purple') }, ctx).ok).toBe(
      false,
    );
    expect(applyPatch(s, { kind: 'paint', city: 'c', surface: 0, color: color('grass') }, ctx).ok).toBe(
      false,
    );
    const red = color('red');
    expect(applyPatch(s, { kind: 'paint', city: 'c', surface: 0, color: red }, ctx).ok).toBe(true);
    expect(cityStates(s, 'c', SURFACES).states[0]).toBe(graffiti(red));
    expect(s.inventory.colored[red]).toBe(TUNING.brush.startingColored - 1);
  });

  it('fails without spending when pigment runs out', () => {
    const s = createWorldState('w', 1);
    s.inventory.generic = 0;
    const r = applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    expect(r.ok).toBe(false);
    expect(cityStates(s, 'c', SURFACES).states[0]).toBe(DRAINED);
  });

  it('drains for free and counts coloured ratio per chunk', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, ctx);
    const states = cityStates(s, 'c', SURFACES).states;
    expect(coloredRatio(states, SURFACES)).toBeCloseTo(2 / 3);
    expect(coloredRatio(states, SURFACES, 1)).toBe(1);
    applyPatch(s, { kind: 'drain', city: 'c', surface: 2 }, ctx);
    expect(coloredRatio(states, SURFACES, 1)).toBe(0);
  });

  it('rejects unknown cities and surfaces', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'restore', city: 'nope', surface: 0 }, ctx).ok).toBe(false);
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 99 }, ctx).ok).toBe(false);
  });
});

describe('saves', () => {
  it('round-trips through a store', async () => {
    const store = new KeyValueStore(new MemoryKeyValue());
    const s = createWorldState('w1', 123, '测试');
    applyPatch(s, { kind: 'restore', city: 'c', surface: 1 }, ctx);
    s.player = { scene: { kind: 'city', id: 'c' }, x: 1, y: 2, z: 3, yaw: 0.5 };
    await store.save(s);
    const back = await store.load('w1');
    expect(back).not.toBeNull();
    expect(back!.seed).toBe(123);
    expect([...back!.cities.get('c')!.states]).toEqual([0, ORIGINAL, 0]);
    expect(back!.player).toEqual(s.player);
    expect(back!.inventory).toEqual(s.inventory);
  });

  it('tells a missing save from a corrupt one', async () => {
    const kv = new MemoryKeyValue();
    const store = new KeyValueStore(kv);
    expect(await store.load('none')).toBeNull();
    kv.setItem('inkbloom:world:bad', '{not json');
    await expect(store.load('bad')).rejects.toThrow();
    expect(() =>
      deserializeWorld(serializeWorld(createWorldState('a', 1)).replace('"version":2', '"version":9')),
    ).toThrow();
  });
});

describe('skeleton fingerprints', () => {
  const OTHER: SurfaceInfo[] = [...SURFACES, { kind: 'wall', chunk: 2, color: color('cream'), area: 30 }];
  const REORDERED: SurfaceInfo[] = [SURFACES[1]!, SURFACES[0]!, SURFACES[2]!];

  it('keeps states for the same skeleton', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    const again = cityStates(s, 'c', SURFACES);
    expect(again.reset).toBe(false);
    expect(again.states[0]).toBe(ORIGINAL);
  });

  it.each([
    ['a different surface count', OTHER],
    ['the same count in a different order', REORDERED],
  ])('resets instead of throwing for %s', (_, changed) => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    const r = cityStates(s, 'c', changed);
    expect(r.reset).toBe(true);
    expect([...r.states].every((v) => v === DRAINED)).toBe(true);
    expect(r.states.length).toBe(changed.length);
  });

  it('ignores original colour changes so palette tweaks keep progress', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    const recoloured = SURFACES.map((x) => ({ ...x, color: color('purple') }));
    expect(cityStates(s, 'c', recoloured).reset).toBe(false);
  });

  it('migrates v1 saves by adopting a matching surface count', () => {
    const v1 = JSON.stringify({
      version: 1,
      id: 'old',
      seed: 5,
      name: '旧',
      inventory: { generic: 3, colored: [] },
      unlocked: [],
      cities: { c: btoa(String.fromCharCode(0, 1, 0)), d: btoa(String.fromCharCode(1)) },
      player: null,
    });
    const s = deserializeWorld(v1);
    const kept = cityStates(s, 'c', SURFACES);
    expect(kept.reset).toBe(false);
    expect([...kept.states]).toEqual([0, ORIGINAL, 0]);
    expect(cityStates(s, 'd', SURFACES).reset).toBe(true);
    // re-saved as v2 with the adopted fingerprint
    const back = deserializeWorld(serializeWorld(s));
    expect(back.cities.get('c')!.fingerprint).not.toBeNull();
  });
});

describe('save recovery', () => {
  it('moves a corrupt save aside so a fresh world can be created', async () => {
    const kv = new MemoryKeyValue();
    const store = new KeyValueStore(kv);
    kv.setItem('inkbloom:world:w', '{broken');
    await expect(store.load('w')).rejects.toBeInstanceOf(SaveError);
    const backup = await store.quarantine('w');
    expect(backup).toMatch(/^inkbloom:world:w:corrupt-\d+$/);
    expect(kv.getItem(backup!)).toBe('{broken');
    expect(await store.load('w')).toBeNull();
    expect(await store.quarantine('w')).toBeNull();
  });
});
