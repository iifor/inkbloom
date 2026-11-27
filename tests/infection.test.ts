import { expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { InfectionSystem } from '@/systems/combat/infection';
import { inkFighter, npcBattles } from '@/systems/combat/npc-combat';
import { shared } from '@/engine/render/ink-material';
import { deserializeWorld, serializeWorld, SAVE_VERSION } from '@/world/state';
import { areaKey } from '@/world/infection';
import { headless } from './support/headless';

it('only a lethal monster hit converts the player, who rises where they fell', () => {
  const h = headless();
  h.place(10, 0, 0);
  h.combat.damagePlayer(1, undefined, { inkMonster: true });
  expect(h.combat.infected).toBe(false);
  h.combat.damagePlayer(1000, undefined, { fall: true });
  expect(h.ctx.state.infectedAt).toBeNull();
  h.run(10, (dt) => h.combat.update(dt));
  h.place(12, 0, 0);
  h.combat.damagePlayer(1000, undefined, { inkMonster: true });
  h.run(2, (dt) => h.combat.update(dt));
  expect(h.ctx.player.position.x).toBe(12);
  expect(h.combat.infected && h.combat.alive).toBe(true);
  h.combat.damagePlayer(1000, undefined, { inkMonster: true });
  expect(h.combat.hp).toBe(h.combat.maxHp);
});

function infectedWorld() {
  const h = headless();
  h.physics.ground = () => 0;
  const site = { scene: { kind: 'wild' as const }, x: 5, y: 0, z: 0 };
  h.ctx.apply({ kind: 'infectNpc', person: 'resident:7', site });
  h.ctx.state.inkAreas.set(areaKey(site), site);
  const sys = new InfectionSystem(h.ctx);
  const tick = (seconds = 0.6) => h.run(seconds, (dt) => sys.update(dt));
  const alive = () => [...npcBattles(h.ctx).enemies].filter((e) => e.alive());
  tick();
  return { h, site, sys, tick, alive };
}

it('saves an infected monster defeat across distance streaming, town borders and reloads', () => {
  const { h, sys, tick, alive } = infectedWorld();
  alive()[0]!.damage(10000, new Vector3());
  tick();
  expect(alive()).toHaveLength(0);
  expect(h.ctx.state.infectedPeople.get('resident:7')?.defeated).toBe(true);
  h.place(120, 0, 0);
  tick();
  h.place(0, 0, 0);
  tick();
  expect(alive()).toHaveLength(0);
  const wild = h.ctx.scenes.active;
  Object.assign(h.ctx.scenes, { active: { ...wild, root: new Group(), ref: { kind: 'city', id: 'c0_0' } } });
  tick();
  Object.assign(h.ctx.scenes, { active: wild });
  tick();
  expect(alive()).toHaveLength(0);
  const saved = serializeWorld(h.ctx.state);
  sys.dispose();
  Object.assign(h.ctx.state, deserializeWorld(saved));
  const reloaded = new InfectionSystem(h.ctx);
  h.run(1, (dt) => reloaded.update(dt));
  expect(alive()).toHaveLength(0);
  expect(h.ctx.state.infectedPeople.has('resident:7')).toBe(true);
  expect(h.ctx.state.inkAreas.size).toBe(1);
  reloaded.dispose();
});

it('preserves a fighting monster and the infection overlay across the seamless town border', () => {
  const { h, sys, tick, alive, site } = infectedWorld();
  const enemy = alive()[0]!;
  enemy.damage(10, new Vector3());
  const wild = h.ctx.scenes.active;
  const town = { ...wild, root: new Group(), ref: { kind: 'city' as const, id: 'c0_0' } };
  for (const scene of [town, wild, town, wild]) {
    Object.assign(h.ctx.scenes, { active: scene });
    tick();
    expect(alive()).toEqual([enemy]);
    expect(shared.uInkAreaCount.value).toBe(1);
    expect(shared.uInkAreas.value[0]!.toArray()).toEqual([site.x, site.z]);
  }
  // The original 60 HP monster has 50 HP left; crossing must not heal it.
  enemy.damage(50, new Vector3());
  expect(enemy.alive()).toBe(false);
  sys.dispose();
});

it('keeps infected monsters alive and visible through sunset, night and sunrise', () => {
  const { h, sys, tick, alive } = infectedWorld();
  const enemy = alive()[0]!;
  for (const hours of [8, 10, 13, 17, 23]) {
    h.ctx.state.calendarOffset = hours * 60;
    tick();
    expect(alive()).toEqual([enemy]);
    expect(shared.uInkAreaCount.value).toBe(1);
    expect(
      h.ctx.scenes.active.root.children.some((child) => child.visible && child.children.length > 0),
    ).toBe(true);
  }
  sys.dispose();
});

it('removes remote defeats and restores monsters when an optimistic defeat is rejected', () => {
  const { h, sys, tick, alive } = infectedWorld();
  const original = h.ctx.state.infectedPeople.get('resident:7')!;
  alive()[0]!.damage(10000, new Vector3());
  // A server correction puts back the authoritative undefeated record.
  h.ctx.state.infectedPeople.set('resident:7', original);
  tick();
  expect(alive()).toHaveLength(1);
  h.ctx.state.infectedPeople.set('resident:7', { ...original, defeated: true });
  h.ctx.events.emit('patch:applied', {
    patch: { kind: 'defeatInfected', person: 'resident:7' },
    remote: true,
  });
  expect(alive()).toHaveLength(0);
  tick();
  expect(alive()).toHaveLength(0);
  sys.dispose();
});

it('reads old infection records without clearing existing infections or ink areas', () => {
  const { h, sys } = infectedWorld();
  const json = JSON.parse(serializeWorld(h.ctx.state));
  json.version = 12;
  const saved = deserializeWorld(JSON.stringify(json));
  expect(saved.version).toBe(SAVE_VERSION);
  expect(saved.infectedPeople.get('resident:7')?.defeated).toBeUndefined();
  expect(saved.inkAreas).toEqual(h.ctx.state.inkAreas);
  sys.dispose();
});

it('waits for the last healthy resident then saves the local ink area and both infections', () => {
  const h = headless();
  const sys = new InfectionSystem(h.ctx);
  const npc = inkFighter(h.ctx, h.physics, new Vector3(5, 0, 0), 'resident:7');
  h.combat.damagePlayer(1000, undefined, { inkMonster: true });
  h.run(1, (dt) => sys.update(dt));
  expect(h.ctx.state.inkAreas.size).toBe(0);
  npc.damage(1000);
  h.run(1, (dt) => sys.update(dt));
  expect(h.ctx.state.inkAreas.size).toBe(1);
  expect(npcBattles(h.ctx).enemies.size).toBe(1);
  expect(shared.uInkAreaCount.value).toBe(1);
  const saved = deserializeWorld(serializeWorld(h.ctx.state));
  expect(saved.infectedPeople).toEqual(h.ctx.state.infectedPeople);
  expect(saved.inkAreas).toEqual(h.ctx.state.inkAreas);
  expect(saved.infectedAt).toEqual(h.ctx.state.infectedAt);
  npc.dispose();
  sys.dispose();
  expect(shared.uInkAreaCount.value).toBe(0);
});
