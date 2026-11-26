import { describe, expect, it, vi } from 'vitest';
import { defaultLook } from '@/content/characters';
import { MAX_SAVED_PLAYERS, NEAR, TIDE_GAP, WorldHost } from '@/world/net/host';
import { AIMING, GROUNDED, PAINTING, PROTOCOL, parseClientMessage, type Motion } from '@/world/net/protocol';
import { deserializeSlice } from '@/world/net/slices';
import { validPatch } from '@/world/net/validate';
import * as release from '@/world/paint/release';
import { cityStates, createWorldState, savedProgress } from '@/world/state';
import { chunkSaturation, wildMonstersInChunk } from '@/world/wilderness/wild-monsters';
import { startsPeaceful } from '@/world/city/origin';
import { layoutCache } from '@/world/net/patch-context';
import { type Entrance, createWilderness } from '@/world/wilderness/generator';
import { type PigmentSource, sourcesInChunk } from '@/world/wilderness/sources';
import { inkWellsNear, wellGuards } from '@/world/wilderness/ink-wells';

const SEED = 7;
const land = createWilderness(SEED);
const layoutOf = layoutCache(land);
const LOOK = defaultLook('courier');
const token = (i: number): string => `player-token-${i}`;
const host = (max = 10): WorldHost => new WorldHost(createWorldState('net', SEED), new Map(), max);
const at = (x: number, z: number): Motion => ({ p: [x, 0, z], v: [0, 0, 0], yaw: 0, pitch: 0, f: GROUNDED });
const wild = { kind: 'wild' } as const;

it.each([false, true])('accepts wilderness defeats (NPC: %s) without duplicate rewards', (npc) => {
  const h = host();
  const w = createWilderness(SEED);
  let found;
  for (let x = -5; x <= 5 && !found; x++)
    for (let z = -5; z <= 5 && !found; z++) {
      const sat = chunkSaturation(w, x, z, (id) => savedProgress(h.state, id));
      found = wildMonstersInChunk(w, x, z, sat).find((m) => Number(m.id.split(':')[1]) >= 100);
    }
  expect(found).toBeDefined();
  const m = found!;
  const id = joined(h, 77, m.x, m.z);
  const before = deserializeSlice(h.sliceOf(id)!);
  const patch = { kind: 'hunt' as const, monster: m.id, ...(npc ? { npc: true as const } : {}) };
  expect(validPatch(patch)).toEqual(patch);
  expect(h.patch(id, patch).ok).toBe(true);
  const after = deserializeSlice(h.sliceOf(id)!);
  if (npc) {
    expect(after.inventory.ink).toBe(before.inventory.ink);
    expect(after.growth.xp).toBe(before.growth.xp);
  } else expect(after.growth.xp).toBeGreaterThan(before.growth.xp);
  expect(h.state.hunted.has(m.id)).toBe(true);
  expect(h.patch(id, { kind: 'hunt', monster: m.id }).ok).toBe(false);
});

function joined(h: WorldHost, i: number, x = 0, z = 0): number {
  const r = h.join(token(i), `玩家${i}`, LOOK);
  if (!r.ok) throw new Error(r.reason);
  h.move(r.id, at(x, z), wild, null);
  return r.id;
}

it('keeps infection personal and rejects district colour loss while a nearby peer is healthy', () => {
  const h=host(), a=joined(h,1), b=joined(h,2);
  const site={scene:wild,x:0,y:0,z:0};
  const death={kind:'death',...site,inkMonster:true} as const;
  expect(h.patch(a,death).ok).toBe(true);
  expect(deserializeSlice(h.sliceOf(b)!).infectedAt).toBeNull();
  const overrun={kind:'overrun',person:'player',site} as const;
  expect(h.patch(a,overrun).ok).toBe(false);
  expect(h.patch(b,death).ok).toBe(true);
  expect(h.patch(b,overrun)).toMatchObject({ok:true,shared:true});
  expect(WorldHost.load(h.save()).state.inkAreas.size).toBe(1);
});

