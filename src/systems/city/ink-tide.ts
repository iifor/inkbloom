// The ink tide. Every few minutes of play in a city, a wave of ink rolls from a drained block
// into a neighbouring block that has colour. It is announced `warning` seconds ahead, then a
// curtain of ink advances across the block for `duration` seconds, draining every surface it
// passes. Hold the use button on the curtain to push it back with generic pigment. The block
// is held if it keeps `holdRatio` of its colour; an undefended wave sweeps `reach` of it.
//
// Its timers live in the city's save (`TideSave`) as seconds still to go, written every frame
// it runs: a refresh resumes the wave where it was, and leaving the city pauses it.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import type { GameContext } from '@/game/types';
import { blockBounds, depthFrom, tideTargets, type BlockState } from '@/world/city/blocks';
import type { CityLayout } from '@/world/city/layout';
import { isColored } from '@/world/paint/surfaces';
import { stats } from '@/world/progression';
import type { TideSave, TideWaveSave } from '@/world/state';
import { CURTAIN_HEIGHT, InkCurtain } from './ink-curtain';

const T = TUNING.tide;
/** Height of the plane that catches the brush and pushing, a little over the tallest crest. */
const HEIGHT = CURTAIN_HEIGHT + 3;
/** Direction a wave comes from, as the side of the block it enters through. */
export const SIDE_NAMES = ['东', '南', '西', '北'] as const;

export interface TideHost {
  blocks(): BlockState[];
  /** Monsters come in with the wave and dissolve when it ends. */
  spawnTideMonsters(chunk: number, from: number): void;
  clearTideMonsters(): void;
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
  /** The same wave in the save, kept current. */
  readonly saved: TideWaveSave;
  /** Surfaces of the block sorted by depth from the entry edge. */
  order: number[];
  pushing: boolean;
  blocked: string | null;
  spendOwed: number;
}

export class InkTide {
  private nextAt: number;
  private wave: Wave | null = null;
  private readonly curtain: InkCurtain;
  private readonly per: number;

  constructor(
    private readonly ctx: GameContext,
    private readonly layout: CityLayout,
    private readonly states: Uint8Array,
    private readonly host: TideHost,
    private readonly saved: TideSave,
    root: THREE.Object3D,
  ) {
    const now = ctx.state.clock;
    this.nextAt = now + saved.nextIn;
    this.per = layout.size / layout.chunks;
    this.curtain = new InkCurtain(this.per);
    root.add(this.curtain.root);
    const w = saved.wave;
    if (w) {
      this.begin(w.chunk, w.from, now + w.startsIn, now + w.endsIn, w.front);
      // said on the first update: the city may be built before the HUD is listening
      this.resumed = true;
    }
  }

