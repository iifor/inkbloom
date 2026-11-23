import { describe, expect, it } from 'vitest';
import { defaultLook } from '@/content/characters';
import { TUNING } from '@/content/tuning';
import { standingMonsters, studioOpen } from '@/world/city/features';
import { townLayout } from '@/world/city/layout';
import { startsPeaceful } from '@/world/city/origin';
import { applyFix, cityFix } from '@/world/net/fix';
import { WorldHost } from '@/world/net/host';
import { GROUNDED } from '@/world/net/protocol';
import { deserializeSlice } from '@/world/net/slices';
import { layoutCache, worldPatchContext } from '@/world/net/patch-context';
import { ORIGINAL } from '@/world/paint/surfaces';
import { applyPatch } from '@/world/patch';
import {
  cityStates,
  createWorldState,
  deserializeWorld,
  peacefulVillage,
  savedProgress,
  serializeWorld,
} from '@/world/state';
import { influenceOf, saturationAt } from '@/world/wilderness/drain';
import { createWilderness } from '@/world/wilderness/generator';

const SEED = 7;
const wilderness = createWilderness(SEED);
const first = wilderness.entranceInCell(0, 0)!;
const layout = townLayout(first, wilderness);
const makeWorld = () => createWorldState('peaceful-test', SEED);

function context(state: ReturnType<typeof makeWorld>) {
  return worldPatchContext(wilderness, layoutCache(wilderness), (id) => savedProgress(state, id));
}