function aSource(): PigmentSource {
  const w = createWilderness(SEED);
  for (let cx = -4; cx <= 4; cx++)
    for (let cz = -4; cz <= 4; cz++) {
      const s = sourcesInChunk(w, cx, cz)[0];
      if (s) return s;
    }
  throw new Error('no pigment source near the origin');
}

function aTown(): Entrance {
  const e = createWilderness(SEED)
    .entrancesNear(0, 0, 3)
    .find((e) => !startsPeaceful(SEED, e.cityId));
  if (!e) throw new Error('no town near the origin');
  return e;
}

/** A player standing in a town, as its keeper (first one in). */
function keeper(h: WorldHost, i: number, town: Entrance): number {
  const id = joined(h, i, town.x, town.z);
  h.move(id, at(town.x, town.z), { kind: 'city', id: town.cityId }, town.cityId);
  return id;
}

/** Colour one surface of a town for the test, as if someone had restored it. */
function colour(h: WorldHost, town: Entrance, who: number, surface: number): void {
  cityStates(h.state, town.cityId, layoutOf(town.cityId)!);
  const r = h.patch(who, { kind: 'restore', city: town.cityId, surface });
  if (!r.ok) {
    // not affordable or guarded: set it directly, it is only the starting point of the test
    h.state.cities.get(town.cityId)!.states[surface] = 1;
  }
}

describe('world host: who is in', () => {
  it('updates appearance in place and keeps the saved profile current', () => {
    const h = host();
    const id = joined(h, 1, 12, 24);
    const observer = joined(h, 2, 12, 25);
    const before = h.nearby(observer);
    const slice = h.sliceOf(id);
    h.save();
    const look = defaultLook('ranger');
    expect(h.updateProfile(id, ' 新名字 ', look)).toEqual({ id, name: '新名字', look });
    expect(h.dirty).toBe(true);
    expect(h.nearby(observer)).toEqual(before);
    expect(h.sliceOf(id)).toBe(slice);
    expect(h.count).toBe(2);
    expect(h.everyone()).toContainEqual({ id, name: '新名字', look });
    expect(JSON.parse(h.save()).players[token(1)]).toMatchObject({ name: '新名字', look });
    expect(h.updateProfile(id, '新名字', look)).toBeNull();
    expect(h.updateProfile(999, 'other', look)).toBeNull();
    expect(h.dirty).toBe(false);
  });

  it('validates profile updates and discards client-supplied player IDs', () => {
    const look = defaultLook('ranger');
    expect(parseClientMessage(JSON.stringify({ t: 'profile', id: 99, name: '新名字', look }))).toEqual({
      t: 'profile',
      name: '新名字',
      look,
    });
    expect(
      parseClientMessage(JSON.stringify({ t: 'profile', name: 'bad', look: { character: 'missing' } })),
    ).toBeNull();
  });

  it('takes up to the limit and turns the next player away', () => {
    const h = host(10);
    for (let i = 0; i < 10; i++) joined(h, i);
    const r = h.join(token(10), '第十一个', LOOK);
    expect(r.ok).toBe(false);
    expect(h.count).toBe(10);
    // someone leaves: there is room again
    h.leave(1);
    expect(h.join(token(10), '第十一个', LOOK).ok).toBe(true);
  });

  it('the same character joining again replaces their old (dropped) connection', () => {
    const h = host();
    const first = joined(h, 1);
    const r = h.join(token(1), '又是我', LOOK);
    expect(r).toMatchObject({ ok: true, replaced: first });
    expect(h.count).toBe(1);
  });

  it('remembers at most so many players, forgetting the longest gone', () => {
    const h = host();
    for (let i = 0; i <= MAX_SAVED_PLAYERS; i++) {
      const id = joined(h, i);
      h.tick(1);
      h.leave(id);
    }
    expect(h.remembered).toBe(MAX_SAVED_PLAYERS);
  });
});

