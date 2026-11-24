import { expect, it } from 'vitest';
import type { GameContext } from '@/game/types';
import { farmPopulation, villagePopulation } from '@/systems/city/residents';
import { Homecomings, returnedCount } from '@/world/city/homecoming';
import { townLayout } from '@/world/city/layout';
import { startsPeaceful } from '@/world/city/origin';
import { applyFix, cityFix } from '@/world/net/fix';
import { worldPatchContext } from '@/world/net/patch-context';
import { applyPatch } from '@/world/patch';
import { ORIGINAL } from '@/world/paint/surfaces';
import { createWorldState, cityStates, deserializeWorld, serializeWorld } from '@/world/state';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness } from '@/world/wilderness/generator';
import { TUNING } from '@/content/tuning';

it('returns the same people one household at a time, including farms never visited before restoration', () => {
  const state = createWorldState('test', 4242);
  const w = createWilderness(state.seed);
  const town = w.entrancesNear(0, 0, 2).find((t) => t.chunks === 2 && !startsPeaceful(w.seed, t.cityId))!;
  const layout = townLayout(town, w);
  const ctx = { state, wilderness: w, cities: { entranceOf: () => town } } as unknown as GameContext;
  const moves = new Homecomings(w, state);
  const inside = villagePopulation(ctx, layout, town, moves);
  cityStates(state, town.cityId, layout).states.fill(ORIGINAL);
  expect(inside()).toEqual([]);
  const before = structuredClone(state.cities.get(town.cityId)!);
  state.clock = 100;
  const patch = { kind: 'complete', city: town.cityId } as const;
  const patchCtx = worldPatchContext(
    w,
    () => layout,
    () => 1,
  );
  expect(applyPatch(state, patch, patchCtx).ok).toBe(true);
  const city = state.cities.get(town.cityId)!;
  const other = deserializeWorld(serializeWorld(state));
  const copy = other.cities.get(town.cityId)!;
  copy.restoredAt = 102;
  applyFix(other, { city: cityFix(town.cityId, before, city) });
  expect(copy.restoredAt).toBe(100);

  while (!moves.plan(town)) moves.update();
  const plan = moves.plan(town)!;
  expect(plan.families.length).toBeGreaterThan(2);
  const chunks = new Map<string, ReturnType<typeof farmPopulation>>();
  for (const family of plan.families) {
    const [cx, cz] = family.key.split(',').map((s) => Math.floor(Number(s) / TUNING.world.chunkSize));
    const key = [cx, cz].join(',');
    if (!chunks.has(key)) {
      const farm = generateWildChunk(w, cx!, cz!).farmstead!;
      expect(farm.refugeFor).toBe(town.cityId);
      chunks.set(key, farmPopulation(ctx, farm, moves));
    }
  }
  const outside = () => [...chunks.values()].flatMap((population) => population());
  const identities = (people: ReturnType<typeof inside>) =>
    people.map((p) => [p.seed, p.name].join(':')).sort();
  const original = identities(outside());
  for (const [clock, number] of [
    [129, 0],
    [130, 1],
    [189, 1],
    [190, 2],
    [1e6, plan.families.length],
  ] as const) {
    state.clock = clock;
    expect(inside().length).toBe(plan.families.slice(0, number).reduce((sum, f) => sum + f.members, 0));
    expect(identities([...outside(), ...inside()])).toEqual(original);
  }
  expect(outside()).toHaveLength(0);
  expect(applyPatch(state, patch, patchCtx).ok).toBe(false);
  expect(city.restoredAt).toBe(100);
  const loaded = deserializeWorld(serializeWorld(state));
  expect(returnedCount(loaded.clock, loaded.cities.get(town.cityId)!.restoredAt, plan.families.length)).toBe(
    plan.families.length,
  );

  const old = JSON.parse(serializeWorld(state));
  old.version = 7;
  delete old.cities[town.cityId].restoredAt;
  expect(deserializeWorld(JSON.stringify(old)).cities.get(town.cityId)!.restoredAt).toBe(state.clock);
});
