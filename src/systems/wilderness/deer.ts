// Deer grazing at the woods' edge (world/wilderness/wildlife.ts says where each herd lives).
// They wander a little round their meadow with their heads down, look up when someone comes
// near, and when the player comes too close (or runs at them) the whole herd bounds away and
// settles to graze wherever it stops. Scenery only: no colliders, nothing synced; each client
// sees its own deer. A herd is put out while the player is still well away from it, and taken
// in again once far behind, so none appear or vanish in plain sight.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import { TUNING } from '@/content/tuning';
import { WATER_LEVEL } from '@/world/wilderness/generator';
import { chunkSaturation } from '@/world/wilderness/wild-monsters';
import { type Herd, herdsNear } from '@/world/wilderness/wildlife';

/** A herd is put out within SHOW metres of the player (unless the player is already within
 * NEAR), and taken in beyond HIDE. */
const SHOW = 150;
const NEAR = 70;
const HIDE = 190;
/** A herd taken in comes back out no further than this from its own meadow. */
const ROAM = 60;
/** Closer than this they look up; closer than BOLT (or RUN_BOLT at a run) they flee. */
const WARY = 32;
const BOLT = 17;
const RUN_BOLT = 28;
/** Metres a second at a flat-out bound, and seconds it lasts. */
const FLEE_SPEED = 10;
const FLEE_TIME = 4;

/** Where the head and neck hinge on the body (local, deer facing +z). */
const SHOULDER = new THREE.Vector3(0, 1.08, 0.42);

/** Body and legs; and the neck and head, built round the shoulder so they can bow to graze. */
function deerGeometry(stag: boolean): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const brown = color('brown');
  const cream = color('cream');
  const ball = new THREE.SphereGeometry(1, 10, 7);
  const leg = new THREE.CylinderGeometry(1, 0.7, 1, 6);
  const cone = new THREE.ConeGeometry(1, 1, 5);
  const m = new THREE.Matrix4();
  const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0): THREE.Matrix4 =>
    m.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)),
      new THREE.Vector3(sx, sy, sz),
    );
  const b = new GeometryBuilder();
  b.meshSmooth(ball, at(0, 1.0, 0, 0.25, 0.28, 0.62), brown);
  b.meshSmooth(ball, at(0, 0.86, 0.04, 0.2, 0.15, 0.48), cream);
  // the white rump and a short tail
  b.meshSmooth(ball, at(0, 1.04, -0.56, 0.16, 0.17, 0.08), cream);
  b.meshSmooth(cone, at(0, 1.12, -0.62, 0.05, 0.14, 0.05, -2.3), brown);
  for (const [x, z] of [
    [0.12, 0.38],
    [-0.12, 0.38],
    [0.12, -0.4],
    [-0.12, -0.4],
  ] as const)
    b.meshSmooth(leg, at(x, 0.42, z, 0.045, 0.86, 0.045), brown);
  const h = new GeometryBuilder();
  // neck up and forward from the shoulder, the head at its end (relative to the shoulder)
  h.meshSmooth(leg, at(0, 0.2, 0.1, 0.09, 0.5, 0.1, 0.5), brown);
  h.meshSmooth(ball, at(0, 0.45, 0.26, 0.1, 0.11, 0.2, 0.35), brown);
  h.meshSmooth(ball, at(0, 0.4, 0.42, 0.055, 0.05, 0.06), color('charcoal'));
  for (const side of [-1, 1]) {
    h.meshSmooth(cone, at(side * 0.08, 0.58, 0.16, 0.035, 0.12, 0.02, -0.4), brown);
    if (stag) {
      // a small pair of branching antlers
      h.meshSmooth(leg, at(side * 0.05, 0.68, 0.2, 0.015, 0.28, 0.015, -0.25), color('bark'));
      h.meshSmooth(leg, at(side * 0.07, 0.74, 0.29, 0.012, 0.14, 0.012, 0.6), color('bark'));
    }
  }
  ball.dispose();
  leg.dispose();
  cone.dispose();
  return { body: b.build(), head: h.build() };
}

