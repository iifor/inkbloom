// Player health, death and respawn, plus the registry of things that can be shot. Weapons call
// shoot(); monster groups register a TargetSource; nothing else needs to know about either.
import * as THREE from 'three';
import { ARENA } from '@/content/arena';
import { TUNING } from '@/content/tuning';
import type { CombatApi, GameContext, ShotResult, System, TargetSource } from '@/game/types';
import { afterArmor, stats } from '@/world/progression';

const C = TUNING.combat;
const F = C.feel;
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
  /** In the arena: health is the server's (see serverHealth). */
  private byServer = false;

  constructor(private readonly ctx: GameContext) {
    this.hp = this.maxHp;
  }

  /** Grows with level and the health attribute; in the arena everyone has the same. */
  get maxHp(): number {
    return this.byServer ? ARENA.hp : stats(this.ctx.state.growth).maxHp;
  }

  serverHealth(on: boolean): void {
    if (on === this.byServer) return;
    this.byServer = on;
    // in or out, full health and on their feet
    this.hp = this.maxHp;
    this.alive = true;
    this.shieldLeft = 0;
    this.sinceHurt = Infinity;
  }

  hit(amount: number, hp: number, from: THREE.Vector3 | null): void {
    if (!this.byServer) return;
    const before = this.hp;
    this.hp = hp;
    this.sinceHurt = 0;
    // the feel of being hit: the server's numbers, this game's flinch
    this.ctx.events.emit('player:hurt', {
      amount: Math.max(0, before - hp),
      absorbed: Math.max(0, amount - (before - hp)),
      from: from ? { x: from.x, y: from.y, z: from.z } : null,
      melee: false,
    });
  }

  fall(): void {
    if (!this.byServer || !this.alive) return;
    this.alive = false;
    this.hp = 0;
    // nothing is lost in the arena
    this.ctx.events.emit('player:died', { lostInk: 0 });
  }

  rise(pos: THREE.Vector3, yaw: number): void {
    if (!this.byServer) return;
    this.ctx.player.teleport(pos, yaw);
    this.hp = this.maxHp;
    this.alive = true;
    this.grace = ARENA.grace;
    this.sinceHurt = Infinity;
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
      this.ctx.events.emit('shot:hit', { killed, heavy: false });
      return {
        point: origin.clone().addScaledVector(dir, best.dist),
        hitTarget: true,
        hitWorld: false,
        killed,
      };
    }
    return {
      point: origin.clone().addScaledVector(dir, wallDist),
      hitTarget: false,
      hitWorld: wall !== null,
      killed: false,
    };
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
        if (hit.damage(damage, origin, { knock: F.knockMelee, heavy: true })) killed = true;
      }
    if (n) this.ctx.events.emit('shot:hit', { killed, heavy: true });
    return n;
  }

  blast(point: THREE.Vector3, radius: number, damage: number, knock = 0): number {
    let n = 0;
    let killed = false;
    let direct = false;
    for (const s of this.sources)
      for (const hit of s.inSphere(point, radius)) {
        n++;
        const near = 1 - Math.min(1, hit.dist / radius);
        // a shell bursting on (or right by) a target is a direct hit
        const heavy = knock > 0 && hit.dist < 1;
        direct ||= heavy;
        if (hit.damage(damage * (0.4 + 0.6 * near), point, { knock: knock * near, heavy })) killed = true;
      }
    if (n) this.ctx.events.emit('shot:hit', { killed, heavy: direct });
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

  damagePlayer(
    amount: number,
    from?: THREE.Vector3,
    opts: { readonly melee?: boolean; readonly fall?: boolean } = {},
  ): void {
    // in the arena only the server hurts the player
    if (!this.alive || this.grace > 0 || this.byServer) return;
    const melee = opts.melee === true;
    if (melee && from) {
      // a blow shoves the player away from it and checks their stride for a moment
      const p = this.ctx.player.position;
      const away = new THREE.Vector3(p.x - from.x, 0, p.z - from.z);
      if (away.lengthSq() < 1e-6) away.copy(this.ctx.player.forward).negate().setY(0);
      this.ctx.player.knock(away.normalize(), F.knockPlayer);
      this.ctx.player.slow(F.slowFactor, F.slowSeconds);
    }
    let dmg = afterArmor(amount, stats(this.ctx.state.growth));
    const absorbed = Math.min(this.shieldLeft, dmg);
    this.shieldLeft -= absorbed;
    dmg -= absorbed;
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHurt = 0;
    this.ctx.events.emit('player:hurt', {
      amount: dmg,
      absorbed,
      from: from ? { x: from.x, y: from.y, z: from.z } : null,
      melee,
      fall: opts.fall,
    });
    if (this.hp <= 0) this.die(opts.fall);
  }

  private die(fall = false): void {
    this.alive = false;
    this.deadFor = 0;
    const p = this.ctx.player.position;
    this.fellAt.copy(p);
    const before = this.ctx.state.inventory.ink;
    this.ctx.apply({ kind: 'death', scene: this.ctx.scenes.active.ref, x: p.x, y: p.y, z: p.z });
    const lost = before - this.ctx.state.inventory.ink;
    this.ctx.events.emit('player:died', { lostInk: lost });
    const cause = fall ? '摔倒了' : '被墨吞没了';
    this.ctx.events.emit('toast', {
      // the objective then points back to the dropped ink
      text: lost > 0 ? `${cause}，掉了 ${lost} 墨` : cause,
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
      // in the arena the server says when to get up (rise)
      this.deadFor += dt;
      if (this.deadFor >= DEATH_PAUSE && !this.byServer) this.respawn();
      return;
    }
    this.sinceHurt += dt;
    if (this.byServer) return;
    if (this.sinceHurt >= C.regenDelay && this.hp < this.maxHp)
      this.hp = Math.min(this.maxHp, this.hp + C.regenPerSecond * dt);
  }
}
