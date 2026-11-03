// A group of ink monsters living in one scene. Spawned from ENEMIES data, moved with the same
// AABB physics as the player, registered with ctx.combat so weapons can hit them.
//
// AI: notice the player within `aggro` metres with line of sight. With the player in sight,
// blots run straight at them and bite, spitters keep their distance and spit. Out of sight,
// a monster follows an A* path over the scene's NavGrid (re-planned every ~1 s, a few plans
// per frame at most). A monster dragged too far from its post gives up and paths home.
// Without a NavGrid it falls back to sidestepping along walls. A monster that runs into a ledge
// no higher than `combat.monsterJump`, with room on top, jumps up onto it.
import * as THREE from 'three';
import { ENEMIES, type EnemyDef } from '@/content/enemies';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { type Body, type PhysicsWorld, makeBody } from '@/engine/physics/world';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext, TargetHit, TargetSource } from '@/game/types';
import { findPath, type NavGrid, type Waypoint } from '@/world/nav/path';
import { FigureRenderer } from './monster-figure';

const GRAVITY = 22;
const ACCEL = 18;
const SPIT_GRAVITY = 6;
const SPIT_LIFE = 3;
/** Path plans allowed per frame across the whole group. */
const PLANS_PER_FRAME = 3;
/** Line-of-sight checks are refreshed this often (seconds). */
const SIGHT_INTERVAL = 0.25;

/** Seconds of a melee swing; the blow lands at `MELEE_LANDS` of it. */
const MELEE_TIME = 0.5;
const MELEE_LANDS = 0.55;
/** Seconds of a spit; the ink leaves at `SPIT_LEAVES` of it. */
const SPIT_TIME = 0.6;
const SPIT_LEAVES = 0.45;
/** Seconds a defeated monster takes to melt into a puddle. */
const MELT_TIME = 0.6;
/** Extra height cleared on a jump, so the body's feet pass over the lip. */
const JUMP_MARGIN = 0.35;
/** How far ahead of its body a monster looks for a ledge. */
const LEDGE_PROBE = 0.35;

/** Ids are unique across every group, so overlays can track one monster. */
let nextId = 1;

interface Monster {
  readonly id: number;
  readonly def: EnemyDef;
  readonly body: Body;
  readonly home: THREE.Vector3;
  /** Stolen colours it wears (palette indices). */
  readonly colors: readonly number[];
  yaw: number;
  /** Walk cycle phase. */
  walk: number;
  /** An attack under way: its kind, progress 0..1, and whether it has landed / fired. */
  act: { kind: 'melee' | 'spit'; t: number; done: boolean } | null;
  /** -1 while alive; 0..1 while melting after defeat. */
  melt: number;
  readonly tag: string;
  readonly onDefeat: (() => void) | undefined;
  hp: number;
  aggro: boolean;
  attackT: number;
  sidestepT: number;
  sidestepDir: number;
  strafe: number;
  hurtT: number;
  dead: boolean;
  canSee: boolean;
  seeT: number;
  path: Waypoint[] | null;
  repathT: number;
  jumpT: number;
}

interface Spit {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly damage: number;
  readonly mesh: THREE.Mesh;
  life: number;
}

let spitGeometry: THREE.BufferGeometry | null = null;
function spitGeo(): THREE.BufferGeometry {
  if (!spitGeometry) {
    const b = new GeometryBuilder();
    b.mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.Matrix4(), ENEMIES[0]!.body, ALWAYS_COLOR);
    spitGeometry = b.build();
  }
  return spitGeometry;
}

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

export interface SpawnOptions {
  /** Group label so a set (e.g. a tide's monsters) can be cleared together. */
  readonly tag: string;
  readonly onDefeat?: () => void;
  /** The colours it stole from where it lives; see world/paint/stolen.ts. */
  readonly colors?: readonly number[];
}