interface Deer {
  readonly root: THREE.Group;
  readonly neck: THREE.Object3D;
  x: number;
  z: number;
  yaw: number;
  /** Where it means to walk to while grazing, and when it next picks somewhere. */
  tx: number;
  tz: number;
  next: number;
  /** 0 head up .. 1 nose in the grass. */
  bow: number;
  /** Seconds left of a bolt (0: not fleeing), its heading, and the bound's phase. */
  flee: number;
  away: number;
  stride: number;
}

interface Out {
  readonly herd: Herd;
  readonly deer: Deer[];
  /** Where the herd grazes now: home at first, wherever it last stopped running after. */
  ax: number;
  az: number;
}

export class WildDeer {
  private readonly looks = [deerGeometry(false), deerGeometry(true)];
  private readonly out = new Map<string, Out>();
  /** Where herds taken in were last grazing, so they come back out there. */
  private readonly spots = new Map<string, { x: number; z: number }>();
  private checkT = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly root: THREE.Object3D,
    private readonly material: THREE.Material,
  ) {}

  update(dt: number): void {
    const { player, wilderness } = this.ctx;
    const p = player.position;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 1;
      // a herd is judged by where it grazes now: home at first, wherever it last stopped after
      for (const herd of herdsNear(wilderness, p.x, p.z, SHOW + ROAM)) {
        if (this.out.has(herd.id)) continue;
        const at = this.spots.get(herd.id) ?? herd;
        if (!this.coloured(at)) continue;
        const d = Math.hypot(at.x - p.x, at.z - p.z);
        if (d > NEAR && d <= SHOW) this.put(herd, at);
      }
      for (const [id, o] of this.out)
        if (Math.hypot(o.ax - p.x, o.az - p.z) > HIDE) {
          for (const d of o.deer) d.root.removeFromParent();
          this.out.delete(id);
          // however far it was chased, it drifts back toward its own meadow
          const dx = o.ax - o.herd.x;
          const dz = o.az - o.herd.z;
          const k = Math.min(1, ROAM / (Math.hypot(dx, dz) || 1));
          this.spots.set(id, { x: o.herd.x + dx * k, z: o.herd.z + dz * k });
        }
      for (const [id, s] of this.spots) if (Math.hypot(s.x - p.x, s.z - p.z) > 1000) this.spots.delete(id);
    }
    const running = player.speed > 5;
    for (const o of this.out.values()) this.move(o, dt, p, running);
  }

  /** Deer keep to land with its colour: grey land is the monsters'. */
  private coloured(at: { x: number; z: number }): boolean {
    const size = TUNING.world.chunkSize;
    const sat = chunkSaturation(this.ctx.wilderness, Math.floor(at.x / size), Math.floor(at.z / size), (c) =>
      this.ctx.cities.progress(c),
    );
    return sat >= TUNING.combat.wild.greyBelow;
  }

  private put(herd: Herd, at: { x: number; z: number }): void {
    const deer: Deer[] = [];
    for (let i = 0; i < herd.count; i++) {
      const r = (k: number): number => {
        const v = Math.sin(herd.seed * 0.0001 + i * 12.9898 + k * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      const look = this.looks[i === 0 && r(0) < 0.6 ? 1 : 0]!;
      const root = new THREE.Group();
      root.name = `deer:${herd.id}:${i}`;
      const body = new THREE.Mesh(look.body, this.material);
      const neck = new THREE.Group();
      neck.position.copy(SHOULDER);
      neck.add(new THREE.Mesh(look.head, this.material));
      root.add(body, neck);
      // fawns and hinds a little smaller than the stag
      root.scale.setScalar(0.8 + 0.25 * r(1));
      this.root.add(root);
      const a = r(2) * Math.PI * 2;
      const d = 2 + r(3) * 7;
      const x = at.x + Math.cos(a) * d;
      const z = at.z + Math.sin(a) * d;
      deer.push({
        root,
        neck,
        x,
        z,
        yaw: r(4) * Math.PI * 2,
        tx: x,
        tz: z,
        next: r(5) * 6,
        bow: 1,
        flee: 0,
        away: 0,
        stride: r(6) * 6,
      });
    }
    this.out.set(herd.id, { herd, deer, ax: at.x, az: at.z });
  }

  private move(o: Out, dt: number, p: THREE.Vector3, running: boolean): void {
    const w = this.ctx.wilderness;
    const close = Math.min(...o.deer.map((d) => Math.hypot(d.x - p.x, d.z - p.z)));
    // one bolts, they all bolt, away from the player
    if (close < (running ? RUN_BOLT : BOLT) && o.deer.every((d) => d.flee <= 0.5))
      for (const d of o.deer) {
        d.flee = FLEE_TIME * (0.85 + 0.3 * Math.random());
        d.away = Math.atan2(d.z - p.z, d.x - p.x) + (Math.random() - 0.5) * 0.6;
      }
    let sx = 0;
    let sz = 0;
    for (const d of o.deer) {
      let speed = 0;
      let face = d.yaw;
      let bowTo = 0;
      if (d.flee > 0) {
        d.flee -= dt;
        speed = FLEE_SPEED * Math.min(1, d.flee / 1.2 + 0.25);
        // veer off water and town walls rather than run into them
        const open = (a: number): boolean => {
          const x = d.x + Math.cos(a) * 6;
          const z = d.z + Math.sin(a) * 6;
          return w.heightAt(x, z) >= WATER_LEVEL + 0.3 && !w.townAt(x, z, 3);
        };
        if (!open(d.away)) d.away += open(d.away + 0.8) ? 0.8 : open(d.away - 0.8) ? -0.8 : Math.PI;
        face = d.away;
        if (d.flee <= 0) {
          d.tx = d.x;
          d.tz = d.z;
          d.next = 3 + Math.random() * 4;
        }
      } else if (Math.hypot(d.x - p.x, d.z - p.z) < WARY) {
        // heads up, watching
        face = Math.atan2(p.z - d.z, p.x - d.x);
      } else {
        d.next -= dt;
        if (d.next <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 8;
          d.tx = o.ax + Math.cos(a) * r;
          d.tz = o.az + Math.sin(a) * r;
          d.next = 5 + Math.random() * 9;
        }
        const to = Math.hypot(d.tx - d.x, d.tz - d.z);
        if (to > 0.4 && w.heightAt(d.tx, d.tz) > WATER_LEVEL + 0.2) {
          speed = 0.6;
          face = Math.atan2(d.tz - d.z, d.tx - d.x);
        }
        // mostly nose down, now and then a look round
        bowTo = Math.sin(d.next * 0.9 + d.stride) > -0.6 ? 1 : 0.1;
      }
      // turn toward where it is headed, quickly when running
      let turn = face - d.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      d.yaw += turn * Math.min(1, dt * (d.flee > 0 ? 8 : 2.5));
      d.x += Math.cos(d.yaw) * speed * dt;
      d.z += Math.sin(d.yaw) * speed * dt;
      d.bow += (bowTo - d.bow) * Math.min(1, dt * 2.5);
      // a bounding gait: up off all four, a stretch, down again
      d.stride += dt * (speed > 3 ? 7 : speed * 3);
      const hop = speed > 3 ? Math.abs(Math.sin(d.stride)) * 0.55 : 0;
      d.root.position.set(d.x, w.heightAt(d.x, d.z) + hop, d.z);
      // the body faces +z: turn it to its heading
      d.root.rotation.set(speed > 3 ? Math.cos(d.stride) * 0.18 : 0, Math.PI / 2 - d.yaw, 0, 'YXZ');
      d.neck.rotation.x = d.bow * 1.25 - (speed > 3 ? 0.3 : 0);
      sx += d.x;
      sz += d.z;
    }
    // they graze where they end up
    if (o.deer.every((d) => d.flee <= 0)) {
      o.ax = sx / o.deer.length;
      o.az = sz / o.deer.length;
    }
  }

  dispose(): void {
    for (const o of this.out.values()) for (const d of o.deer) d.root.removeFromParent();
    this.out.clear();
    for (const l of this.looks) {
      l.body.dispose();
      l.head.dispose();
    }
  }
}