describe('world host: patches', () => {
  it("spends from the sender's own pigment, not anyone else's", () => {
    const h = host();
    const a = joined(h, 1);
    const b = joined(h, 2);
    const before = deserializeSlice(h.sliceOf(b)!).inventory.generic;
    expect(h.patch(a, { kind: 'spend', generic: 5 }).ok).toBe(true);
    expect(deserializeSlice(h.sliceOf(a)!).inventory.generic).toBe(before - 5);
    expect(deserializeSlice(h.sliceOf(b)!).inventory.generic).toBe(before);
    expect(h.patch(a, { kind: 'spend', generic: 1e6 }).ok).toBe(false);
  });

  it('a harvest is shared: the source is gone for everyone, the pigment is the harvester’s', () => {
    const src = aSource();
    const h = host();
    const a = joined(h, 1, src.x, src.z);
    const b = joined(h, 2, src.x, src.z);
    const r = h.patch(a, { kind: 'harvest', source: src.id });
    expect(r).toMatchObject({ ok: true, shared: true });
    expect(deserializeSlice(h.sliceOf(a)!).inventory.generic).toBeGreaterThan(
      deserializeSlice(h.sliceOf(b)!).inventory.generic,
    );
    expect(h.patch(b, { kind: 'harvest', source: src.id }).ok).toBe(false);
  });

  it('an ink well is cleansed once, for everyone, after its guards are down', () => {
    const w = createWilderness(SEED);
    const h = host();
    const well = inkWellsNear(w, 0, 0, 1800).find(
      (x) =>
        wellGuards(
          w,
          x,
          chunkSaturation(w, x.cx, x.cz, (id) => savedProgress(h.state, id)),
        ).length > 0,
    )!;
    expect(well).toBeDefined();
    const a = joined(h, 1, well.x, well.z);
    const b = joined(h, 2, well.x, well.z);
    expect(h.patch(a, { kind: 'cleanse', well: well.id })).toMatchObject({
      ok: false,
      fix: { cleansed: [[well.id, null]] },
    });
    for (const g of wellGuards(w, well, 0)) expect(h.patch(a, { kind: 'hunt', monster: g.id }).ok).toBe(true);
    const r = h.patch(a, { kind: 'cleanse', well: well.id });
    expect(r).toMatchObject({ ok: true, shared: true, fix: { cleansed: [[well.id, h.state.clock]] } });
    const no = h.patch(b, { kind: 'cleanse', well: well.id });
    expect(no).toMatchObject({ ok: false, fix: { cleansed: [[well.id, h.state.clock]] } });
    // a kill the server will not take is answered too, so the client brings the monster back
    expect(h.patch(a, { kind: 'hunt', monster: `${well.cx},${well.cz}:99` })).toMatchObject({
      ok: false,
      fix: { hunted: [[`${well.cx},${well.cz}:99`, null]] },
    });
    const far = joined(h, 3, well.x + NEAR * 3, well.z);
    expect(h.patch(far, { kind: 'cleanse', well: well.id }).ok).toBe(false);
  });

  it('only acts near where the sender stands', () => {
    const src = aSource();
    const h = host();
    const far = joined(h, 1, src.x + NEAR * 3, src.z);
    expect(h.patch(far, { kind: 'harvest', source: src.id })).toMatchObject({ ok: false });
    expect(h.state.harvested.has(src.id)).toBe(false);
  });

  it('a patch that throws partway leaves nothing behind', () => {
    const town = aTown();
    const h = host();
    const a = keeper(h, 1, town);
    const before = h.sliceOf(a);
    const bloom = vi.spyOn(release, 'releaseAround').mockImplementationOnce(() => {
      throw new Error('failed after updating defeat flags and XP');
    });
    try {
      const result = h.patch(a, { kind: 'defeat', city: town.cityId, monster: 0 });
      expect(bloom).toHaveBeenCalledOnce();
      expect(result.ok).toBe(false);
      expect(h.sliceOf(a)).toBe(before);
      expect(h.state.cities.has(town.cityId)).toBe(false);
    } finally {
      bloom.mockRestore();
    }
  });

  it('answers with the values it ended on: what changed when accepted, all of it when not', () => {
    const town = aTown();
    const h = host();
    const a = keeper(h, 1, town);
    colour(h, town, a, 0);
    const states = h.state.cities.get(town.cityId)!.states;
    states[1] = 1;
    const k = keeper(h, 2, town);
    const ok = h.patch(a, { kind: 'drain', city: town.cityId, surface: 1 });
    // only the keeper drains; player 1 was first in, so player 2's attempt is turned down
    expect(ok).toMatchObject({ ok: true, fix: { city: { id: town.cityId, states: [[1, 0]] } } });
    const no = h.patch(k, { kind: 'drain', city: town.cityId, surface: 0 });
    expect(no.ok).toBe(false);
    expect(no.fix?.city?.states).toHaveLength(states.length);
  });

  it('a restored town pays each player who finishes it, once each', () => {
    const town = aTown();
    const h = host();
    const a = keeper(h, 1, town);
    const b = joined(h, 2, town.x, town.z);
    colour(h, town, a, 0);
    h.state.cities.get(town.cityId)!.states.fill(1);
    const generic = (id: number): number => deserializeSlice(h.sliceOf(id)!).inventory.generic;
    const before = generic(b);
    const done = h.patch(a, { kind: 'complete', city: town.cityId });
    expect(done).toMatchObject({ ok: true, fix: { city: { completed: true } } });
    expect(h.patch(a, { kind: 'complete', city: town.cityId }).ok).toBe(false);
    expect(h.patch(b, { kind: 'complete', city: town.cityId }).ok).toBe(true);
    expect(generic(b)).toBeGreaterThan(before);
    expect(h.patch(b, { kind: 'complete', city: town.cityId }).ok).toBe(false);
  });
});

