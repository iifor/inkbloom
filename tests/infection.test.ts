import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { InfectionSystem } from '@/systems/combat/infection';
import { inkFighter, npcBattles } from '@/systems/combat/npc-combat';
import { shared } from '@/engine/render/ink-material';
import { deserializeWorld, serializeWorld } from '@/world/state';
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
