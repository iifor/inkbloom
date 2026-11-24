import { expect, it } from 'vitest';
import { travellerModel } from '../server/traveller-model';
import { createWorldState, cityStates, deserializeWorld, serializeWorld } from '@/world/state';
import { townLayout } from '@/world/city/layout';
import { createWilderness } from '@/world/wilderness/generator';
import { pathsOf } from '@/world/wilderness/paths';
import { journeyOn, travellerPose } from '@/world/wilderness/travellers';
import { rememberedSightings, landmarks } from '@/world/wilderness/traveller-memory';
import {
  askTraveller,
  travelOptions,
  acceptStop,
  commitTravellerStop,
  decisionDue,
} from '@/world/wilderness/traveller-talk';

it('reports real route ends in either direction and reads changing village conditions at question time', () => {
  const w = createWilderness(4242),
    state = createWorldState('talk', w.seed);
  const j = journeyOn(
    w.seed,
    pathsOf(w)
      .trailsNear(0, 0, 128, 128)
      .find((t) => t.id === 'spawn')!,
  )!;
  const town = w.entranceInCell(0, 0)!,
    layout = townLayout(town, w);
  const ask = (topic: 'news' | 'route') =>
    askTraveller(w, state, j, (e) => (e.cityId === town.cityId ? layout.name : '远村'), topic);
  expect(ask('route')).toBe('我从出发地的石台来，这趟要去' + layout.name + '。');
  state.clock = j.lengths.at(-1)! / j.speed + j.rest + 1 - j.offset;
  expect(ask('route')).toBe('我从' + layout.name + '来，这趟要去出发地的石台。');
  expect(ask('news')).toContain(layout.name + '一直太平');
  cityStates(state, town.cityId, layout);
  const saved = state.cities.get(town.cityId)!;
  saved.peaceful = false;
  saved.states.fill(0);
  expect(ask('news')).toContain(layout.name + '还受墨染');
  saved.states[0] = 1;
  expect(ask('news')).toContain(layout.name + '已经有些地方恢复了颜色');
  saved.completed = true;
  expect(ask('news')).toContain(layout.name + '已经恢复了颜色');
  state.clock = 2;
  const stop = travelOptions(w, state, j).find((s) => s.kind === 'bridge')!;
  const before = travellerPose(j, state.clock);
  const leg = acceptStop(j, state.clock, undefined, stop.at)!;
  state.travellerLegs.set('spawn', leg);
  expect(travellerPose(j, state.clock, leg)).toMatchObject({ x: before.x, z: before.z });
  expect(ask('route')).toContain('我从出发地的石台来，这趟要去路上的桥头');
  state.clock += Math.abs(leg.to - leg.from) / j.speed + 1;
  expect(ask('route')).toContain('刚到路上的桥头');
  expect(decisionDue(j, state.clock, leg)).toBe(false);
  state.clock += j.rest / 2;
  expect(decisionDue(j, state.clock, leg)).toBe(true);
  expect(deserializeWorld(serializeWorld(state)).travellerLegs.get('spawn')).toEqual(leg);
  const legacy = JSON.parse(serializeWorld(state));
  legacy.version = 8;
  delete legacy.travellerLegs;
  expect(deserializeWorld(JSON.stringify(legacy)).travellerLegs.size).toBe(0);
});

it('passes only reachable option facts to a compatible model and rejects invalid choices', async () => {
  const env = {
    INKBLOOM_AI_BASE_URL: 'https://test.invalid/v1/',
    INKBLOOM_AI_MODEL: 'fixture',
    INKBLOOM_AI_API_KEY: 'example',
  };
  const opts = [{ kind: 'bridge', place: 'bridge:0', metres: 85, onward: false } as const];
  const memory = [{ place: 'c2_1', kind: 'infected', at: 12 } as const];
  expect(travellerModel({})).toBeUndefined();
  for (const [output, expected] of [
    ['{"stop":0}', 0],
    ['{"stop":10}', null],
    ['not JSON', null],
  ] as const) {
    const choose = travellerModel(env, async (url, init) => {
      expect(url).toBe('https://test.invalid/v1/chat/completions');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer example' });
      const req = JSON.parse(String(init?.body));
      expect(req.model).toBe('fixture');
      expect(JSON.parse(req.messages[1].content)).toEqual({ options: opts, memory });
      return Response.json({ choices: [{ message: { content: output } }] });
    })!;
    expect(await choose(opts, memory)).toBe(expected);
  }
});

