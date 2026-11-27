import { expect, it } from 'vitest';
import { defaultLook } from '@/content/characters';
import { WorldHost } from '@/world/net/host';
import { applyFix } from '@/world/net/fix';
import { GROUNDED, type Motion } from '@/world/net/protocol';
import { validPatch } from '@/world/net/validate';
import { createWorldState } from '@/world/state';

const wild = { kind: 'wild' } as const;
const town = { kind: 'city', id: 'c0_0' } as const;
const motion = (x: number): Motion => ({ p: [x, 0, 0], v: [0, 0, 0], yaw: 0, pitch: 0, f: GROUNDED });
const site = { scene: wild, x: 0, y: 0, z: 0 };
const defeat = { kind: 'defeatInfected', person: 'resident:7' } as const;

function setup() {
  const host = new WorldHost(createWorldState('infection-net', 7));
  const joined = host.join('infection-test-token', '测试', defaultLook('courier'));
  if (!joined.ok) throw new Error(joined.reason);
  host.move(joined.id, motion(0), wild, null);
  expect(host.patch(joined.id, { kind: 'infectNpc', person: defeat.person, site }).ok).toBe(true);
  return { host, id: joined.id };
}

it('synchronizes and saves an infected defeat across a town border', () => {
  const { host, id } = setup();
  host.move(id, motion(1), town, null);
  const result = host.patch(id, defeat);
  expect(result).toMatchObject({
    ok: true,
    shared: true,
    fix: { infectedPerson: [defeat.person, { defeated: true }] },
  });
  const client = createWorldState('peer', 7);
  applyFix(client, result.fix);
  expect(client.infectedPeople.get(defeat.person)?.defeated).toBe(true);
  expect(WorldHost.load(host.save()).state.infectedPeople.get(defeat.person)?.defeated).toBe(true);
  expect(host.patch(id, defeat).ok).toBe(false);
  expect(host.patch(id, { kind: 'overrun', person: defeat.person, site }).ok).toBe(false);
});

it('rejects distant or unknown infected defeats and supplies authoritative state', () => {
  const { host, id } = setup();
  host.move(id, motion(1000), wild, null);
  expect(host.patch(id, defeat)).toMatchObject({ ok: false, fix: { infectedPerson: [defeat.person, site] } });
  expect(host.patch(id, { ...defeat, person: 'resident:missing' }).ok).toBe(false);
});

it('counts healthy players across town borders when judging infection spread', () => {
  const { host, id } = setup();
  host.move(id, motion(1), town, null);
  expect(host.patch(id, { kind: 'overrun', person: defeat.person, site })).toMatchObject({
    ok: false,
    reason: '附近还有未感染的玩家',
  });
});

it('validates only an infected NPC identity in defeat requests', () => {
  expect(validPatch({ ...defeat, extra: true })).toEqual(defeat);
  for (const person of ['player', '', 'resident:', {}, 'resident:' + 'x'.repeat(101)])
    expect(validPatch({ kind: 'defeatInfected', person })).toBeNull();
});
