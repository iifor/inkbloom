// The ink tide. Every few minutes of play in a city, a wave of ink rolls from a drained block
// into a neighbouring block that has colour. It is announced `warning` seconds ahead, then a
// curtain of ink advances across the block for `duration` seconds, draining every surface it
// passes. Hold the use button on the curtain to push it back with generic pigment. The block
// is held if it keeps `holdRatio` of its colour; an undefended wave sweeps `reach` of it.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import type { GameContext } from '@/game/types';
import { blockBounds, depthFrom, tideTargets, type BlockState } from '@/world/city/blocks';
import type { CityLayout } from '@/world/city/layout';
import { isColored } from '@/world/paint/surfaces';

const T = TUNING.tide;
const HEIGHT = 16;
/** Direction a wave comes from, as the side of the block it enters through. */
export const SIDE_NAMES = ['东', '南', '西', '北'] as const;

export interface TideHost {
  blocks(): BlockState[];
  progress(chunk: number): number;
  chunkAt(pos: THREE.Vector3): number;
}

export type TideStatus =
  | { readonly phase: 'warning'; readonly chunk: number; readonly from: number; readonly seconds: number }
  | {
      readonly phase: 'active';
      readonly chunk: number;
      readonly from: number;
      readonly seconds: number;
      /** 0..1 of the block the front has covered. */
      readonly front: number;
      readonly pushing: boolean;
      readonly blocked: string | null;
    };

interface Wave {
  chunk: number;
  from: number;
  startsAt: number;
  endsAt: number;
  /** Metres into the block. */
  front: number;
  /** Surfaces of the block sorted by depth from the entry edge. */
  order: number[];
  pushing: boolean;
  blocked: string | null;
  spendOwed: number;
}