describe('naturally peaceful villages', () => {
  it('keeps the first village peaceful for every seed, and mixes other origins deterministically', () => {
    for (const seed of [1, 7, 42, 20261118]) expect(startsPeaceful(seed, first.cityId)).toBe(true);
    const ids = wilderness.entrancesNear(0, 0, 4).map((e) => e.cityId);
    const origins = ids.map((id) => startsPeaceful(SEED, id));
    expect(origins).toContain(true);
    expect(origins).toContain(false);
    expect(
      [...ids]
        .reverse()
        .map((id) => startsPeaceful(SEED, id))
        .reverse(),
    ).toEqual(origins);
    expect(ids.map((id) => startsPeaceful(SEED + 1, id))).not.toEqual(origins);
    expect(startsPeaceful(SEED, 'custom-layout')).toBe(false);
  });

  it('has full colour before loading, no guards or stains, and grants no progress or reward', () => {
    const s = makeWorld();
    const before = structuredClone({ inventory: s.inventory, growth: s.growth });
    expect(savedProgress(s, first.cityId)).toBe(1);
    expect(saturationAt(first.x, first.z, [influenceOf(first, savedProgress(s, first.cityId))])).toBe(1);
    const saved = cityStates(s, first.cityId, layout);
    expect(saved.states.every((v) => v === ORIGINAL)).toBe(true);
    expect(layout.monsters.length).toBeGreaterThan(0);
    expect(layout.stains.length).toBeGreaterThan(0);
    expect(saved.stains.every((v) => v === 1)).toBe(true);
    expect(saved.defeated.every((v) => v === 1)).toBe(true);
    for (let chunk = 0; chunk < layout.chunks ** 2; chunk++)
      expect(standingMonsters(layout, saved.defeated, chunk)).toHaveLength(0);
    expect(s.cities.get(first.cityId)).toMatchObject({ peaceful: true, completed: false });
    expect({ inventory: s.inventory, growth: s.growth }).toEqual(before);
    const ctx = context(s);
    for (const patch of [
      { kind: 'complete', city: first.cityId },
      { kind: 'tideHeld', city: first.cityId },
      { kind: 'drain', city: first.cityId, surface: 0 },
      { kind: 'defeat', city: first.cityId, monster: 0 },
      { kind: 'collect', city: first.cityId, stain: 0 },
    ] as const)
      expect(applyPatch(s, patch, ctx).ok).toBe(false);
    expect({ inventory: s.inventory, growth: s.growth }).toEqual(before);
    expect(savedProgress(s, first.cityId)).toBe(1);
  });

  it('produces studio pigment on the world clock without granting restoration milestones', () => {
    const s = makeWorld();
    const data = cityStates(s, first.cityId, layout);
    const ctx = context(s);
    expect(layout.residents.length).toBeGreaterThan(0);
    expect(layout.studios.every((_, i) => studioOpen(layout, data.states, i))).toBe(true);
    expect(applyPatch(s, { kind: 'collectStock', city: first.cityId, studio: 0 }, ctx).ok).toBe(false);
    expect(s.growth.xp).toBe(0);
    expect(s.growth.milestones).not.toContain('first-block');
    expect(s.growth.milestones).not.toContain(`city:${first.cityId}:restored`);
    expect(s.inventory.glider).toBe(false);
    s.clock += TUNING.economy.studioStockSeconds;
    expect(applyPatch(s, { kind: 'collectStock', city: first.cityId, studio: 0 }, ctx).ok).toBe(true);
  });

  it('preserves visited v1/v2 towns instead of silently normalising their progress', () => {
    const s = makeWorld();
    cityStates(s, first.cityId, layout);
    const save = s.cities.get(first.cityId)!;
    save.peaceful = false;
    save.states.fill(0);
    save.states[0] = ORIGINAL;
    save.defeated.fill(0);
    save.stains.fill(0);
    save.coloredOnce.fill(0);
    const json = JSON.parse(serializeWorld(s));
    json.version = 2;
    const loaded = deserializeWorld(JSON.stringify(json));
    expect(peacefulVillage(loaded, first.cityId)).toBe(false);
    expect(savedProgress(loaded, first.cityId)).toBeCloseTo(1 / layout.surfaces.length);
    cityStates(loaded, first.cityId, layout);
    expect(loaded.cities.get(first.cityId)).toEqual(save);
    expect(deserializeWorld(serializeWorld(loaded)).cities.get(first.cityId)).toEqual(save);
    json.version = 1;
    json.cities[first.cityId] = json.cities[first.cityId].s;
    const v1 = deserializeWorld(JSON.stringify(json));
    expect(cityStates(v1, first.cityId, layout).states).toEqual(save.states);
    expect(peacefulVillage(v1, first.cityId)).toBe(false);
  });

  it('persists peaceful origins and keeps them peaceful after a layout fingerprint reset', () => {
    const s = makeWorld();
    cityStates(s, first.cityId, layout);
    const loaded = deserializeWorld(serializeWorld(s));
    expect(loaded.cities.get(first.cityId)).toEqual(s.cities.get(first.cityId));
    const c = loaded.cities.get(first.cityId)!;
    c.fingerprint = -1;
    c.stainFingerprint = -1;
    c.monsterFingerprint = -1;
    const reset = cityStates(loaded, first.cityId, layout);
    expect(reset.reset).toBe(true);
    expect(reset.states.every((v) => v === ORIGINAL)).toBe(true);
    expect(reset.stains.every((v) => v === 1)).toBe(true);
    expect(reset.defeated.every((v) => v === 1)).toBe(true);
    expect(reset.coloredOnce.every((v) => v === 1)).toBe(true);
    expect(c.completed).toBe(false);
    expect(c.tide.wave).toBeNull();
  });

  it('keeps polluted villages drained, with their guards and restoration rewards intact', () => {
    const e = wilderness.entrancesNear(0, 0, 3).find((e) => !startsPeaceful(SEED, e.cityId))!;
    const l = townLayout(e, wilderness);
    const s = makeWorld();
    expect(savedProgress(s, e.cityId)).toBe(0);
    const saved = cityStates(s, e.cityId, l);
    expect(saved.states.every((v) => v === 0)).toBe(true);
    expect(saved.defeated.every((v) => v === 0)).toBe(true);
    saved.states.fill(ORIGINAL);
    expect(applyPatch(s, { kind: 'complete', city: e.cityId }, context(s)).ok).toBe(true);
    expect(s.inventory.glider).toBe(true);
    expect(s.cities.get(e.cityId)!.completed).toBe(true);
  });

  it('syncs origins and rejects restoration and tide rewards on the authoritative host', () => {
    const s = makeWorld();
    cityStates(s, first.cityId, layout);
    const client = makeWorld();
    cityStates(client, first.cityId, layout);
    client.cities.get(first.cityId)!.peaceful = false;
    applyFix(client, { city: cityFix(first.cityId, undefined, s.cities.get(first.cityId)!) });
    expect(client.cities.get(first.cityId)).toEqual(s.cities.get(first.cityId));
    const host = new WorldHost(s, new Map());
    const joined = host.join('peaceful-player-token', '居民', defaultLook('courier'));
    if (!joined.ok) throw new Error(joined.reason);
    host.move(
      joined.id,
      { p: [first.x, 0, first.z], v: [0, 0, 0], yaw: 0, pitch: 0, f: GROUNDED },
      { kind: 'city', id: first.cityId },
      first.cityId,
    );
    const before = deserializeSlice(host.sliceOf(joined.id)!);
    expect(host.patch(joined.id, { kind: 'complete', city: first.cityId }).ok).toBe(false);
    expect(host.patch(joined.id, { kind: 'tideHeld', city: first.cityId }).ok).toBe(false);
    expect(host.patch(joined.id, { kind: 'drain', city: first.cityId, surface: 0 }).ok).toBe(false);
    expect(deserializeSlice(host.sliceOf(joined.id)!)).toEqual(before);
    expect(host.state.cities.get(first.cityId)!.states.every((v) => v === ORIGINAL)).toBe(true);
  });
});
