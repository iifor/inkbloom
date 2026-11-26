import { expect, it, vi } from 'vitest';
import { Group, MeshBasicMaterial, Vector3 } from 'three';
import { enemyIndex } from '@/content/enemies';
import { MonsterGroup } from '@/systems/combat/monsters';
import { NpcFighter, npcBattles } from '@/systems/combat/npc-combat';
import { NpcAttention } from '@/world/npc-attention';
import { headless } from './support/headless';

function encounter(type: Parameters<typeof enemyIndex>[0] = 'blot') {
  const h = headless();
  h.physics.addBox('floor', { x: -100, y: -1, z: -100 }, { x: 100, y: 0, z: 100 });
  h.place(70, 0, 70);
  const group = new MonsterGroup(h.ctx, h.physics, new Group(), new MeshBasicMaterial());
  const npc = new NpcFighter(npcBattles(h.ctx), h.physics, new Vector3());
  const defeated = vi.fn();
  group.spawn(enemyIndex(type), new Vector3(0, 0, -8), { tag: 'test', onDefeat: defeated });
  const tick = (dt: number) => {
    npc.update(dt);
    group.update(dt);
  };
  return { h, group, npc, defeated, tick };
}

it('ordinary NPCs and monsters exchange real damage without involving the distant player', () => {
  const { h, group, npc, tick } = encounter();
  h.run(4, tick);
  expect(npc.hp).toBeLessThan(npc.maxHp);
  expect(h.count('monster:hit')).toBeGreaterThan(0);
  expect(h.count('player:hurt')).toBe(0);
  expect(npc.target).toBeDefined();
  npc.dispose();
  group.dispose();
  expect(npcBattles(h.ctx).people.size).toBe(0);
  expect(npcBattles(h.ctx).enemies.size).toBe(0);
});

it('a bystander closes the gap and lands a timed strike on a monster fighting elsewhere', () => {
  const { h, group, npc } = encounter();
  const target = [...npc.battles.enemies][0]!;
  const damage = vi.spyOn(target, 'damage');
  h.run(0.5, (dt) => npc.update(dt));
  expect(npc.position.z).toBeLessThan(-1);
  expect(npc.approachHeading).toBeDefined();
  expect(damage).not.toHaveBeenCalled();
  h.run(4, (dt) => npc.update(dt));
  expect(npc.position.distanceTo(target.position)).toBeLessThan(1.5 + target.radius);
  expect(damage).toHaveBeenCalled();
  npc.dispose();
  group.dispose();
});

it.each(['spitter', 'weasel'] as const)(
  '%s can attack an NPC, and a downed NPC is no longer targeted',
  (type) => {
    const { h, group, npc, tick } = encounter(type);
    h.run(15, tick);
    expect(npc.hp).toBeLessThan(npc.maxHp);
    expect(h.count('player:hurt')).toBe(0);
    npc.damage(1000);
    expect(npc.alive).toBe(false);
    expect(npcBattles(h.ctx).victim(h.physics, new Vector3(), 30)).toBeUndefined();
    group.clear('test');
    h.run(19, tick);
    expect(npc.alive).toBe(true);
    expect(npc.busy).toBe(false);
    npc.dispose();
    group.dispose();
  },
);

it('walls prevent NPC fights and NPC kills have distinct attribution', () => {
  const { h, group, npc, tick, defeated } = encounter();
  h.physics.addBox('wall', { x: -10, y: 0, z: -4.5 }, { x: 10, y: 5, z: -3.5 });
  h.run(1, tick);
  expect(npc.busy).toBe(false);
  expect(npc.hp).toBe(npc.maxHp);
  h.physics.removeGroup('wall');
  const hit = group.inSphere(new Vector3(0, 0, -8), 20)[0]!;
  hit.damage(56, new Vector3(), { byNpc: true });
  h.run(5, tick);
  expect(defeated).toHaveBeenCalledExactlyOnceWith(true);
  expect(h.count('monster:died')).toBe(0);
  expect(npc.busy).toBe(false);
  npc.dispose();
  group.dispose();
});

it('pauses routines throughout combat and resumes without advancing their route', () => {
  const attention = new NpcAttention();
  attention.hold(10);
  for (let clock = 11; clock < 20; clock++) attention.hold(clock);
  expect(attention.time(20)).toBe(10);
  attention.update(20, 0.1, { x: 0, y: 0, z: 0 }, [], () => true);
  expect(attention.time(20)).toBe(10);
  expect(attention.time(21)).toBe(11);
});
