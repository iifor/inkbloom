// Player health, death and respawn, plus the registry of things that can be shot. Weapons call
// shoot(); monster groups register a TargetSource; nothing else needs to know about either.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import type { CombatApi, GameContext, ShotResult, System, TargetSource } from '@/game/types';
import { afterArmor, stats } from '@/world/progression';

const C = TUNING.combat;
const DEATH_PAUSE = 1.2;

export class CombatSystem implements System, CombatApi {
  readonly id = 'combat';
  hp: number = C.playerHp;
  alive = true;
  private readonly sources = new Set<TargetSource>();
  private sinceHurt = Infinity;
  private grace = 0;
  private deadFor = 0;
  private readonly fellAt = new THREE.Vector3();
  shieldLeft = 0;
  private shieldT = 0;

  constructor(private readonly ctx: GameContext) {
    this.hp = this.maxHp;
  }

  /** Grows with level and the health attribute. */
  get maxHp(): number {
    return stats(this.ctx.state.growth).maxHp;
  }

  addTargets(source: TargetSource): () => void {
    this.sources.add(source);
    return () => this.sources.delete(source);
  }

  shoot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number): ShotResult {
    const wall = this.ctx.scenes.active.physics.raycast(origin, dir, range);
    const wallDist = wall?.dist ?? range;
    let best: ReturnType<TargetSource['raycast']> = null;
    for (const s of this.sources) {
      const hit = s.raycast(origin, dir, wallDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    if (best) {
      const killed = best.damage(damage, origin);
      this.ctx.events.emit('shot:hit', { killed });
      return { point: origin.clone().addScaledVector(dir, best.dist), hitTarget: true, killed };
    }
    return { point: origin.clone().addScaledVector(dir, wallDist), hitTarget: false, killed: false };
  }

  strike(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    range: number,
    halfAngle: number,
    damage: number,
  ): number {
    let n = 0;
    let killed = false;
    for (const s of this.sources)
      for (const hit of s.inArc(origin, dir, range, halfAngle)) {
        n++;
        if (hit.damage(damage, origin)) killed = true;
      }
    if (n) this.ctx.events.emit('shot:hit', { killed });
    return n;
  }

  blast(point: THREE.Vector3, radius: number, damage: number): number {
    let n = 0;
    let killed = false;
    for (const s of this.sources)
      for (const hit of s.inSphere(point, radius)) {
        n++;
        if (hit.damage(damage * (1 - 0.6 * Math.min(1, hit.dist / radius)), point)) killed = true;
      }
    if (n) this.ctx.events.emit('shot:hit', { killed });
    return n;
  }

  probe(point: THREE.Vector3, radius: number): boolean {
    for (const s of this.sources) if (s.inSphere(point, radius).length) return true;
    return false;
  }

  shield(amount: number, seconds: number): void {
    this.shieldLeft = Math.max(this.shieldLeft, amount);
    this.shieldT = seconds;
  }

  damagePlayer(amount: number): void {
    if (!this.alive || this.grace > 0 || this.ctx.player.flying) return;
    let dmg = afterArmor(amount, stats(this.ctx.state.growth));
    const absorbed = Math.min(this.shieldLeft, dmg);
    this.shieldLeft -= absorbed;
    dmg -= absorbed;
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHurt = 0;
    this.ctx.events.emit('player:hurt', { amount });
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    this.alive = false;
    this.deadFor = 0;
    const p = this.ctx.player.position;
    this.fellAt.copy(p);
    const before = this.ctx.state.inventory.ink;
    this.ctx.apply({ kind: 'death', scene: this.ctx.scenes.active.ref, x: p.x, y: p.y, z: p.z });
    const lost = before - this.ctx.state.inventory.ink;
    this.ctx.events.emit('player:died', { lostInk: lost });
    this.ctx.events.emit('toast', {
      text: lost > 0 ? `你被墨吞没了，掉了 ${lost} 墨，回到倒下的地方可以捡回来` : '你被墨吞没了',
      seconds: 5,
    });
  }

  private respawn(): void {
    const s = this.ctx.scenes.respawnPoint(this.fellAt);
    this.ctx.player.teleport(s.pos, s.yaw);
    this.hp = this.maxHp;
    this.alive = true;
    this.grace = C.respawnGrace;
    this.sinceHurt = Infinity;
  }

  update(dt: number): void {
    this.grace = Math.max(0, this.grace - dt);
    this.shieldT -= dt;
    if (this.shieldT <= 0) this.shieldLeft = 0;
    if (!this.alive) {
      this.deadFor += dt;
      if (this.deadFor >= DEATH_PAUSE) this.respawn();
      return;
    }
    this.sinceHurt += dt;
    if (this.sinceHurt >= C.regenDelay && this.hp < this.maxHp)
      this.hp = Math.min(this.maxHp, this.hp + C.regenPerSecond * dt);
  }
}
