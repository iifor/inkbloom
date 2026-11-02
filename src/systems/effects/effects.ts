// Visual feedback: ink and colour flecks, and camera shake. Listens to game events only, like
// the audio system, so effects can be removed or restyled without touching gameplay.
import * as THREE from 'three';
import { PAINTABLE, color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { Point3 } from '@/game/events';
import type { GameContext, System } from '@/game/types';

const MAX = 700;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

interface Fleck {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Upward acceleration (negative falls). */
  lift: number;
  size: number;
  life: number;
  maxLife: number;
}

interface Burst {
  readonly count: number;
  readonly color: number;
  readonly speed: number;
  readonly up?: number;
  readonly size?: number;
  readonly life?: number;
  readonly lift?: number;
}

export class EffectsSystem implements System {
  readonly id = 'effects';
  private readonly mesh: THREE.InstancedMesh;
  private readonly flecks: (Fleck | null)[] = new Array(MAX).fill(null);
  private cursor = 0;
  private readonly release: (() => void)[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private dirty = false;

  constructor(private readonly ctx: GameContext) {
    const g = new GeometryBuilder();
    g.mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.Matrix4(), 0, ALWAYS_COLOR);
    this.mesh = new THREE.InstancedMesh(g.build(), makeInkMaterial(), MAX);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
    }
    ctx.renderer.scene.add(this.mesh);

    const ink = color('charcoal');
    const on = ctx.events.on.bind(ctx.events);
    const shakeNear = (at: Point3, reach: number, amount: number): void => {
      const d = Math.hypot(at.x - ctx.player.position.x, at.z - ctx.player.position.z);
      if (d < reach) ctx.player.shake(amount * (1 - d / reach));
    };
    this.release.push(
      on('paint:bloom', ({ at, color: c }) =>
        this.burst(at, { count: 14, color: c, speed: 2.5, up: 1.5, size: 0.1, lift: 2 }),
      ),
      on('paint:drained', ({ at }) =>
        this.burst(at, { count: 8, color: ink, speed: 1.5, size: 0.08, lift: -6 }),
      ),
      on('shot:impact', ({ at }) => {
        // a puff of paper dust and a few ink chips off the wall
        this.burst(at, { count: 4, color: color('cream'), speed: 1.2, size: 0.07, lift: -2, life: 0.4 });
        this.burst(at, { count: 3, color: ink, speed: 2.5, up: 1, size: 0.035, lift: -9, life: 0.5 });
      }),
      on('monster:hit', ({ at }) => this.burst(at, { count: 6, color: ink, speed: 4, size: 0.09, lift: -9 })),
      on('monster:died', ({ at }) => {
        this.burst(at, { count: 26, color: ink, speed: 6, up: 2, size: 0.14, lift: -9, life: 0.9 });
        this.burst(at, { count: 6, color: ink, speed: 2, size: 0.3, lift: -9, life: 0.7 });
      }),
      on('blast', ({ at, radius }) => {
        this.burst(at, { count: 40, color: ink, speed: radius * 2.2, up: 3, size: 0.18, lift: -9, life: 1 });
        this.burst(at, {
          count: 14,
          color: color('orange'),
          speed: radius * 1.5,
          up: 2,
          size: 0.12,
          lift: -6,
        });
        shakeNear(at, radius * 6, 0.9);
      }),
      on('monster:spit', ({ at }) =>
        this.burst(at, { count: 4, color: ink, speed: 1.5, size: 0.07, lift: -9 }),
      ),
      on('player:hurt', () => ctx.player.shake(0.45)),
      on('player:land', ({ impact }) => {
        if (impact > 0.5) ctx.player.shake(impact * 0.5);
      }),
      on('patch:applied', ({ patch }) => {
        if (patch.kind === 'collect') {
          // the stain splashes up from the ground in front of the player, below the camera
          const p = ctx.player.position;
          const f = ctx.player.forward;
          this.burst(
            { x: p.x + f.x * 1.5, y: p.y + 0.1, z: p.z + f.z * 1.5 },
            { count: 10, color: ink, speed: 1.5, up: 2, size: 0.07, lift: -6 },
          );
        }
      }),
      on('growth:level', () => this.rainbow(ctx.player.position, 30, 1.2)),
      on('city:completed', () => this.rainbow(ctx.player.position, 90, 3)),
      on('tide:start', ({ at }) => shakeNear(at, 200, 0.3)),
      on('tide:drip', ({ at }) =>
        this.burst(at, { count: 1, color: ink, speed: 0.3, size: 0.16, lift: -12, life: 1.4 }),
      ),
    );
  }

  /** Flecks of every colour bursting around a point. */
  /** Flecks of every colour rising from a ring around the player's feet. They start a couple of
   * metres out so none passes through the camera. */
  private rainbow(at: Point3, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const c = PAINTABLE[i % PAINTABLE.length]!;
      const a = (i / count) * Math.PI * 2;
      const r = 2 + Math.random();
      this.burst(
        { x: at.x + Math.cos(a) * r, y: at.y + 0.2, z: at.z + Math.sin(a) * r },
        { count: 1, color: c, speed: speed * 0.6, up: speed * 1.5, size: 0.1, lift: 1.5, life: 1.6 },
      );
    }
  }

  burst(at: Point3, b: Burst): void {
    for (let k = 0; k < b.count; k++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sp = b.speed * (0.4 + 0.6 * Math.random());
      const life = (b.life ?? 0.7) * (0.6 + 0.4 * Math.random());
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.flecks[i] = {
        x: at.x,
        y: at.y,
        z: at.z,
        vx: Math.sin(phi) * Math.cos(theta) * sp,
        vy: Math.cos(phi) * sp + (b.up ?? 0),
        vz: Math.sin(phi) * Math.sin(theta) * sp,
        lift: b.lift ?? -9,
        size: (b.size ?? 0.1) * (0.6 + 0.8 * Math.random()),
        life,
        maxLife: life,
      };
      this.mesh.setColorAt(i, this.c.setRGB(b.color, 0, 0));
      this.mesh.instanceColor!.needsUpdate = true;
    }
    this.dirty = true;
  }

  update(dt: number): void {
    if (!this.dirty) return;
    let alive = false;
    for (let i = 0; i < MAX; i++) {
      const f = this.flecks[i];
      if (!f) continue;
      f.life -= dt;
      if (f.life <= 0) {
        this.flecks[i] = null;
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      alive = true;
      f.vy += f.lift * dt;
      const drag = Math.exp(-2.5 * dt);
      f.vx *= drag;
      f.vz *= drag;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      const k = f.size * Math.min(1, (f.life / f.maxLife) * 2);
      this.mesh.setMatrixAt(i, this.m.compose(this.v.set(f.x, f.y, f.z), this.q, this.s.set(k, k, k)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = alive;
  }

  dispose(): void {
    for (const r of this.release) r();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
