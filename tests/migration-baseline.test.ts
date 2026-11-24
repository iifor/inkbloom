import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WorldHost } from '@/world/net/host';
import { PROTOCOL, parseClientMessage } from '@/world/net/protocol';
import { defaultLook } from '@/content/characters';

const fixture = (name: string) =>
  readFileSync(new URL('../internal/save/testdata/' + name, import.meta.url), 'utf8');

it('accepts the frozen v9 handshake and recovers both players from the v1 server save', () => {
  const hello = JSON.parse(fixture('hello.json'));
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
    expect(JSON.parse(host.sliceOf(joined.id)!)).toEqual(JSON.parse(original.players[token].slice));
  }
  expect(host.state.seed).toBe(7);
});
