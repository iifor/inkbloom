import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ENEMIES, type EnemyDef, enemyIndex } from '@/content/enemies';
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
    for (const e of ENEMIES as readonly EnemyDef[]) {
      const hits = Math.ceil(e.hp / (w.damage * power));
      expect(hits, `${w.key} vs ${e.key}`).toBeGreaterThanOrEqual(1);
      // an elite is a fight, not a wall: a dozen rifle hits at most
      expect(hits, `${w.key} vs ${e.key}`).toBeLessThanOrEqual(e.elite ? 15 : 5);
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

describe('hit feel', () => {
  const FEEL = TUNING.combat.feel;
  /** The group's private monster list, to catch one mid wind-up. */
  type Inner = {
    act: { kind: string; done: boolean; t: number; dx?: number; dz?: number } | null;
    stunT: number;
    hp: number;
    body: { pos: THREE.Vector3 };
  };
  const inner = (group: MonsterGroup): Inner => (group as unknown as { monsters: Inner[] }).monsters[0]!;

  /** A blot right in front of the player, run until it starts winding up a bite. */
  function windingBlot(): { h: Headless; group: MonsterGroup; m: Inner } {
    const { h, group } = arena();
    h.place(0, 0, 0);
    group.spawn(BLOT, new THREE.Vector3(0, 0, -1.4), { tag: 'test' });
    const m = inner(group);
    for (let i = 0; i < 120 && !m.act; i++) step(h, group)(1 / 60);
    expect(m.act?.kind).toBe('melee');
    return { h, group, m };
  }

  it('a heavy hit during the wind-up breaks the attack: bonus damage, no bite while it reels', () => {
    const { h, group, m } = windingBlot();
    h.combat.strike(h.ctx.player.eye, h.ctx.player.forward, 3, 1, FEEL.interruptMin);
    expect(m.act).toBeNull();
    expect(h.count('monster:interrupted')).toBe(1);
    expect(m.hp).toBeCloseTo(BLOT_DEF.hp - FEEL.interruptMin * FEEL.interruptBonus);
    h.run(FEEL.interruptStun - 0.05, step(h, group), 1 / 60);
    expect(h.count('monster:bite')).toBe(0);
  });

  it('a rifle-sized hit does not break the wind-up', () => {
    const { h, group, m } = windingBlot();
    h.combat.shoot(h.ctx.player.eye, h.ctx.player.forward, 10, FEEL.interruptMin - 10);
    expect(m.act).not.toBeNull();
    expect(h.count('monster:interrupted')).toBe(0);
    h.run(0.5, step(h, group), 1 / 60);
    expect(h.count('monster:bite')).toBe(1);
  });

  it('a 墨巨 shrugs off a blade-sized hit; only a heavy one breaks its slam', () => {
    const winding = () => {
      const { h, group } = arena();
      h.place(0, 0, 0);
      group.spawn(enemyIndex('giant'), new THREE.Vector3(0, 0, -2.2), { tag: 'test' });
      const m = inner(group);
      for (let i = 0; i < 180 && !m.act; i++) step(h, group)(1 / 60);
      expect(m.act?.kind).toBe('melee');
      return { h, m };
    };
    const poise = (ENEMIES[enemyIndex('giant')] as EnemyDef).poise!;
    expect(poise).toBeGreaterThan(FEEL.interruptMin);
    const light = winding();
    light.h.combat.strike(light.h.ctx.player.eye, light.h.ctx.player.forward, 3, 1, FEEL.interruptMin);
    expect(light.m.act).not.toBeNull();
    expect(light.h.count('monster:interrupted')).toBe(0);
    const heavy = winding();
    heavy.h.combat.strike(heavy.h.ctx.player.eye, heavy.h.ctx.player.forward, 3, 1, poise);
    expect(heavy.m.act).toBeNull();
    expect(heavy.h.count('monster:interrupted')).toBe(1);
  });

  it('a 墨鼬 crouches, then springs through where the player stood: stepping aside dodges it', () => {
    const lunge = (dodge: boolean): number => {
      const { h, group } = arena();
      h.place(0, 0, 0);
      group.spawn(enemyIndex('weasel'), new THREE.Vector3(0, 0, -5), { tag: 'test' });
      const m = inner(group);
      for (let i = 0; i < 240 && !m.act; i++) step(h, group)(1 / 60);
      expect(m.act?.kind).toBe('lunge');
      // crouched with its aim set, not sprung yet
      while (m.act!.t < 0.3) step(h, group)(1 / 60);
      expect(h.count('monster:bite')).toBe(0);
      // a sidestep across its line
      const { dx = 0, dz = 0 } = m.act!;
      if (dodge) h.place(-dz * 3, 0, dx * 3);
      h.run(1, step(h, group), 1 / 60);
      return h.count('monster:bite');
    };
    // its strafe side and first spring time are random; fix them so the run is the same each time
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const stood = lunge(false);
    const dodged = lunge(true);
    random.mockRestore();
    expect(stood).toBe(1);
    expect(dodged).toBe(0);
  });

  it('a blade hit shoves the monster back; a shot does not', () => {
    // the blot's bite timer starts at a random point; one ready to bite would shove the player
    // out of reach first, so start it mid-cooldown
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const shoved = (hit: (h: Headless) => void): number => {
      const { h, group } = arena();
      h.place(0, 0, 0);
      // a blot closes in on its own (towards +z); a shove sends it back the other way
      group.spawn(BLOT, new THREE.Vector3(0, 0, -2.5), { tag: 'test' });
      h.run(0.2, step(h, group), 1 / 60);
      const before = group.living()[0]!.z;
      hit(h);
      h.run(0.25, step(h, group), 1 / 60);
      return before - group.living()[0]!.z;
    };
    const blade = shoved((h) => h.combat.strike(h.ctx.player.eye, h.ctx.player.forward, 3, 1, 5));
    const shot = shoved((h) => h.combat.shoot(h.ctx.player.eye, h.ctx.player.forward, 10, 5));
    random.mockRestore();
    expect(blade).toBeGreaterThan(0.3);
    expect(shot).toBeLessThan(0);
  });

  it("a shell's blast shoves; the staff's lingering field does not", () => {
    const moved = (knock: number): number => {
      const { h, group } = arena();
      h.place(0, 0, 20);
      group.spawn(BLOT, new THREE.Vector3(0, 0, 0), { tag: 'test' });
      h.combat.blast(new THREE.Vector3(0.5, 0.6, 0), 4, 5, knock);
      h.run(0.25, (dt) => group.update(dt), 1 / 60);
      return Math.abs(group.living()[0]!.x);
    };
    expect(moved(FEEL.knockBlast)).toBeGreaterThan(0.5);
    expect(moved(0)).toBeLessThan(0.1);
  });

  it("a blot's bite shoves and slows the player; a spit from range does neither", () => {
    const { h, group } = arena();
    h.place(0, 0, 0);
    group.spawn(BLOT, new THREE.Vector3(0, 0, -1.4), { tag: 'test' });
    h.run(3, step(h, group), 1 / 60);
    const bites = h.log.filter((e) => e.type === 'player:hurt').map((e) => e.payload as { melee: boolean });
    expect(bites.length).toBeGreaterThan(0);
    expect(bites.every((b) => b.melee)).toBe(true);
    expect(h.slowed[0]).toBe(FEEL.slowFactor);
    // the stub moves at once when shoved: pushed away from the blot (towards +z)
    expect(h.ctx.player.position.z).toBeGreaterThan(0.3);

    const ranged = arena();
    ranged.h.place(0, 0, 0);
    ranged.group.spawn(SPITTER, new THREE.Vector3(0, 0, -20), { tag: 'test' });
    ranged.h.run(10, step(ranged.h, ranged.group));
    expect(ranged.h.count('player:hurt')).toBeGreaterThan(0);
    expect(ranged.h.slowed).toHaveLength(0);
  });
});
