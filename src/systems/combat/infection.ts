import * as THREE from 'three';
import { ENEMIES } from '@/content/enemies';
import { makeInkMaterial, shared } from '@/engine/render/ink-material';
import type { GameContext, GameScene, System } from '@/game/types';
import { areaKey, inInfectionArea, type InkSite } from '@/world/infection';
import { MonsterFigures } from './monster-figure';
import { MonsterGroup } from './monsters';
import { npcBattles, type NpcEnemy } from './npc-combat';

export class InfectionSystem implements System {
  readonly id = 'infection';
  private scene?: GameScene;
  private readonly root = new THREE.Group();
  private readonly material = makeInkMaterial();
  private group?: MonsterGroup;
  private avatar?: MonsterFigures;
  private foe?: NpcEnemy;
  private readonly spawned = new Set<string>();
  private readonly pending = new Map<string, { person: string; site: InkSite; at: number }>();
  private swing = 0;
  private walk = 0;
  private refresh = 0;
  private readonly release: () => void;

  constructor(private readonly ctx: GameContext) {
    this.release = ctx.events.on('patch:applied', ({ patch, remote }) => {
      if (patch.kind === 'defeatInfected') {
        this.group?.dismiss(patch.person);
        this.spawned.delete(patch.person);
        this.refresh = 0;
      }
      if (remote) return;
      const person = patch.kind === 'infectNpc' ? patch.person : 'player';
      const site =
        patch.kind === 'infectNpc'
          ? patch.site
          : patch.kind === 'death' && patch.inkMonster
            ? ctx.state.infectedAt
            : null;
      if (site) this.pending.set(areaKey(site), { person, site, at: ctx.state.clock + 0.55 });
      if (site || patch.kind === 'overrun') this.refresh = 0;
    });
  }

  private checkPopulation(): void {
    const { state, player, scenes } = this.ctx;
    const scene = scenes.active,
      battles = npcBattles(this.ctx);
    for (const [key, event] of this.pending) {
      if (event.at > state.clock) continue;
      this.pending.delete(key);
      const { site, person } = event;
      if (state.inkAreas.has(key) || state.infectedPeople.get(person)?.defeated) continue;
      if (!state.infectedAt && inInfectionArea(site, player.position)) continue;
      if (
        Array.from(battles.people).some(
          (p) => p.alive && p.physics === scene.physics && inInfectionArea(site, p.position),
        )
      )
        continue;
      if (Array.from(battles.census).some((hasHealthy) => hasHealthy(scene.physics, site.x, site.z)))
        continue;
      if (this.ctx.apply({ kind: 'overrun', person, site }).ok && !this.ctx.net)
        this.ctx.events.emit('toast', { text: '这一带的人都被感染了，土地正在褪色', seconds: 5 });
    }
  }

  private syncScene(): void {
    const { state, player, scenes } = this.ctx;
    const scene = scenes.active;
    const near = (p: InkSite) => Math.hypot(p.x - player.position.x, p.z - player.position.z) < 105;
    const present = new Set<string>();
    if (!this.ctx.arena?.inside)
      for (const [id, site] of state.infectedPeople) {
        if (site.defeated || !near(site)) continue;
        present.add(id);
        if (this.group?.has(id)) continue;
        this.group ??= new MonsterGroup(this.ctx, scene.physics, this.root, this.material);
        this.group.spawn(0, new THREE.Vector3(site.x, site.y, site.z), {
          tag: 'infected',
          key: id,
          onDefeat: () => this.ctx.apply({ kind: 'defeatInfected', person: id }),
        });
        this.spawned.add(id);
      }
    for (const id of this.spawned)
      if (!present.has(id)) {
        this.group?.dismiss(id);
        this.spawned.delete(id);
      }
    const nearest = [...state.inkAreas.values()]
      .sort(
        (a, b) =>
          Math.hypot(a.x - player.position.x, a.z - player.position.z) -
          Math.hypot(b.x - player.position.x, b.z - player.position.z),
      )
      .slice(0, shared.uInkAreas.value.length);
    shared.uInkAreaCount.value = this.ctx.arena?.inside ? 0 : nearest.length;
    nearest.forEach((p, i) => shared.uInkAreas.value[i]!.set(p.x, p.z));
  }

  private reset(): void {
    if (this.foe) npcBattles(this.ctx).enemies.delete(this.foe);
    this.foe = undefined;
    this.avatar?.dispose();
    this.avatar = undefined;
    this.group?.dispose();
    this.group = undefined;
    this.spawned.clear();
    shared.uInkAreaCount.value = 0;
  }

  update(dt: number): void {
    const { player, combat, scenes, state } = this.ctx,
      scene = scenes.active;
    if (scene !== this.scene) {
      // Crossing a town edge shares the same physics world. Preserve HP and attacks,
      // and keep the figures under a system-owned root even if a town is unloaded.
      if (scene.physics !== this.scene?.physics) this.reset();
      (this.ctx.renderer?.scene ?? scene.root).add(this.root);
      this.scene = scene;
      this.refresh = 0;
    }
    this.checkPopulation();
    this.refresh -= dt;
    if (this.refresh <= 0) {
      this.refresh = 0.45;
      this.syncScene();
    }
    if (!this.ctx.arena?.inside) this.group?.update(dt);
    this.avatar?.begin();
    if (combat.infected && combat.alive) {
      const battles = npcBattles(this.ctx);
      if (!this.foe) {
        this.foe = {
          position: player.position,
          radius: 0.45,
          physics: scene.physics,
          alive: () => !!combat.infected && combat.alive,
          damage: (amount, from) => combat.damagePlayer(amount, from, { melee: true }),
        };
        battles.enemies.add(this.foe);
      }
      this.swing = Math.max(0, this.swing - dt);
      if (this.swing === 0 && this.ctx.input.held('use')) {
        this.swing = 0.85;
        let best = 2.2,
          victim;
        for (const p of battles.people) {
          if (!p.alive || p.physics !== scene.physics) continue;
          const dx = p.position.x - player.position.x,
            dz = p.position.z - player.position.z;
          const d = player.position.distanceTo(p.position);
          if (
            d < best &&
            dx * player.forward.x + dz * player.forward.z >= 0 &&
            battles.visible(scene.physics, player.position, p.position)
          ) {
            best = d;
            victim = p;
          }
        }
        victim?.damage(ENEMIES[0].attack.damage);
      }
      if (!this.avatar) {
        this.avatar = new MonsterFigures(this.root, this.material);
        this.avatar.begin();
      }
      this.walk += player.speed * dt * 2.5;
      const { x, y, z } = player.position;
      this.avatar.draw(ENEMIES[0], {
        x,
        y,
        z,
        yaw: player.yaw,
        walk: this.walk,
        stride: Math.min(1, player.speed / 3),
        t: state.clock,
        air: !player.grounded,
        attack: this.swing > 0.35 ? (0.85 - this.swing) * 2 : -1,
        hurt: 0,
        dying: -1,
        colors: [ENEMIES[0].eyes],
      });
    } else if (this.foe) {
      npcBattles(this.ctx).enemies.delete(this.foe);
      this.foe = undefined;
    }
    this.avatar?.end();
  }
  dispose(): void {
    this.release();
    this.reset();
    this.root.removeFromParent();
    this.material.dispose();
  }
}