export class MonsterGroup implements TargetSource {
  private readonly monsters: Monster[] = [];
  private readonly spits: Spit[] = [];
  private readonly release: () => void;
  private plans = 0;
  private readonly figures: FigureRenderer;
  /** Walkability of the scene; null falls back to sidestepping along walls. */
  nav: NavGrid | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly physics: PhysicsWorld,
    private readonly root: THREE.Object3D,
    private readonly material: THREE.Material,
  ) {
    this.release = ctx.combat.addTargets(this);
    this.figures = new FigureRenderer(root, material);
  }

  spawn(type: number, pos: THREE.Vector3, opts: SpawnOptions): void {
    const def = ENEMIES[type]!;
    this.monsters.push({
      id: nextId++,
      def,
      body: makeBody(pos, def.halfWidth, def.height, 0.55),
      home: pos.clone(),
      colors: opts.colors?.length ? opts.colors : [color('red')],
      yaw: Math.random() * Math.PI * 2,
      walk: Math.random() * Math.PI * 2,
      act: null,
      melt: -1,
      tag: opts.tag,
      onDefeat: opts.onDefeat,
      hp: def.hp,
      aggro: false,
      attackT: Math.random() * def.attack.cooldown,
      sidestepT: 0,
      sidestepDir: 1,
      jumpT: 0,
      strafe: Math.random() < 0.5 ? 1 : -1,
      hurtT: 0,
      dead: false,
      canSee: false,
      seeT: Math.random() * SIGHT_INTERVAL,
      path: null,
      repathT: 0,
    });
  }

  /** Living monsters, for objectives and the HUD. */
  living(tag?: string): THREE.Vector3[] {
    return this.monsters.filter((m) => !m.dead && (!tag || m.tag === tag)).map((m) => m.body.pos);
  }

  /** Remove every monster with this tag (no rewards): a tide's monsters dissolve with it. */
  clear(tag: string): void {
    for (const m of this.monsters) if (m.tag === tag && !m.dead) this.remove(m);
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): TargetHit | null {
    let best: Monster | null = null;
    let bestT = max;
    for (const m of this.monsters) {
      if (m.dead) continue;
      const p = m.body.pos;
      const w = m.def.halfWidth;
      const t = slab(o, d, p.x - w, p.y, p.z - w, p.x + w, p.y + m.def.height, p.z + w);
      if (t !== null && t < bestT) {
        bestT = t;
        best = m;
      }
    }
    return best ? this.hitOn(best, bestT) : null;
  }

  /** A hit on one monster that damages it through the same path as a shot. */
  private hitOn(m: Monster, dist: number): TargetHit {
    return {
      dist,
      damage: (amount) => {
        if (m.dead) return false;
        const dealt = Math.min(amount, m.hp);
        m.hp -= amount;
        m.aggro = true;
        m.hurtT = 0.12;
        const at = { x: m.body.pos.x, y: m.body.pos.y + m.def.height * 0.5, z: m.body.pos.z };
        if (m.hp > 0) {
          this.ctx.events.emit('monster:hit', {
            at,
            id: m.id,
            amount: dealt,
            hp: m.hp / m.def.hp,
            anchor: m.body.pos,
            height: m.def.height,
          });
          return false;
        }
        this.remove(m);
        this.ctx.events.emit('monster:died', { at, id: m.id, amount: dealt, colors: m.colors });
        m.onDefeat?.();
        return true;
      },
    };
  }

  inArc(o: THREE.Vector3, d: THREE.Vector3, range: number, halfAngle: number): TargetHit[] {
    const out: TargetHit[] = [];
    const cos = Math.cos(halfAngle);
    for (const m of this.monsters) {
      if (m.dead) continue;
      const c = m.body.pos;
      _to.set(c.x - o.x, c.y + m.def.height * 0.5 - o.y, c.z - o.z);
      const dist = Math.max(0, _to.length() - m.def.halfWidth);
      if (dist > range) continue;
      if (_to.normalize().dot(d) < cos && dist > 0.6) continue;
      out.push(this.hitOn(m, dist));
    }
    return out;
  }

  inSphere(p: THREE.Vector3, radius: number): TargetHit[] {
    const out: TargetHit[] = [];
    for (const m of this.monsters) {
      if (m.dead) continue;
      const c = m.body.pos;
      const dist = Math.max(
        0,
        Math.hypot(c.x - p.x, c.y + m.def.height * 0.5 - p.y, c.z - p.z) - m.def.halfWidth,
      );
      if (dist <= radius) out.push(this.hitOn(m, dist));
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  private remove(m: Monster): void {
    m.dead = true;
    // it stays drawn while it melts away
    m.melt = 0;
    m.act = null;
  }

  private sees(m: Monster): boolean {
    const p = m.body.pos;
    _eye.set(p.x, p.y + m.def.height * 0.8, p.z);
    _to.subVectors(this.ctx.player.eye, _eye);
    const dist = _to.length();
    if (dist < 1e-3) return true;
    _to.divideScalar(dist);
    const hit = this.physics.raycast(_eye, _to, dist);
    return hit === null;
  }

  /**
   * Height of a ledge just ahead in the direction it is heading (`_dir`), if it can jump onto
   * it: higher than a step, no higher than `monsterJump`, with headroom for its body on top.
   */
  private ledgeAhead(m: Monster): number | null {
    const p = m.body.pos;
    const len = Math.hypot(_dir.x, _dir.z);
    if (len < 1e-3) return null;
    const reach = m.def.halfWidth + LEDGE_PROBE;
    const x = p.x + (_dir.x / len) * reach;
    const z = p.z + (_dir.z / len) * reach;
    const top = TUNING.combat.monsterJump + JUMP_MARGIN;
    // look down from just above the highest ledge it could take; starting inside a taller
    // wall finds nothing, which is the answer we want
    const down = this.physics.raycast({ x, y: p.y + top, z }, { x: 0, y: -1, z: 0 }, top);
    if (!down) return null;
    const rise = down.point.y - p.y;
    if (rise <= m.body.stepHeight || rise > TUNING.combat.monsterJump) return null;
    const up = this.physics.raycast({ x, y: down.point.y + 0.05, z }, { x: 0, y: 1, z: 0 }, m.def.height);
    return up ? null : rise;
  }

  /** Point _dir along a path to `goal`, planning one if needed and allowed. */
  private follow(m: Monster, goal: Waypoint): void {
    const p = m.body.pos;
    if (!this.nav) {
      _dir.set(goal.x - p.x, 0, goal.z - p.z).normalize();
      return;
    }
    if ((!m.path || m.repathT <= 0) && this.plans < PLANS_PER_FRAME) {
      this.plans++;
      m.path = findPath(this.nav, p, goal);
      m.repathT = 0.7 + Math.random() * 0.5;
    }
    while (m.path && m.path.length && Math.hypot(m.path[0]!.x - p.x, m.path[0]!.z - p.z) < 1.0)
      m.path.shift();
    const wp = m.path?.[0] ?? goal;
    _dir.set(wp.x - p.x, 0, wp.z - p.z);
    if (_dir.lengthSq() > 1e-6) _dir.normalize();
  }

  update(dt: number): void {
    const { player, combat } = this.ctx;
    const pp = player.position;
    this.plans = 0;
    for (const m of this.monsters) {
      if (m.dead) {
        m.melt += dt / MELT_TIME;
        continue;
      }
      const b = m.body;
      const def = m.def;
      if (m.act) m.act.t += dt / (m.act.kind === 'melee' ? MELEE_TIME : SPIT_TIME);
      m.attackT -= dt;
      m.sidestepT -= dt;
      m.hurtT -= dt;
      m.repathT -= dt;
      m.seeT -= dt;
      m.jumpT -= dt;
      _to.set(pp.x - b.pos.x, 0, pp.z - b.pos.z);
      const dist = _to.length();
      if (dist > 1e-3) _to.divideScalar(dist);
      if (m.seeT <= 0) {
        m.seeT = SIGHT_INTERVAL;
        m.canSee = combat.alive && dist < def.aggro * 2.5 && this.sees(m);
      }

      if (!m.aggro && m.canSee && dist < def.aggro) m.aggro = true;
      if (
        m.aggro &&
        (!combat.alive || b.pos.distanceTo(m.home) > TUNING.combat.leash || dist > def.aggro * 2.5)
      )
        m.aggro = false;

      // where it wants to go, as a unit vector times a speed factor
      _dir.set(0, 0, 0);
      let speed = def.speed;
      if (m.aggro) {
        const a = def.attack;
        if (!m.canSee) this.follow(m, pp);
        else m.path = null;
        if (a.kind === 'melee') {
          if (m.canSee && dist > a.range * 0.8) _dir.copy(_to);
          // wind up first; the blow lands partway through the swing, if the player is still there
          if (!m.act && dist < a.range && Math.abs(pp.y - b.pos.y) < 2 && m.attackT <= 0) {
            m.act = { kind: 'melee', t: 0, done: false };
            m.attackT = a.cooldown;
          }
          if (m.act?.kind === 'melee' && !m.act.done && m.act.t >= MELEE_LANDS) {
            m.act.done = true;
            if (dist < a.range * 1.25 && Math.abs(pp.y - b.pos.y) < 2) {
              combat.damagePlayer(a.damage, b.pos);
              this.ctx.events.emit('monster:bite', { at: b.pos });
            }
          }
          if (m.act) speed *= 0.3;
        } else if (m.canSee) {
          if (dist < a.keepAway[0]) _dir.copy(_to).negate();
          else if (dist > a.keepAway[1]) _dir.copy(_to);
          else {
            _dir.set(-_to.z * m.strafe, 0, _to.x * m.strafe);
            speed *= 0.5;
          }
          if (Math.random() < dt * 0.4) m.strafe = -m.strafe;
          if (!m.act && m.attackT <= 0 && dist < a.range) {
            m.act = { kind: 'spit', t: 0, done: false };
            m.attackT = a.cooldown;
          }
        }
      } else {
        const h = Math.hypot(m.home.x - b.pos.x, m.home.z - b.pos.z);
        if (h > 6) this.follow(m, m.home);
        else if (h > 2) _dir.set(m.home.x - b.pos.x, 0, m.home.z - b.pos.z).divideScalar(h);
        else m.path = null;
        speed *= 0.5;
      }
      const att = def.attack;
      if (m.act?.kind === 'spit' && !m.act.done && m.act.t >= SPIT_LEAVES && att.kind === 'spit') {
        m.act.done = true;
        this.spit(m, att.speed, att.damage);
      }
      if (m.act && m.act.t >= 1) m.act = null;
      // keep apart from each other
      for (const o of this.monsters) {
        if (o === m || o.dead) continue;
        const dx = b.pos.x - o.body.pos.x;
        const dz = b.pos.z - o.body.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < 1.6) {
          _dir.x += (dx / Math.sqrt(d2)) * 0.6;
          _dir.z += (dz / Math.sqrt(d2)) * 0.6;
        }
      }
      // slide around walls: after bumping, go sideways for a moment
      if (m.sidestepT > 0 && !this.nav)
        _dir.set(-_dir.z * m.sidestepDir, 0, _dir.x * m.sidestepDir).add(_to.clone().multiplyScalar(0.3));
      if (_dir.lengthSq() > 1) _dir.normalize();
      const tx = _dir.x * speed;
      const tz = _dir.z * speed;
      b.vel.x += THREE.MathUtils.clamp(tx - b.vel.x, -ACCEL * dt, ACCEL * dt);
      b.vel.z += THREE.MathUtils.clamp(tz - b.vel.z, -ACCEL * dt, ACCEL * dt);
      b.vel.y -= GRAVITY * dt;
      this.physics.moveBody(b, dt);
      const rise =
        b.hitWall && b.onGround && m.jumpT <= 0 && _dir.lengthSq() > 0.04 ? this.ledgeAhead(m) : null;
      if (rise !== null) {
        // jumping is the answer to this wall, not sidestepping round it
        b.vel.y = Math.sqrt(2 * GRAVITY * (rise + JUMP_MARGIN));
        m.jumpT = 0.6;
        m.sidestepT = 0;
      } else if (b.hitWall && m.aggro && m.sidestepT <= 0) {
        m.sidestepT = 0.6;
        m.sidestepDir = Math.random() < 0.5 ? 1 : -1;
      }
      if (b.pos.y < -50) {
        this.remove(m);
        continue;
      }
      // face the player when after them, otherwise the way it walks; turn smoothly
      const moving = Math.hypot(b.vel.x, b.vel.z);
      const want =
        m.aggro && dist > 0.1
          ? Math.atan2(-_to.x, -_to.z)
          : moving > 0.5
            ? Math.atan2(-b.vel.x, -b.vel.z)
            : m.yaw;
      m.yaw += wrapAngle(want - m.yaw) * Math.min(1, dt * 10);
      m.walk += moving * dt * (def.attack.kind === 'melee' ? 3.4 : 2.6);
    }
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i]!;
      if (m.dead && m.melt >= 1) this.monsters.splice(i, 1);
    }
    this.draw();
    this.updateSpits(dt);
  }

  private draw(): void {
    const t = this.ctx.state.clock;
    this.figures.begin();
    for (const m of this.monsters) {
      const b = m.body;
      this.figures.draw(m.def, {
        x: b.pos.x,
        y: b.pos.y,
        z: b.pos.z,
        yaw: m.yaw,
        walk: m.walk,
        stride: m.dead ? 0 : Math.min(1, Math.hypot(b.vel.x, b.vel.z) / m.def.speed),
        attack: m.act ? Math.min(1, m.act.t) : -1,
        hurt: Math.max(0, m.hurtT) / 0.12,
        air: !m.dead && !b.onGround,
        dying: m.dead ? m.melt : -1,
        t,
        colors: m.colors,
      });
    }
    this.figures.end();
  }

  private spit(m: Monster, speed: number, damage: number): void {
    const from = new THREE.Vector3(m.body.pos.x, m.body.pos.y + m.def.height * 0.8, m.body.pos.z);
    // aim a little high to make up for the drop
    const target = this.ctx.player.eye.clone();
    const flight = from.distanceTo(target) / speed;
    target.y += 0.5 * SPIT_GRAVITY * flight * flight - 0.3;
    const vel = target.sub(from).normalize().multiplyScalar(speed);
    const mesh = new THREE.Mesh(spitGeo(), this.material);
    mesh.position.copy(from);
    this.root.add(mesh);
    this.spits.push({ pos: from, vel, damage, mesh, life: SPIT_LIFE });
    this.ctx.events.emit('monster:spit', { at: from });
  }

  private updateSpits(dt: number): void {
    const { player, combat } = this.ctx;
    for (let i = this.spits.length - 1; i >= 0; i--) {
      const s = this.spits[i]!;
      s.life -= dt;
      s.vel.y -= SPIT_GRAVITY * dt;
      const step = s.vel.length() * dt;
      _dir.copy(s.vel).normalize();
      const wall = this.physics.raycast(s.pos, _dir, step);
      s.pos.addScaledVector(s.vel, dt);
      // distance from the spit to the player's body (feet to eye)
      const pp = player.position;
      const y = THREE.MathUtils.clamp(s.pos.y, pp.y, player.eye.y);
      const hitPlayer = Math.hypot(s.pos.x - pp.x, s.pos.y - y, s.pos.z - pp.z) < 0.6;
      if (hitPlayer) combat.damagePlayer(s.damage, s.pos);
      if (hitPlayer || wall || s.life <= 0) {
        s.mesh.removeFromParent();
        this.spits.splice(i, 1);
      } else s.mesh.position.copy(s.pos);
    }
  }

  dispose(): void {
    this.release();
    this.figures.dispose();
    for (const s of this.spits) s.mesh.removeFromParent();
    this.monsters.length = 0;
    this.spits.length = 0;
  }
}

/** Angle into -π..π. */
function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

/** Ray against an axis-aligned box; distance or null. */
function slab(
  o: THREE.Vector3,
  d: THREE.Vector3,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): number | null {
  let tmin = 0;
  let tmax = Infinity;
  for (const [oa, da, lo, hi] of [
    [o.x, d.x, x0, x1],
    [o.y, d.y, y0, y1],
    [o.z, d.z, z0, z1],
  ] as const) {
    if (Math.abs(da) < 1e-9) {
      if (oa < lo || oa > hi) return null;
      continue;
    }
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