describe('world host: the tide and erosion are the keeper’s', () => {
  it('only the keeper may drain, only what still has colour, and not too fast', () => {
    const town = aTown();
    const h = host();
    const k = keeper(h, 1, town);
    const other = joined(h, 2, town.x, town.z);
    colour(h, town, k, 0);
    colour(h, town, k, 1);
    expect(h.patch(other, { kind: 'drain', city: town.cityId, surface: 0 })).toMatchObject({ ok: false });
    expect(h.patch(k, { kind: 'drain', city: town.cityId, surface: 0 })).toMatchObject({
      ok: true,
      shared: true,
    });
    // already grey: nothing to drain (so draining cannot be used to spam everyone)
    expect(h.patch(k, { kind: 'drain', city: town.cityId, surface: 0 }).ok).toBe(false);

    // a burst, then a steady rate
    const states = h.state.cities.get(town.cityId)!.states;
    let ok = 0;
    for (let i = 0; i < Math.min(states.length, 200); i++) {
      states[i] = 1;
      if (h.patch(k, { kind: 'drain', city: town.cityId, surface: i }).ok) ok++;
    }
    expect(ok).toBeLessThan(80);
  });

  it('only the keeper may claim a held tide, and not twice in a row', () => {
    const town = aTown();
    const h = host();
    const k = keeper(h, 1, town);
    const other = joined(h, 2, town.x, town.z);
    expect(h.patch(other, { kind: 'tideHeld', city: town.cityId }).ok).toBe(false);
    expect(h.patch(k, { kind: 'tideHeld', city: town.cityId }).ok).toBe(true);
    expect(h.patch(k, { kind: 'tideHeld', city: town.cityId }).ok).toBe(false);
    h.tick(TIDE_GAP + 1);
    expect(h.patch(k, { kind: 'tideHeld', city: town.cityId }).ok).toBe(true);
  });

  it('nobody becomes keeper of a town they are not in', () => {
    const town = aTown();
    const h = host();
    const liar = joined(h, 1, town.x + NEAR * 5, town.z);
    h.move(liar, at(town.x + NEAR * 5, town.z), { kind: 'city', id: town.cityId }, town.cityId);
    expect(h.keepers().has(town.cityId)).toBe(false);
  });
});