  private resumed = false;

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
      this.saved.nextIn = Math.max(0, this.nextAt - now);
      return;
    }
    const w = this.wave;
    this.record(w, now);
    if (this.resumed) {
      this.resumed = false;
      this.ctx.events.emit('toast', {
        text:
          now < w.startsAt
            ? `墨潮还有 ${Math.ceil(w.startsAt - now)} 秒从${SIDE_NAMES[w.from]}边涌来`
            : '墨潮还在继续：对准墨帘按住左键把它推回去',
        seconds: 5,
      });
    }
    if (now < w.startsAt) return;
    if (!this.curtain.visible) {
      this.host.spawnTideMonsters(w.chunk, w.from);
      this.ctx.events.emit('tide:start', { at: this.blockCentre(w.chunk) });
    }
    this.curtain.visible = true;
    const speed = (this.per * T.reach) / T.duration;
    w.front = Math.min(this.per, w.front + speed * dt);
    this.push(w, dt);
    this.drainPassed(w);
    this.placeCurtain(w, now);
    this.drip(w, dt);
    this.record(w, now);
    const repelled = w.front <= 0 && now - w.startsAt > T.repelAfter;
    if (now >= w.endsAt || repelled) this.finish(w, repelled);
  }

  private record(w: Wave, now: number): void {
    const s = w.saved;
    s.startsIn = Math.max(0, w.startsAt - now);
    s.endsIn = Math.max(0, w.endsAt - now);
    s.front = w.front;
  }

  private schedule(): boolean {
    const targets = tideTargets(this.host.blocks());
    if (!targets.length) return false;
    // strike near the player so the tide is something they can answer
    const here = this.host.chunkAt(this.ctx.player.position);
    const side = this.layout.chunks;
    const dist = (c: number): number =>
      Math.abs((c % side) - (here % side)) + Math.abs(Math.floor(c / side) - Math.floor(here / side));
    targets.sort((a, b) => dist(a.chunk) - dist(b.chunk));
    const { chunk, from } = targets[0]!;
    const now = this.ctx.state.clock;
    this.begin(chunk, from, now + T.warning, now + T.warning + T.duration, 0);
    this.ctx.events.emit('tide:warning', { at: this.blockCentre(chunk) });
    const where = chunk === here ? '这个街区' : '附近的街区';
    this.ctx.events.emit('toast', {
      text: `墨潮将在 ${T.warning} 秒后从${SIDE_NAMES[from]}边涌向${where}！`,
      seconds: 5,
    });
    return true;
  }

  /** Set up a wave (new, or resumed from the save). */
  private begin(chunk: number, from: number, startsAt: number, endsAt: number, front: number): void {
    const bounds = blockBounds(chunk, this.layout);
    const order = this.layout.surfaces
      .flatMap((s, i) => (s.chunk === chunk ? [i] : []))
      .sort(
        (a, b) =>
          depthFrom(this.layout.surfaces[a]!, from, bounds) -
          depthFrom(this.layout.surfaces[b]!, from, bounds),
      );
    const saved: TideWaveSave = { chunk, from, startsIn: 0, endsIn: 0, front };
    this.saved.wave = saved;
    this.wave = {
      chunk,
      from,
      startsAt,
      endsAt,
      front,
      saved,
      order,
      pushing: false,
      blocked: null,
      spendOwed: 0,
    };
    this.record(this.wave, this.ctx.state.clock);
  }

  /** Holding use while aiming at the curtain pushes it back and spends pigment. */
  private push(w: Wave, dt: number): void {
    w.pushing = false;
    w.blocked = null;
    if (!this.ctx.input.held('use')) return;
    const d = this.curtainDistance(this.ctx.player.eye, this.ctx.player.forward);
    if (d === null || d > T.pushRange) return;
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
    w.front = Math.max(0, w.front - ((T.pushSpeed * stats(this.ctx.state.growth).skill) / 100) * dt);
  }

  /**
   * How far along a ray the moving curtain is, or null when the ray misses it or no curtain is
   * up. The brush stops here, so it cannot paint walls behind the ink.
   */
  curtainDistance(eye: THREE.Vector3, forward: THREE.Vector3): number | null {
    const w = this.wave;
    if (!w || !this.curtain.visible) return null;
    const b = blockBounds(w.chunk, this.layout);
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
    if (Math.abs(d) < 1e-4) return null;
    const t = (plane - o) / d;
    if (t < 0) return null;
    const hitY = eye.y + forward.y * t;
    const hitAcross = alongX ? eye.z + forward.z * t : eye.x + forward.x * t;
    const [lo, hi] = alongX ? [b.z0, b.z1] : [b.x0, b.x1];
    return hitY >= -1 && hitY <= HEIGHT && hitAcross >= lo && hitAcross <= hi ? t : null;
  }

  private drainPassed(w: Wave): void {
    const bounds = blockBounds(w.chunk, this.layout);
    for (const i of w.order) {
      if (depthFrom(this.layout.surfaces[i]!, w.from, bounds) > w.front) break;
      if (isColored(this.states[i]!)) this.ctx.apply({ kind: 'drain', city: this.layout.id, surface: i });
    }
  }

  private dripT = 0;

  /** Ink dripping off the curtain, a few drops a second at random points along it. */
  private drip(w: Wave, dt: number): void {
    this.dripT -= dt;
    if (this.dripT > 0) return;
    this.dripT = 0.05;
    const b = blockBounds(w.chunk, this.layout);
    const along = Math.random();
    const y = 4 + Math.random() * (CURTAIN_HEIGHT - 5);
    const at =
      w.from === 0 || w.from === 2
        ? { x: w.from === 0 ? b.x1 - w.front : b.x0 + w.front, y, z: b.z0 + along * (b.z1 - b.z0) }
        : { x: b.x0 + along * (b.x1 - b.x0), y, z: w.from === 1 ? b.z1 - w.front : b.z0 + w.front };
    this.ctx.events.emit('tide:drip', { at });
  }

  private placeCurtain(w: Wave, now: number): void {
    const b = blockBounds(w.chunk, this.layout);
    const c = this.curtain.root;
    // the curtain runs along local +x and advances towards local -z: turn it to face the way
    // the wave travels, anchored at the corner where its local x starts
    switch (w.from) {
      case 0: // from the east, travelling west
        c.position.set(b.x1 - w.front, 0, b.z1);
        c.rotation.set(0, Math.PI / 2, 0);
        break;
      case 1: // from the south, travelling north
        c.position.set(b.x0, 0, b.z1 - w.front);
        c.rotation.set(0, 0, 0);
        break;
      case 2: // from the west, travelling east
        c.position.set(b.x0 + w.front, 0, b.z0);
        c.rotation.set(0, -Math.PI / 2, 0);
        break;
      default: // from the north, travelling south
        c.position.set(b.x1, 0, b.z0 + w.front);
        c.rotation.set(0, Math.PI, 0);
    }
    this.curtain.update(w.front, now);
  }

  private blockCentre(chunk: number): { x: number; y: number; z: number } {
    const b = blockBounds(chunk, this.layout);
    return { x: (b.x0 + b.x1) / 2, y: 2, z: (b.z0 + b.z1) / 2 };
  }

  private finish(w: Wave, repelled: boolean): void {
    this.wave = null;
    this.saved.wave = null;
    this.curtain.visible = false;
    this.host.clearTideMonsters();
    this.nextAt = this.ctx.state.clock + T.intervalMin + Math.random() * (T.intervalMax - T.intervalMin);
    this.saved.nextIn = this.nextAt - this.ctx.state.clock;
    const held = repelled || this.host.progress(w.chunk) >= T.holdRatio;
    this.ctx.events.emit('tide:end', { held });
    if (held) {
      this.ctx.apply({ kind: 'tideHeld', city: this.layout.id });
      this.ctx.events.emit('toast', {
        text: `${repelled ? '墨潮被推回去了' : '守住了街区'}！通用颜料 +${T.reward.generic}，墨 +${T.reward.ink}`,
        seconds: 5,
      });
    } else this.ctx.events.emit('toast', { text: '街区失守：墨潮带走了颜色', seconds: 5 });
  }

  dispose(): void {
    this.curtain.dispose();
  }
}
