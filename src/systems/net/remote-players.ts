// The other players in a server world, drawn with the character models. Motion arrives 20 times
// a second; each player is drawn 100 ms in the past, between the two samples around that moment,
// so they move smoothly however the packets bunch up. Their walk cycle comes from how fast
// they are going; flags say whether they are on the ground, gliding or swimming.
import * as THREE from 'three';
import type { Look } from '@/content/characters';
import { TUNING } from '@/content/tuning';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext, System } from '@/game/types';
import { NameTags } from '@/shell/name-tags';
import { PlayerFigures } from '@/systems/figures/player-figure';
import { GLIDING, GROUNDED, type Motion, type PlayerInfo, SWIMMING } from '@/world/net/protocol';

/** How far in the past others are drawn, seconds. */
const DELAY = 0.1;
/** Samples kept per player. */
const KEEP = 12;
/** Players not heard from for this long (out of range, or gone) are not drawn. */
const STALE = 2;

interface Sample {
  readonly t: number;
  readonly m: Motion;
}

interface Remote {
  info: PlayerInfo;
  readonly samples: Sample[];
  walk: number;
}

/** The motion between two samples at time t (positions and angles eased, flags from the later). */
export function interpolate(samples: readonly Sample[], t: number): Motion | null {
  if (!samples.length) return null;
  const last = samples[samples.length - 1]!;
  if (t >= last.t) return last.m;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1]!.t > t) i--;
  if (i === 0) return samples[0]!.m;
  const a = samples[i - 1]!;
  const b = samples[i]!;
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const lerp = (x: number, y: number): number => x + (y - x) * k;
  const angle = (x: number, y: number): number => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * k;
  return {
    p: [lerp(a.m.p[0], b.m.p[0]), lerp(a.m.p[1], b.m.p[1]), lerp(a.m.p[2], b.m.p[2])],
    v: [lerp(a.m.v[0], b.m.v[0]), lerp(a.m.v[1], b.m.v[1]), lerp(a.m.v[2], b.m.v[2])],
    yaw: angle(a.m.yaw, b.m.yaw),
    pitch: lerp(a.m.pitch, b.m.pitch),
    f: b.m.f,
  };
}

export class RemotePlayers implements System {
  readonly id = 'remote-players';
  private readonly players = new Map<number, Remote>();
  private readonly group = new THREE.Group();
  private readonly material = makeInkMaterial();
  private readonly figures = new PlayerFigures(this.group, this.material);
  private readonly tags: NameTags;
  private readonly head = new THREE.Vector3();
  private t = 0;

  constructor(
    private readonly ctx: GameContext,
    overlay: HTMLElement,
  ) {
    this.tags = new NameTags(ctx, overlay);
  }

  /** Everyone in the world but this player, for the menu. */
  list(): PlayerInfo[] {
    return [...this.players.values()].map((r) => r.info);
  }

  add(info: PlayerInfo): void {
    const r = this.players.get(info.id);
    if (r) r.info = info;
    else this.players.set(info.id, { info, samples: [], walk: Math.random() * 6 });
  }

  remove(id: number): void {
    this.players.delete(id);
    this.tags.remove(id);
  }

  /** A motion sample for one player, as it arrived. */
  push(id: number, m: Motion): void {
    const r = this.players.get(id);
    if (!r) return;
    r.samples.push({ t: this.t, m });
    if (r.samples.length > KEEP) r.samples.shift();
  }

  update(dt: number): void {
    this.t += dt;
    const root = this.ctx.scenes.active.root;
    if (this.group.parent !== root) root.add(this.group);
    this.figures.begin();
    for (const [id, r] of this.players) {
      const newest = r.samples[r.samples.length - 1];
      const m = newest && this.t - newest.t < STALE ? interpolate(r.samples, this.t - DELAY) : null;
      if (!m) {
        this.tags.remove(id);
        continue;
      }
      const speed = Math.hypot(m.v[0], m.v[2]);
      const stride = Math.min(1.7, speed / TUNING.player.walkSpeed);
      r.walk += dt * 6 * Math.min(1.5, stride);
      const look: Look = r.info.look;
      const swim = (m.f & SWIMMING) !== 0;
      this.figures.draw(look, {
        x: m.p[0],
        y: m.p[1],
        z: m.p[2],
        yaw: m.yaw,
        pitch: m.pitch,
        walk: r.walk,
        stride: swim ? 0 : stride,
        air: !swim && (m.f & GROUNDED) === 0,
        glide: (m.f & GLIDING) !== 0,
        swim,
        hurt: 0,
        dying: -1,
        t: this.t,
      });
      this.tags.place(id, r.info.name, this.head.set(m.p[0], m.p[1] + (swim ? 1.1 : 2.05), m.p[2]));
    }
    this.figures.end();
  }

  dispose(): void {
    this.figures.dispose();
    this.material.dispose();
    this.group.removeFromParent();
    this.tags.dispose();
  }
}