describe('world host: clock, keepers, nearby', () => {
  it('owns the clock', () => {
    const h = host();
    h.tick(2.5);
    expect(h.state.clock).toBeCloseTo(2.5);
  });

  it('whoever has been in a town longest keeps its tide; the next one takes over when they leave', () => {
    const town = aTown();
    const h = host();
    const a = keeper(h, 1, town);
    h.tick(1);
    const b = keeper(h, 2, town);
    expect(h.keepers().get(town.cityId)).toBe(a);
    h.leave(a);
    expect(h.keepers().get(town.cityId)).toBe(b);
    h.move(b, at(town.x + 5000, town.z), wild, null);
    expect(h.keepers().size).toBe(0);
  });

  it('only sends the motion of players within view range', () => {
    const h = host();
    const a = joined(h, 1, 0, 0);
    const b = joined(h, 2, 50, 0);
    joined(h, 3, 5000, 0);
    expect(h.nearby(a).map((m) => m.id)).toEqual([b]);
  });

  it('passes what is in hand on with the motion', () => {
    const h = host();
    const a = joined(h, 1, 0, 0);
    const b = joined(h, 2, 5, 0);
    h.move(b, { ...at(5, 0), f: GROUNDED | AIMING, h: 'sniper' }, wild, null);
    expect(h.nearby(a)[0]).toMatchObject({ id: b, h: 'sniper', f: GROUNDED | AIMING });
  });

  it('shows a gesture to the players in view, a burst and then a few a second', () => {
    const h = host();
    const a = joined(h, 1, 0, 0);
    const b = joined(h, 2, 50, 0);
    joined(h, 3, 5000, 0);
    expect(h.gesture(a)).toEqual([b]);
    // a flood is cut off, and the allowance comes back with time
    let shown = 1;
    for (let i = 0; i < 100; i++) if (h.gesture(a).length) shown++;
    expect(shown).toBeLessThan(20);
    expect(h.gesture(a)).toEqual([]);
    h.tick(1);
    expect(h.gesture(a)).toEqual([b]);
    // nobody who is not in the world
    expect(h.gesture(999)).toEqual([]);
  });
});

describe('world host: saving', () => {
  it('keeps the world and every player across a restart', () => {
    const src = aSource();
    const h = host();
    const a = joined(h, 1, src.x, src.z);
    h.patch(a, { kind: 'spend', generic: 3 });
    h.patch(a, { kind: 'harvest', source: src.id });
    h.tick(10);
    const generic = deserializeSlice(h.sliceOf(a)!).inventory.generic;

    const again = WorldHost.load(h.save());
    expect(again.state.clock).toBeCloseTo(10);
    expect(again.state.harvested.has(src.id)).toBe(true);
    const r = again.join(token(1), '玩家1', LOOK);
    if (!r.ok) throw new Error(r.reason);
    expect(deserializeSlice(again.sliceOf(r.id)!).inventory.generic).toBe(generic);
  });
});

