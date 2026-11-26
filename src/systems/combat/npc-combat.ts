import { Vector3 } from 'three';
import { inInfectionArea } from '@/world/infection';
import type { GameContext } from '@/game/types';
import type { PhysicsWorld, Vec3Like } from '@/engine/physics/world';
import { walkNpc } from '@/systems/figures/npc-walking';

export interface NpcEnemy {
  readonly position: Vector3;
  readonly radius: number;
  readonly physics: PhysicsWorld;
  alive(): boolean;
  damage(amount: number, from: Vector3): void;
}

const worlds = new WeakMap<GameContext, NpcBattles>();
export function npcBattles(ctx: GameContext): NpcBattles {
  let battles = worlds.get(ctx);
  if (!battles) worlds.set(ctx, (battles = new NpcBattles()));
  return battles;
}

/** Scene-local combatants; unloaded actors must unregister to avoid invisible attacks. */
export class NpcBattles {
  readonly people = new Set<NpcFighter>();
  /** Census includes residents whose model is still loading or outside the draw budget. */
  readonly census = new Set<(physics: PhysicsWorld, x: number, z: number) => boolean>();
  readonly enemies = new Set<NpcEnemy>();
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();

  visible(physics: PhysicsWorld, from: Vector3, to: Vector3): boolean {
    this.origin.copy(from).y += 1;
    this.direction.copy(to).sub(from);
    const distance = this.direction.length();
    return distance < 0.01 || !physics.raycast(this.origin, this.direction.divideScalar(distance), distance);
  }

  victim(physics: PhysicsWorld, from: Vector3, range: number): NpcFighter | undefined {
    let result: NpcFighter | undefined,
      best = range * range;
    for (const person of this.people) {
      const d = person.position.distanceToSquared(from);
      if (
        person.physics === physics &&
        person.alive &&
        d < best &&
        Math.abs(person.position.y - from.y) < 1.8 &&
        this.visible(physics, from, person.position)
      ) {
        result = person;
        best = d;
      }
    }
    return result;
  }
}

export function inkFighter(ctx: GameContext, physics: PhysicsWorld, position: Vector3, person: string): NpcFighter {
  return new NpcFighter(npcBattles(ctx), physics, position, () => {
    if (ctx.arena?.inside) return;
    const {x,y,z} = position;
    ctx.apply({kind:'infectNpc', person, site:{scene:ctx.scenes.active.ref,x,y,z}});
  });
}

export function populationSurvey(ctx:GameContext, physics:PhysicsWorld,
  hasHealthy:(healthy:(id:string,p:{x:number;z:number})=>boolean)=>boolean):()=>void {
  const surveys = npcBattles(ctx).census;
  const check = (area:PhysicsWorld, x:number, z:number) => area === physics && hasHealthy(
    (id,p) => !ctx.state.infectedPeople.has(id) && inInfectionArea({x,z},p));
  surveys.add(check);
  return () => { surveys.delete(check); };
}

/** A defender can close the gap, but stays within sight of the spot where the fight started. */
export class NpcFighter {
  readonly eye = new Vector3();
  readonly maxHp = 60;
  hp = this.maxHp;
  target?: NpcEnemy;
  swing = -1;
  hurt = 0;
  down = 0;
  private cooldown = 0;
  private searchIn = 0;
  private quiet = 0;
  private disposed = false;
  private landed = false;
  private readonly guardSpot = new Vector3();
  approachHeading?: number;
  constructor(
    readonly battles: NpcBattles,
    readonly physics: PhysicsWorld,
    readonly position: Vector3,
    private readonly onDefeated?: () => void,
  ) {
    battles.people.add(this);
  }
  get alive(): boolean {
    return !this.disposed && this.hp > 0;
  }
  get busy(): boolean {
    return this.down > 0 || !!this.target;
  }
  damage(amount: number): void {
    if (!this.alive || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hurt = 0.3;
    this.quiet = 0;
    if (this.hp === 0) {
      this.onDefeated?.();
      this.down = 18;
      this.target = undefined;
      this.swing = -1;
    }
  }
  update(dt: number, ground = this.physics.ground, visitors: readonly Vec3Like[] = []): void {
    this.approachHeading = undefined;
    this.eye.copy(this.position).y += 1.35;
    this.cooldown -= dt;
    this.hurt = Math.max(0, this.hurt - dt);
    this.searchIn -= dt;
    if (this.target && !this.target.alive()) {
      this.target = undefined;
      this.swing = -1;
    }
    if (this.searchIn <= 0) {
      this.searchIn = 0.25;
      if (!this.target) this.guardSpot.copy(this.position);
      let best = 9 ** 2;
      this.target = undefined;
      for (const enemy of this.battles.enemies) {
        const d = enemy.position.distanceToSquared(this.position);
        if (
          enemy.physics === this.physics &&
          enemy.alive() &&
          d < best &&
          enemy.position.distanceToSquared(this.guardSpot) <= 9 ** 2 &&
          Math.abs(enemy.position.y - this.position.y) < 1.8 &&
          this.battles.visible(this.physics, this.position, enemy.position)
        ) {
          this.target = enemy;
          best = d;
        }
      }
    }
    if (this.down > 0) {
      // Stay down while danger remains; no immortal instant resurrection mid-fight.
      this.down = Math.max(0.01, this.down - dt);
      if (this.down <= 0.01 && !this.target) {
        this.down = 0;
        this.hp = this.maxHp / 2;
      }
      this.swing = -1;
      return;
    }
    if (!this.target) {
      this.swing = -1;
      this.quiet += dt;
      if (this.quiet > 8) this.hp = Math.min(this.maxHp, this.hp + dt * 6);
      return;
    }
    this.quiet = 0;
    if (this.swing >= 0) {
      this.swing += dt;
      if (!this.landed && this.swing >= 0.35) {
        this.landed = true;
        if (
          this.position.distanceTo(this.target.position) < 1.5 + this.target.radius &&
          this.battles.visible(this.physics, this.position, this.target.position)
        )
          this.target.damage(8, this.position);
      }
      if (this.swing >= 0.75) this.swing = -1;
    } else if (
      this.cooldown <= 0 &&
      this.position.distanceTo(this.target.position) < 1.5 + this.target.radius
    ) {
      this.swing = 0;
      this.landed = false;
      this.cooldown = 1.4;
    } else if (this.position.distanceTo(this.target.position) >= 1.5 + this.target.radius) {
      this.approachHeading = walkNpc(this, this.target.position, ground ?? (() => this.position.y), visitors, dt);
    }
  }
  dispose(): void {
    this.disposed = true;
    this.battles.people.delete(this);
  }
}
