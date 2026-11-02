// A group of ink monsters living in one scene. Spawned from ENEMIES data, moved with the same
// AABB physics as the player, registered with ctx.combat so weapons can hit them.
//
// AI: notice the player within `aggro` metres with line of sight. With the player in sight,
// blots run straight at them and bite, spitters keep their distance and spit. Out of sight,
// a monster follows an A* path over the scene's NavGrid (re-planned every ~1 s, a few plans
// per frame at most). A monster dragged too far from its post gives up and paths home.
// Without a NavGrid it falls back to sidestepping along walls.
import * as THREE from 'three';
import { ENEMIES, type EnemyDef } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import { type Body, type PhysicsWorld, makeBody } from '@/engine/physics/world';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext, TargetHit, TargetSource } from '@/game/types';
import { findPath, type NavGrid, type Waypoint } from '@/world/nav/path';

const GRAVITY = 22;
const ACCEL = 18;
const SPIT_GRAVITY = 6;
const SPIT_LIFE = 3;
/** Path plans allowed per frame across the whole group. */
const PLANS_PER_FRAME = 3;
/** Line-of-sight checks are refreshed this often (seconds). */
const SIGHT_INTERVAL = 0.25;

/** Ids are unique across every group, so overlays can track one monster. */
let nextId = 1;

interface Monster {
  readonly id: number;
  readonly def: EnemyDef;
  readonly body: Body;
  readonly mesh: THREE.Mesh;
  readonly home: THREE.Vector3;
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
}

interface Spit {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly damage: number;
  readonly mesh: THREE.Mesh;
  life: number;
}

const geometries = new Map<number, THREE.BufferGeometry>();
function monsterGeometry(type: number): THREE.BufferGeometry {
  let g = geometries.get(type);
  if (g) return g;
  const def = ENEMIES[type]!;
  const b = new GeometryBuilder();
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const eye = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const h = def.height;
  const w = def.halfWidth;
  if (def.attack.kind === 'melee') {
    b.mesh(
      blob,
      m.compose(
        new THREE.Vector3(0, h * 0.45, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(w * 1.25, h * 0.5, w * 1.25),
      ),
      def.body,
      ALWAYS_COLOR,
    );
  } else {
    b.mesh(
      blob,
      m.compose(
        new THREE.Vector3(0, h * 0.3, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(w * 1.1, h * 0.32, w * 1.1),
      ),
      def.body,
      ALWAYS_COLOR,
    );
    b.mesh(
      blob,
      m.compose(
        new THREE.Vector3(0, h * 0.78, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(w * 0.9, h * 0.25, w * 0.9),
      ),
      def.body,
      ALWAYS_COLOR,
    );
  }
  // eyes on the -z side, which is "forward" once the mesh is turned to face its target
  const ey = def.attack.kind === 'melee' ? h * 0.6 : h * 0.85;
  for (const sx of [-1, 1])
    b.mesh(
      eye,
      m.compose(
        new THREE.Vector3(sx * w * 0.38, ey, -w * 1.05),
        new THREE.Quaternion(),
        new THREE.Vector3(w * 0.28, w * 0.36, 0.08),
      ),
      def.eyes,
      ALWAYS_COLOR,
    );
  g = b.build();
  geometries.set(type, g);
  return g;
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
}

export class MonsterGroup implements TargetSource {
  private readonly monsters: Monster[] = [];
  private readonly spits: Spit[] = [];
  private readonly release: () => void;
  private plans = 0;
  /** Walkability of the scene; null falls back to sidestepping along walls. */
  nav: NavGrid | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly physics: PhysicsWorld,
    private readonly root: THREE.Object3D,
    private readonly material: THREE.Material,
  ) {
    this.release = ctx.combat.addTargets(this);
  }

  spawn(type: number, pos: THREE.Vector3, opts: SpawnOptions): void {
    const def = ENEMIES[type]!;
    const mesh = new THREE.Mesh(monsterGeometry(type), this.material);
    mesh.position.copy(pos);
    this.root.add(mesh);
    this.monsters.push({
      id: nextId++,
      def,
      body: makeBody(pos, def.halfWidth, def.height, 0.55),
      mesh,
      home: pos.clone(),
      tag: opts.tag,
      onDefeat: opts.onDefeat,
      hp: def.hp,
      aggro: false,
      attackT: Math.random() * def.attack.cooldown,
      sidestepT: 0,
      sidestepDir: 1,
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
        this.ctx.events.emit('monster:died', { at, id: m.id, amount: dealt });
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
    m.mesh.removeFromParent();
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
      if (m.dead) continue;
      const b = m.body;
      const def = m.def;
      m.attackT -= dt;
      m.sidestepT -= dt;
      m.hurtT -= dt;
      m.repathT -= dt;
      m.seeT -= dt;
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
          if (dist < a.range && Math.abs(pp.y - b.pos.y) < 2 && m.attackT <= 0) {
            combat.damagePlayer(a.damage, b.pos);
            this.ctx.events.emit('monster:bite', { at: b.pos });
            m.attackT = a.cooldown;
          }
        } else if (m.canSee) {
          if (dist < a.keepAway[0]) _dir.copy(_to).negate();
          else if (dist > a.keepAway[1]) _dir.copy(_to);
          else {
            _dir.set(-_to.z * m.strafe, 0, _to.x * m.strafe);
            speed *= 0.5;
          }
          if (Math.random() < dt * 0.4) m.strafe = -m.strafe;
          if (m.attackT <= 0 && dist < a.range) {
            this.spit(m, a.speed, a.damage);
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
      if (b.hitWall && m.aggro && m.sidestepT <= 0) {
        m.sidestepT = 0.6;
        m.sidestepDir = Math.random() < 0.5 ? 1 : -1;
      }
      if (b.pos.y < -50) {
        this.remove(m);
        continue;
      }
      m.mesh.position.copy(b.pos);
      if (dist > 0.1 && m.aggro) m.mesh.rotation.y = Math.atan2(-_to.x, -_to.z);
      const squash = m.hurtT > 0 ? 0.85 : 1 + 0.04 * Math.sin(this.ctx.state.clock * 9 + b.pos.x);
      m.mesh.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    }
    for (let i = this.monsters.length - 1; i >= 0; i--)
      if (this.monsters[i]!.dead) this.monsters.splice(i, 1);
    this.updateSpits(dt);
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
    for (const m of this.monsters) m.mesh.removeFromParent();
    for (const s of this.spits) s.mesh.removeFromParent();
    this.monsters.length = 0;
    this.spits.length = 0;
  }
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