describe('protocol', () => {
  it('accepts a proper hello and cleans the name', () => {
    const m = parseClientMessage(
      JSON.stringify({ t: 'hello', v: PROTOCOL, token: token(1), name: '  小满  ', look: LOOK }),
    );
    expect(m).toMatchObject({ t: 'hello', name: '小满' });
  });

  it('rejects junk, bad looks, bad motion and forbidden patches', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL,
          token: token(1),
          name: 'x',
          look: { character: 'pirate' },
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: 'move', p: [0, 0], v: [0, 0, 0], yaw: 0, pitch: 0, f: 0 })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: 'patch', seq: 1, patch: { kind: 'grant', generic: 999 } })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: 'patch', seq: 1, patch: { kind: 'spend', generic: 1 } })),
    ).not.toBeNull();
  });

  it('checks what is in hand and the motion flags', () => {
    const move = (extra: object): ReturnType<typeof parseClientMessage> =>
      parseClientMessage(
        JSON.stringify({
          t: 'move',
          p: [0, 0, 0],
          v: [0, 0, 0],
          yaw: 0,
          pitch: 0,
          f: GROUNDED,
          scene: { kind: 'wild' },
          town: null,
          ...extra,
        }),
      );
    expect(move({ h: 'katana' })).toMatchObject({ h: 'katana' });
    expect(move({ h: 'brush', f: PAINTING })).toMatchObject({ h: 'brush', f: PAINTING });
    // empty hands: no field at all
    expect(move({})).not.toHaveProperty('h');
    expect(move({ h: null })).not.toHaveProperty('h');
    // only what can be held; the marker, a made-up weapon or any other shape is not a move
    for (const h of ['marker', 'bazooka', 'toString', '', 3, ['rifle'], { k: 'rifle' }])
      expect(move({ h })).toBeNull();
    // flags past the known ones are dropped
    expect(move({ f: 1024 | AIMING })).toMatchObject({ f: AIMING });
  });

  it('accepts a gesture only as an attack or a skill, and nothing riding along', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'gesture', g: 'attack' }))).toEqual({
      t: 'gesture',
      g: 'attack',
    });
    expect(parseClientMessage(JSON.stringify({ t: 'gesture', g: 'skill', junk: 'x'.repeat(100) }))).toEqual({
      t: 'gesture',
      g: 'skill',
    });
    for (const g of ['dance', 'slash', undefined, 1, null, ['attack']])
      expect(parseClientMessage(JSON.stringify({ t: 'gesture', g }))).toBeNull();
  });

  it('checks every field of a patch and keeps only the known ones', () => {
    // amounts must be numbers (a string would turn pigment into NaN)
    expect(validPatch({ kind: 'spend', generic: 'x' })).toBeNull();
    expect(validPatch({ kind: 'spend', generic: -5 })).toBeNull();
    // indices must be whole numbers in range
    expect(validPatch({ kind: 'restore', city: 'c1_2', surface: 'push' })).toBeNull();
    expect(validPatch({ kind: 'restore', city: 'c1_2', surface: 1.5 })).toBeNull();
    expect(validPatch({ kind: 'request', city: 'c1_2', request: 0 })).toBeNull();
    // ids must look like ids
    expect(validPatch({ kind: 'drain', city: 'x'.repeat(5000), surface: 0 })).toBeNull();
    expect(validPatch({ kind: 'harvest', source: { a: 1 } })).toBeNull();
    // the ink tide's own black is not a paint
    expect(validPatch({ kind: 'paint', city: 'c1_2', surface: 0, color: 999 })).toBeNull();
    // extra fields are dropped, so they are neither stored nor passed on
    expect(validPatch({ kind: 'restore', city: 'c1_2', surface: 3, junk: 'x'.repeat(9000) })).toEqual({
      kind: 'restore',
      city: 'c1_2',
      surface: 3,
    });
    // a held tide must name a town
    expect(validPatch({ kind: 'tideHeld' })).toBeNull();
  });
});

it('shares NPC city defeats without granting personal kill rewards', () => {
  const town = aTown(),
    h = host(),
    id = keeper(h, 1, town);
  const before = deserializeSlice(h.sliceOf(id)!);
  const patch = { kind: 'defeat' as const, city: town.cityId, monster: 0, npc: true as const };
  expect(validPatch(patch)).toEqual(patch);
  expect(h.patch(id, patch)).toMatchObject({ ok: true, shared: true });
  const after = deserializeSlice(h.sliceOf(id)!);
  expect(after.inventory.ink).toBe(before.inventory.ink);
  expect(after.growth.xp).toBe(before.growth.xp);
  expect(h.patch(id, { kind: 'defeat', city: town.cityId, monster: 0 }).ok).toBe(false);
});
