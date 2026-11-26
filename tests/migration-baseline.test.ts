import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WorldHost } from '@/world/net/host';
import { PROTOCOL, parseClientMessage } from '@/world/net/protocol';
import { SAVE_VERSION } from '@/world/state';
import { TERRAIN_VERSION } from '@/world/wilderness/terrain-version';
import { defaultLook } from '@/content/characters';

const fixture = (name: string) =>
  readFileSync(new URL('../internal/save/testdata/' + name, import.meta.url), 'utf8');

it('uses the current handshake version and recovers both players from the v1 server save', () => {
  const hello = { ...JSON.parse(fixture('hello.json')), v: PROTOCOL };
  expect(hello.v).toBe(PROTOCOL);
  expect(parseClientMessage(JSON.stringify(hello))).toMatchObject({ t: 'hello', token: 'fixture-one' });
  const original = JSON.parse(fixture('world-v1.json'));
  const host = WorldHost.load(JSON.stringify(original));
  for (const [token, name] of [
    ['fixture-one', '甲'],
    ['fixture-two', '乙'],
  ] as const) {
    const joined = host.join(token, name, defaultLook('courier'));
    if (!joined.ok) throw new Error(joined.reason);
    expect(JSON.parse(host.sliceOf(joined.id)!)).toEqual({
      ...JSON.parse(original.players[token].slice), version: SAVE_VERSION, terrainVersion: TERRAIN_VERSION,
      infectedAt:null,infectedPeople:{},inkAreas:{},
    });
  }
  expect(host.state.seed).toBe(7);
});
