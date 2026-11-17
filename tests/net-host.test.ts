import { describe, expect, it } from 'vitest';
import { defaultLook } from '@/content/characters';
import { MAX_SAVED_PLAYERS, NEAR, TIDE_GAP, WorldHost } from '@/world/net/host';
import { GROUNDED, PROTOCOL, parseClientMessage, type Motion } from '@/world/net/protocol';
import { deserializeSlice } from '@/world/net/slices';
import { validPatch } from '@/world/net/validate';
import type { Patch } from '@/world/patch';
import { createWorldState } from '@/world/state';
import { type Entrance, createWilderness } from '@/world/wilderness/generator';
import { type PigmentSource, sourcesInChunk } from '@/world/wilderness/sources';

const SEED = 7;
const LOOK = defaultLook('courier');
const token = (i: number): string => `player-token-${i}`;
const host = (max = 10): WorldHost => new WorldHost(createWorldState('net', SEED), new Map(), max);
const at = (x: number, z: number): Motion => ({ p: [x, 0, z], v: [0, 0, 0], yaw: 0, pitch: 0, f: GROUNDED });
const wild = { kind: 'wild' } as const;

function joined(h: WorldHost, i: number, x = 0, z = 0): number {
  const r = h.join(token(i), `玩家${i}`, LOOK);
  if (!r.ok) throw new Error(r.reason);
  h.move(r.id, at(x, z), wild, null);
  return r.id;
}

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
  const e = createWilderness(SEED).entrancesNear(0, 0, 3)[0];
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
  const r = h.patch(who, { kind: 'restore', city: town.cityId, surface });
  if (!r.ok) {
    // not affordable or guarded: set it directly, it is only the starting point of the test
    h.state.cities.get(town.cityId)!.states[surface] = 1;
  }
}

describe('world host: who is in', () => {
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
    expect(deserializeSlice(h.sliceOf(a)!).inventory.colored[src.color]).toBeGreaterThan(0);
    expect(h.patch(b, { kind: 'harvest', source: src.id }).ok).toBe(false);
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
    // an Array method's name where an index belongs: applyPatch was not written for this;
    // the network never lets it through (validPatch), but the host must survive it anyway
    const r = h.patch(a, { kind: 'request', city: town.cityId, request: 'push' } as unknown as Patch);
    expect(r.ok).toBe(false);
    expect(h.sliceOf(a)).toBe(before);
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

  it('checks every field of a patch and keeps only the known ones', () => {
    // amounts must be numbers (a string would turn pigment into NaN)
    expect(validPatch({ kind: 'spend', generic: 'x' })).toBeNull();
    expect(validPatch({ kind: 'spend', generic: -5 })).toBeNull();
    // indices must be whole numbers in range
    expect(validPatch({ kind: 'restore', city: 'c1_2', surface: 'push' })).toBeNull();
    expect(validPatch({ kind: 'restore', city: 'c1_2', surface: 1.5 })).toBeNull();
    expect(validPatch({ kind: 'request', city: 'c1_2', request: 'concat' })).toBeNull();
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
