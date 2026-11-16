import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMIES, enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import { WEAPONS } from '@/content/weapons';
import { MonsterGroup } from '@/systems/combat/monsters';
import { createGrowth, stats } from '@/world/progression';
import { headless, type Headless } from './support/headless';

const BLOT = enemyIndex('blot');
const SPITTER = enemyIndex('spitter');
const BLOT_DEF = ENEMIES[BLOT]!;
const SPIT_ATTACK = ENEMIES[SPITTER]!.attack;

/** A flat 200 m floor with one monster group on it. */
function arena(): { h: Headless; group: MonsterGroup } {
  const h = headless();
  h.physics.addBox('floor', { x: -100, y: -1, z: -100 }, { x: 100, y: 0, z: 100 });
  const group = new MonsterGroup(h.ctx, h.physics, new THREE.Group(), new THREE.MeshBasicMaterial());
  return { h, group };
}

const step = (h: Headless, group: MonsterGroup) => (dt: number) => {
  h.combat.update(dt);
  group.update(dt);
};

describe('monsters', () => {
  it('a blot that sees the player runs over and bites', () => {
    const { h, group } = arena();
    h.place(0, 0, 0);
    group.spawn(BLOT, new THREE.Vector3(0, 0, -12), { tag: 'test' });
    h.run(6, step(h, group));
    expect(h.count('monster:bite')).toBeGreaterThan(0);
    expect(h.combat.hp).toBeLessThan(h.combat.maxHp);
    const [pos] = group.living();
    expect(pos!.distanceTo(h.ctx.player.position)).toBeLessThan(BLOT_DEF.attack.range * 1.5);
  });

  it('ignores a player beyond its aggro range and stays near its post', () => {
    const { h, group } = arena();
    h.place(0, 0, 0);
    const home = new THREE.Vector3(0, 0, -(BLOT_DEF.aggro + 10));
    group.spawn(BLOT, home, { tag: 'test' });
    h.run(8, step(h, group));
    expect(h.count('player:hurt')).toBe(0);
    expect(group.living()[0]!.distanceTo(home)).toBeLessThan(3);
  });

  it('a spitter keeps its distance and spits from range', () => {
    const { h, group } = arena();
    h.place(0, 0, 0);
    group.spawn(SPITTER, new THREE.Vector3(0, 0, -20), { tag: 'test' });
    h.run(10, step(h, group));
    expect(h.count('monster:spit')).toBeGreaterThan(0);
    expect(h.count('player:hurt')).toBeGreaterThan(0);
    if (SPIT_ATTACK.kind !== 'spit') throw new Error('spitter should spit');
    const [near, far] = SPIT_ATTACK.keepAway;
    const d = group.living()[0]!.distanceTo(h.ctx.player.position);
    expect(d).toBeGreaterThan(near - 2);
    expect(d).toBeLessThan(far + 2);
  });

  it('jumps onto a ledge it can clear to reach the player', () => {
    const { h, group } = arena();
    const ledge = TUNING.combat.monsterJump - 0.3;
    h.physics.addBox('ledge', { x: -10, y: 0, z: -4 }, { x: 10, y: ledge, z: 4 });
    h.place(0, ledge, 0);
    group.spawn(BLOT, new THREE.Vector3(0, 0, -12), { tag: 'test' });
    h.run(8, step(h, group));
    expect(group.living()[0]!.y).toBeGreaterThan(ledge - 0.1);
    expect(h.count('monster:bite')).toBeGreaterThan(0);
  });

  it('clears a tagged set without rewards', () => {
    const { h, group } = arena();
    let defeated = 0;
    group.spawn(BLOT, new THREE.Vector3(5, 0, 0), { tag: 'tide', onDefeat: () => defeated++ });
    group.spawn(BLOT, new THREE.Vector3(-5, 0, 0), { tag: 'post' });
    group.clear('tide');
    expect(group.living('tide')).toHaveLength(0);
    expect(group.living()).toHaveLength(1);
    expect(defeated).toBe(0);
    expect(h.count('monster:died')).toBe(0);
  });
});