it('remembers only encounters on actual legs and retains old village conditions across rerouting and reload', () => {
  const w = createWilderness(4242),
    state = createWorldState('journal', 4242);
  const j = journeyOn(
    4242,
    pathsOf(w)
      .trailsNear(0, 0, 128, 128)
      .find((t) => t.id === 'spawn')!,
  )!;
  const town = w.entranceInCell(0, 0)!,
    layout = townLayout(town, w);
  cityStates(state, town.cityId, layout);
  const city = state.cities.get(town.cityId)!;
  city.peaceful = false;
  city.states.fill(0);
  const end = j.lengths.at(-1)!;
  const bridge = landmarks(w, state, j).find((s) => s.kind === 'bridge')!;
  const recall = () => askTraveller(w, state, j, () => layout.name, 'memory');
  expect(rememberedSightings(w, state, j)).toEqual([]);
  state.clock = bridge.at / j.speed - j.offset + 0.1;
  expect(recall()).toContain('木桥');
  expect(recall()).not.toContain(layout.name);
  const first = commitTravellerStop(w, state, j, end)!;
  expect(first.memory).toHaveLength(1);
  state.clock += Math.abs(first.to - first.from) / j.speed + 0.1;
  expect(recall()).toContain(layout.name);
  expect(recall()).toContain('还受墨染');
  // Restore the village after its visitor has departed.
  state.clock += j.rest + 5;
  city.completed = true;
  city.restoredAt = state.clock;
  expect(recall()).toContain('还受墨染');
  expect(recall()).not.toContain('恢复了颜色');
  state.clock += 2 * (Math.abs(first.to - first.from) / j.speed + j.rest);
  expect(recall()).toContain('恢复了颜色');
  commitTravellerStop(w, state, j, bridge.at);
  const reloaded = deserializeWorld(serializeWorld(state));
  expect(askTraveller(w, reloaded, j, () => layout.name, 'memory')).toBe(recall());
  expect(
    rememberedSightings(w, reloaded, j)
      .filter((s) => s.place === town.cityId)
      .map((s) => s.kind),
  ).toEqual(['restored', 'infected']);
  // The pre-memory save format cannot say what this traveller did before its current leg.
  const legacy = JSON.parse(serializeWorld(state));
  legacy.version = 9;
  delete legacy.travellerMemorySince;
  delete legacy.travellerLegs.spawn.memory;
  const migrated = deserializeWorld(JSON.stringify(legacy));
  expect(rememberedSightings(w, migrated, j)).toEqual([]);
});

it('retains a witnessed restoration during a gate stop, and bounds repeated sightings over many laps', () => {
  const w = createWilderness(4242),
    state = createWorldState('at-gate', 4242);
  const j = journeyOn(
    4242,
    pathsOf(w)
      .trailsNear(0, 0, 128, 128)
      .find((t) => t.id === 'spawn')!,
  )!;
  const town = w.entranceInCell(0, 0)!;
  cityStates(state, town.cityId, townLayout(town, w));
  const city = state.cities.get(town.cityId)!;
  city.peaceful = false;
  city.completed = true;
  city.restoredAt = j.lengths.at(-1)! / j.speed - j.offset + 2;
  state.clock = city.restoredAt + 1;
  expect(
    rememberedSightings(w, state, j)
      .filter((v) => v.place === town.cityId)
      .map((v) => v.kind),
  ).toEqual(['restored', 'infected']);
  state.clock = 1e8;
  const entries = rememberedSightings(w, state, j);
  expect(entries.length).toBeLessThanOrEqual(12);
  expect(new Set(entries.map((s) => s.place + '/' + s.kind)).size).toBe(entries.length);
  expect(entries.every((s) => s.at >= 0 && s.at <= state.clock)).toBe(true);
});
