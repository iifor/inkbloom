// The other players in a server world, drawn with the character models. Motion arrives 20 times
// a second; each player is drawn 100 ms in the past, between the two samples around that moment,
// so they move smoothly however the packets bunch up. Their walk cycle comes from how fast
// they are going; flags say whether they are on the ground, gliding or swimming. In the arena
// they also flinch when hit and go down in ink, and wear their team's colour.
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
  /** 1 just hit, easing to 0. */
  hurt: number;
  /** -1 standing; 0..1 going down in ink. */
  dying: number;
  /** A team colour over their own accent, or null. */
  accent: number | null;
  /** Where they are drawn this frame (feet), followed by hit markers and health bars. */
  readonly at: { x: number; y: number; z: number; yaw: number };
  drawn: boolean;
}

/** Seconds to go all the way down in ink. */
const FALL = 1.2;

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
  private readonly material = makeInkMaterial({ cloth: true });
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
    else
      this.players.set(info.id, {
        info,
        samples: [],
        walk: Math.random() * 6,
        hurt: 0,
        dying: -1,
        accent: null,
        at: { x: 0, y: 0, z: 0, yaw: 0 },
        drawn: false,
      });
  }

  /** Where a player is drawn now (feet), or null when they are not drawn. Live: the same
   * object moves with them. */
  where(id: number): { readonly x: number; readonly y: number; readonly z: number } | null {
    const r = this.players.get(id);
    return r?.drawn ? r.at : null;
  }

  /** Who is drawn, standing, right now. */
  standing(): number[] {
    return [...this.players].filter(([, r]) => r.drawn && r.dying < 0).map(([id]) => id);
  }

  flinch(id: number): void {
    const r = this.players.get(id);
    if (r) r.hurt = 1;
  }

  fall(id: number): void {
    const r = this.players.get(id);
    if (r && r.dying < 0) r.dying = 0;
  }

  /** Up again at `p`: drawn there at once, not sliding over from where they fell. */
  rise(id: number, p: readonly [number, number, number], yaw: number): void {
    const r = this.players.get(id);
    if (!r) return;
    r.dying = -1;
    r.hurt = 0;
    const last = r.samples[r.samples.length - 1]?.m;
    r.samples.length = 0;
    r.samples.push({ t: this.t - 1, m: { p, v: [0, 0, 0], yaw, pitch: 0, f: last?.f ?? 1 } });
  }

  setAccent(id: number, accent: number | null): void {
    const r = this.players.get(id);
    if (r) r.accent = accent;
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
      r.drawn = m !== null;
      if (!m) {
        this.tags.remove(id);
        continue;
      }
      r.hurt = Math.max(0, r.hurt - dt * 4);
      if (r.dying >= 0) r.dying = Math.min(1, r.dying + dt / FALL);
      r.at.x = m.p[0];
      r.at.y = m.p[1];
      r.at.z = m.p[2];
      r.at.yaw = m.yaw;
      const speed = Math.hypot(m.v[0], m.v[2]);
      const stride = Math.min(1.7, speed / TUNING.player.walkSpeed);
      r.walk += dt * 6 * Math.min(1.5, stride);
      const look: Look = r.accent === null ? r.info.look : { ...r.info.look, accent: r.accent };
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
        hurt: r.hurt,
        dying: r.dying,
        t: this.t,
      });
      if (r.dying >= 0) this.tags.remove(id);
      else
        this.tags.place(
          id,
          r.info.name,
          this.head.set(m.p[0], m.p[1] + (swim ? 1.1 : 2.05), m.p[2]),
          r.accent,
        );
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
