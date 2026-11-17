import { describe, expect, it } from 'vitest';
import { defaultLook } from '@/content/characters';
import { WorldHost } from '@/world/net/host';
import { GROUNDED, PROTOCOL, parseClientMessage, type Motion } from '@/world/net/protocol';
import { deserializeSlice } from '@/world/net/slices';
import { createWorldState } from '@/world/state';
import { createWilderness } from '@/world/wilderness/generator';
import { type PigmentSource, sourcesInChunk } from '@/world/wilderness/sources';

const LOOK = defaultLook('courier');
const token = (i: number): string => `player-token-${i}`;
const host = (max = 10): WorldHost => new WorldHost(createWorldState('net', 7), new Map(), max);
const at = (x: number, z: number): Motion => ({ p: [x, 0, z], v: [0, 0, 0], yaw: 0, pitch: 0, f: GROUNDED });

function joined(h: WorldHost, i: number): number {
  const r = h.join(token(i), `玩家${i}`, LOOK);
  if (!r.ok) throw new Error(r.reason);
  return r.id;
}

function aSource(seed: number): PigmentSource {
  const w = createWilderness(seed);
  for (let cx = -4; cx <= 4; cx++)
    for (let cz = -4; cz <= 4; cz++) {
      const s = sourcesInChunk(w, cx, cz)[0];
      if (s) return s;
    }
  throw new Error('no pigment source near the origin');
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

  it('does not let the same character in twice', () => {
    const h = host();
    joined(h, 1);
    expect(h.join(token(1), '又是我', LOOK).ok).toBe(false);
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
    // and the sender cannot spend what they do not have
    expect(h.patch(a, { kind: 'spend', generic: 1e6 }).ok).toBe(false);
  });

  it('a harvest is shared: the source is gone for everyone, the pigment is the harvester’s', () => {
    const h = host();
    const a = joined(h, 1);
    const b = joined(h, 2);
    const src = aSource(7);
    const r = h.patch(a, { kind: 'harvest', source: src.id });
    expect(r).toMatchObject({ ok: true, shared: true });
    expect(deserializeSlice(h.sliceOf(a)!).inventory.colored[src.color]).toBeGreaterThan(0);
    // the second player finds it already taken
    expect(h.patch(b, { kind: 'harvest', source: src.id }).ok).toBe(false);
  });

  it('a malformed patch is refused, not thrown', () => {
    const h = host();
    const a = joined(h, 1);
    const r = h.patch(a, { kind: 'restore' } as never);
    expect(r.ok).toBe(false);
  });
});

describe('world host: clock, keepers, nearby', () => {
  it('owns the clock', () => {
    const h = host();
    h.tick(2.5);
    expect(h.state.clock).toBeCloseTo(2.5);
  });

  it('whoever has been in a town longest keeps its tide; the next one takes over when they leave', () => {
    const h = host();
    const a = joined(h, 1);
    const b = joined(h, 2);
    h.move(a, at(0, 0), { kind: 'city', id: 'c1_1' }, 'c1_1');
    h.tick(1);
    h.move(b, at(1, 0), { kind: 'city', id: 'c1_1' }, 'c1_1');
    expect(h.keepers().get('c1_1')).toBe(a);
    h.leave(a);
    expect(h.keepers().get('c1_1')).toBe(b);
    h.move(b, at(500, 0), { kind: 'wild' }, null);
    expect(h.keepers().size).toBe(0);
  });

  it('only sends the motion of players within view range', () => {
    const h = host();
    const a = joined(h, 1);
    const b = joined(h, 2);
    const c = joined(h, 3);
    h.move(a, at(0, 0), { kind: 'wild' }, null);
    h.move(b, at(50, 0), { kind: 'wild' }, null);
    h.move(c, at(5000, 0), { kind: 'wild' }, null);
    expect(h.nearby(a).map((m) => m.id)).toEqual([b]);
  });
});

describe('world host: saving', () => {
  it('keeps the world and every player across a restart', () => {
    const h = host();
    const a = joined(h, 1);
    h.patch(a, { kind: 'spend', generic: 3 });
    const src = aSource(7);
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
});