describe('combat', () => {
  const ahead = new THREE.Vector3(0, 0, -1);

  it('a shot kills after enough hits and reports the defeat once', () => {
    const { h, group } = arena();
    let defeated = 0;
    group.spawn(BLOT, new THREE.Vector3(0, 0, -10), { tag: 't', onDefeat: () => defeated++ });
    const eye = new THREE.Vector3(0, 1, 0);
    const shots = Math.ceil(BLOT_DEF.hp / 20);
    for (let i = 0; i < shots - 1; i++) expect(h.combat.shoot(eye, ahead, 50, 20).killed).toBe(false);
    expect(h.combat.shoot(eye, ahead, 50, 20).killed).toBe(true);
    expect(h.combat.shoot(eye, ahead, 50, 20).hitTarget).toBe(false);
    expect(defeated).toBe(1);
    expect(h.count('monster:died')).toBe(1);
  });

  it('a wall in front stops the shot', () => {
    const { h, group } = arena();
    h.physics.addBox('wall', { x: -3, y: 0, z: -6 }, { x: 3, y: 4, z: -5 });
    group.spawn(BLOT, new THREE.Vector3(0, 0, -10), { tag: 't' });
    const r = h.combat.shoot(new THREE.Vector3(0, 1, 0), ahead, 50, 999);
    expect(r.hitTarget).toBe(false);
    expect(r.hitWorld).toBe(true);
    expect(r.point.z).toBeCloseTo(-5);
  });

  it('a swing hits what is in front, not behind', () => {
    const { h, group } = arena();
    group.spawn(BLOT, new THREE.Vector3(0, 0, -1.5), { tag: 'front' });
    group.spawn(BLOT, new THREE.Vector3(0, 0, 2.5), { tag: 'behind' });
    expect(h.combat.strike(new THREE.Vector3(0, 1, 0), ahead, 2.5, 0.6, 1)).toBe(1);
  });

  it('a blast hurts the near target more than the far one', () => {
    const { h, group } = arena();
    group.spawn(BLOT, new THREE.Vector3(0.5, 0, 0), { tag: 'near' });
    group.spawn(BLOT, new THREE.Vector3(3.5, 0, 0), { tag: 'far' });
    const amounts: number[] = [];
    h.ctx.events.on('monster:hit', (e) => amounts.push(e.amount));
    expect(h.combat.blast(new THREE.Vector3(0, 0.8, 0), 4, 40)).toBe(2);
    expect(amounts).toHaveLength(2);
    expect(amounts[0]!).toBeGreaterThan(amounts[1]!);
  });

  it('dies at zero health, then respawns at full health after a pause', () => {
    const { h } = arena();
    h.ctx.state.inventory.ink = 40;
    h.combat.damagePlayer(10_000, new THREE.Vector3());
    expect(h.combat.alive).toBe(false);
    expect(h.count('player:died')).toBe(1);
    expect(h.ctx.state.inventory.ink).toBeLessThan(40);
    h.run(2, (dt) => h.combat.update(dt));
    expect(h.combat.alive).toBe(true);
    expect(h.combat.hp).toBe(h.combat.maxHp);
  });
});

describe('weapon balance at level 1', () => {
  // weapons.ts scales damage by 武器强度 / 100; a fresh character is the baseline
  const power = stats(createGrowth()).weapon / 100;

  it.each(WEAPONS.map((w) => [w.key, w] as const))('%s kills each enemy in a sane number of hits', (_, w) => {
    for (const e of ENEMIES) {
      const hits = Math.ceil(e.hp / (w.damage * power));
      expect(hits, `${w.key} vs ${e.key}`).toBeGreaterThanOrEqual(1);
      expect(hits, `${w.key} vs ${e.key}`).toBeLessThanOrEqual(5);
    }
  });

  it('the starting rifle downs a blot before the blot downs the player', () => {
    const rifle = WEAPONS.find((w) => w.unlock.kind === 'start')!;
    const blot = BLOT_DEF;
    const toKill = Math.ceil(blot.hp / (rifle.damage * power)) * rifle.interval;
    const toDie = Math.ceil(TUNING.combat.playerHp / blot.attack.damage) * blot.attack.cooldown;
    expect(toKill).toBeLessThan(toDie);
  });
});