export class InkTide {
  private nextAt: number;
  private wave: Wave | null = null;
  private readonly curtain: THREE.Mesh;
  private readonly per: number;

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    private readonly states: Uint8Array,
    private readonly host: TideHost,
    material: THREE.Material,
    root: THREE.Object3D,
  ) {
    this.nextAt = ctx.state.clock + T.firstDelay;
    this.per = layout.size / TUNING.city.chunks;
    this.curtain = new THREE.Mesh(buildCurtain(this.per), material);
    this.curtain.visible = false;
    this.curtain.frustumCulled = false;
    root.add(this.curtain);
  }

  status(): TideStatus | null {
    const w = this.wave;
    if (!w) return null;
    const now = this.ctx.state.clock;
    if (now < w.startsAt)
      return { phase: 'warning', chunk: w.chunk, from: w.from, seconds: w.startsAt - now };
    return {
      phase: 'active',
      chunk: w.chunk,
      from: w.from,
      seconds: Math.max(0, w.endsAt - now),
      front: w.front / this.per,
      pushing: w.pushing,
      blocked: w.blocked,
    };
  }

  /** Start the next tide now (debug tooling). */
  trigger(): boolean {
    this.nextAt = this.ctx.state.clock;
    if (this.wave) return false;
    return this.schedule();
  }

  update(dt: number): void {
    const now = this.ctx.state.clock;
    if (!this.wave) {
      if (now >= this.nextAt && !this.schedule()) this.nextAt = now + T.retry;
      return;
    }
    const w = this.wave;
    if (now < w.startsAt) return;
    this.curtain.visible = true;
    const speed = (this.per * T.reach) / T.duration;
    w.front = Math.min(this.per, w.front + speed * dt);
    this.push(w, dt);
    this.drainPassed(w);
    this.placeCurtain(w, now);
    const repelled = w.front <= 0 && now - w.startsAt > T.repelAfter;
    if (now >= w.endsAt || repelled) this.finish(w, repelled);
  }

  private schedule(): boolean {
    const targets = tideTargets(this.host.blocks());
    if (!targets.length) return false;
    // strike near the player so the tide is something they can answer
    const here = this.host.chunkAt(this.ctx.player.position);
    const side = TUNING.city.chunks;
    const dist = (c: number): number =>
      Math.abs((c % side) - (here % side)) + Math.abs(Math.floor(c / side) - Math.floor(here / side));
    targets.sort((a, b) => dist(a.chunk) - dist(b.chunk));
    const { chunk, from } = targets[0]!;
    const bounds = blockBounds(chunk, this.layout.size);
    const order = this.layout.surfaces
      .flatMap((s, i) => (s.chunk === chunk ? [i] : []))
      .sort(
        (a, b) =>
          depthFrom(this.layout.surfaces[a]!, from, bounds) -
          depthFrom(this.layout.surfaces[b]!, from, bounds),
      );
    const now = this.ctx.state.clock;
    this.wave = {
      chunk,
      from,
      startsAt: now + T.warning,
      endsAt: now + T.warning + T.duration,
      front: 0,
      order,
      pushing: false,
      blocked: null,
      spendOwed: 0,
    };
    const where = chunk === here ? '这个街区' : '附近的街区';
    this.ctx.events.emit('toast', {
      text: `墨潮将在 ${T.warning} 秒后从${SIDE_NAMES[from]}边涌向${where}！`,
      seconds: 5,
    });
    return true;
  }

  /** Holding use while aiming at the curtain pushes it back and spends pigment. */
  private push(w: Wave, dt: number): void {
    w.pushing = false;
    w.blocked = null;
    if (!this.ctx.input.held('use') || !this.aimingAtCurtain(w)) return;
    w.spendOwed += T.pushCostPerSecond * dt;
    if (w.spendOwed >= 1) {
      const r = this.ctx.apply({ kind: 'spend', generic: 1 });
      if (!r.ok) {
        w.blocked = '通用颜料不足，推不动墨潮';
        w.spendOwed = 1;
        return;
      }
      w.spendOwed -= 1;
    }
    w.pushing = true;
    w.front = Math.max(0, w.front - T.pushSpeed * dt);
  }

  private aimingAtCurtain(w: Wave): boolean {
    const { eye, forward } = this.ctx.player;
    const b = blockBounds(w.chunk, this.layout.size);
    // the curtain is the plane at depth `front` from the entry edge
    const alongX = w.from === 0 || w.from === 2;
    const plane =
      w.from === 0
        ? b.x1 - w.front
        : w.from === 1
          ? b.z1 - w.front
          : w.from === 2
            ? b.x0 + w.front
            : b.z0 + w.front;
    const o = alongX ? eye.x : eye.z;
    const d = alongX ? forward.x : forward.z;
    if (Math.abs(d) < 1e-4) return false;
    const t = (plane - o) / d;
    if (t < 0 || t > T.pushRange) return false;
    const hitY = eye.y + forward.y * t;
    const hitAcross = alongX ? eye.z + forward.z * t : eye.x + forward.x * t;
    const [lo, hi] = alongX ? [b.z0, b.z1] : [b.x0, b.x1];
    return hitY >= -1 && hitY <= HEIGHT && hitAcross >= lo && hitAcross <= hi;
  }

  private drainPassed(w: Wave): void {
    const bounds = blockBounds(w.chunk, this.layout.size);
    for (const i of w.order) {
      if (depthFrom(this.layout.surfaces[i]!, w.from, bounds) > w.front) break;
      if (isColored(this.states[i]!)) this.ctx.apply({ kind: 'drain', city: this.layout.id, surface: i });
    }
  }

  private placeCurtain(w: Wave, now: number): void {
    const b = blockBounds(w.chunk, this.layout.size);
    const c = this.curtain;
    // curtain geometry runs along +x from 0..per; rotate it to lie across the entry direction
    switch (w.from) {
      case 0:
        c.position.set(b.x1 - w.front, 0, b.z1);
        c.rotation.set(0, Math.PI / 2, 0);
        break;
      case 1:
        c.position.set(b.x0, 0, b.z1 - w.front);
        c.rotation.set(0, 0, 0);
        break;
      case 2:
        c.position.set(b.x0 + w.front, 0, b.z1);
        c.rotation.set(0, Math.PI / 2, 0);
        break;
      default:
        c.position.set(b.x0, 0, b.z0 + w.front);
        c.rotation.set(0, 0, 0);
    }
    c.scale.y = 0.9 + 0.1 * Math.sin(now * 3);
  }

  private finish(w: Wave, repelled: boolean): void {
    this.wave = null;
    this.curtain.visible = false;
    this.nextAt = this.ctx.state.clock + T.intervalMin + Math.random() * (T.intervalMax - T.intervalMin);
    const held = repelled || this.host.progress(w.chunk) >= T.holdRatio;
    if (held) {
      this.ctx.apply({ kind: 'grant', generic: T.reward.generic, ink: T.reward.ink });
      this.ctx.events.emit('toast', {
        text: `${repelled ? '墨潮被推回去了' : '守住了街区'}！通用颜料 +${T.reward.generic}，墨 +${T.reward.ink}`,
        seconds: 5,
      });
    } else this.ctx.events.emit('toast', { text: '街区失守：墨潮带走了颜色', seconds: 5 });
  }

  dispose(): void {
    this.curtain.geometry.dispose();
    this.curtain.removeFromParent();
  }
}

/** Ragged vertical strokes of ink along +x from 0 to `length`, standing on y = 0 at z = 0. */
function buildCurtain(length: number): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const ink = color('charcoal');
  const faces = { px: ink, nx: ink, pz: ink, nz: ink, py: ink };
  const always = { px: ALWAYS_COLOR, nx: ALWAYS_COLOR, pz: ALWAYS_COLOR, nz: ALWAYS_COLOR, py: ALWAYS_COLOR };
  let x = 0;
  let k = 0;
  while (x < length) {
    const w = 0.35 + 0.5 * Math.abs(Math.sin(k * 12.9898));
    const h = HEIGHT * (0.45 + 0.55 * Math.abs(Math.sin(k * 78.233)));
    const dz = 0.6 * Math.sin(k * 3.7);
    g.box({ x, y: 0, z: dz - 0.2 }, { x: x + w, y: h, z: dz + 0.2 }, faces, always);
    x += w + 0.25 + 0.6 * Math.abs(Math.sin(k * 5.1));
    k++;
  }
  return g.build();
}
