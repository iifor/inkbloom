// The other players in a server world, drawn with the character models. Motion arrives 20 times
// a second; each player is drawn 100 ms in the past, between the two samples around that moment,
// so they move smoothly however the packets bunch up. Their walk cycle comes from how fast
// they are going; flags say whether they are on the ground, gliding or swimming. They carry what
// they hold (the motion says what), sight down a gun or work a wall with the brush, and act out
// their attacks and skills as the gestures come in. In the arena they also flinch when hit and
// go down in ink, and wear their team's colour.
import * as THREE from 'three';
import { ENEMIES } from '@/content/enemies';
import { MonsterFigures } from '@/systems/combat/monster-figure';
import type { Body } from '@/engine/physics/world';
import { avoidPerson } from '@/engine/physics/character-contact';
import type { Look } from '@/content/characters';
import { TUNING } from '@/content/tuning';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext, System } from '@/game/types';
import { NameTags } from '@/shell/name-tags';
import { ACTION_SECONDS, PlayerFigures } from '@/systems/figures/player-figure';
import { FlightMotion } from '@/systems/figures/flight-motion';
import type { Visitor } from '@/world/npc-attention';
import {
  AIMING,
  DOWNED,
  INFECTED,
  FLYING,
  GLIDING,
  GROUNDED,
  type Gesture,
  type HeldItem,
  type Motion,
  PAINTING,
  type PlayerInfo,
  SWIMMING,
  validRest,
} from '@/world/net/protocol';

/** How far in the past others are drawn, seconds. */
const DELAY = 0.1;
/** Samples kept per player. */
const KEEP = 12;
/** Players not heard from for this long (out of range, or gone) are not drawn. */
const STALE = 2;
/** After firing, a gun stays up at the shoulder this long. */
const AIM_HOLD = 0.8;
/** How fast sighting and painting ease in and out (per second, exponential). */
const EASE = 10;

interface Sample {
  readonly t: number;
  readonly m: Motion;
}

interface Remote {
  info: PlayerInfo;
  readonly samples: Sample[];
  walk: number;
  readonly flight: FlightMotion;
  /** 1 just hit, easing to 0. */
  hurt: number;
  /** -1 standing; 0..1 going down in ink. */
  dying: number;
  /** The attack or skill being acted out: when it starts (this system's clock; a gesture is
   * played as late as the motion is drawn) and what it was done with. */
  action: { readonly kind: Gesture; readonly item: HeldItem | null; readonly start: number } | null;
  /** When they last fired, for keeping the gun up. */
  fired: number;
  aim: number;
  paint: number;
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
  const ar = a.m.rest,
    br = b.m.rest;
  const rest =
    ar || br
      ? {
          sitting: lerp(ar?.sitting ?? 0, br?.sitting ?? 0),
          lying: lerp(ar?.lying ?? 0, br?.lying ?? 0),
          groundPitch: lerp(ar?.groundPitch ?? br!.groundPitch, br?.groundPitch ?? ar!.groundPitch),
          groundRoll: lerp(ar?.groundRoll ?? br!.groundRoll, br?.groundRoll ?? ar!.groundRoll),
          yaw: angle(ar?.yaw ?? a.m.yaw, br?.yaw ?? b.m.yaw),
        }
      : undefined;
  return {
    ...(rest ? { rest } : {}),
    p: [lerp(a.m.p[0], b.m.p[0]), lerp(a.m.p[1], b.m.p[1]), lerp(a.m.p[2], b.m.p[2])],
    v: [lerp(a.m.v[0], b.m.v[0]), lerp(a.m.v[1], b.m.v[1]), lerp(a.m.v[2], b.m.v[2])],
    yaw: angle(a.m.yaw, b.m.yaw),
    pitch: lerp(a.m.pitch, b.m.pitch),
    f: b.m.f,
    h: b.m.h,
  };
}

export class RemotePlayers implements System {
  readonly id = 'remote-players';
  private readonly players = new Map<number, Remote>();
  private readonly group = new THREE.Group();
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly figures = new PlayerFigures(this.group, this.material);
  private inkFigures?: MonsterFigures;
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
        flight: new FlightMotion(),
        hurt: 0,
        dying: -1,
        action: null,
        fired: -Infinity,
        aim: 0,
        paint: 0,
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

  npcVisitors(out: Visitor[]): void {
    for (const [id, r] of this.players) {
      const motion = r.samples.at(-1)?.m;
      if (!r.drawn || r.dying >= 0 || !motion || motion.f & (DOWNED | FLYING | GLIDING | INFECTED)) continue;
      const rest = motion.rest;
      const eyeHeight = 1.5 - 0.65 * (rest?.sitting ?? 0) - 1.15 * (rest?.lying ?? 0);
      out.push({ id, x: r.at.x, y: r.at.y, z: r.at.z, eyeY: r.at.y + eyeHeight });
    }
  }

  avoidPlayers(body: Body, dt: number, me: number): void {
    for (const [id, r] of this.players) {
      const sample = r.samples.at(-1);
      if (!sample || this.t - sample.t >= STALE || r.dying >= 0 || sample.m.f & DOWNED) continue;
      const { p, rest, f } = sample.m;
      const height =
        TUNING.player.height - (f & SWIMMING ? 0.65 : (rest?.lying ?? 0) * 1.2 + (rest?.sitting ?? 0) * 0.7);
      avoidPerson(body, p[0], p[1], p[2], height, dt, me < id ? -1 : 1);
    }
  }

  flinch(id: number): void {
    const r = this.players.get(id);
    if (r) r.hurt = 1;
  }

  /** They attacked or used a skill: act it out. With `item`, it is done with that (the arena
   * says which weapon) rather than whatever their motion last said was in hand. */
  gesture(id: number, kind: Gesture, item?: HeldItem): void {
    const r = this.players.get(id);
    if (!r || r.dying >= 0 || (kind !== 'attack' && kind !== 'skill')) return;
    const start = this.t + DELAY;
    r.action = { kind, item: item ?? null, start };
    if (kind === 'attack') r.fired = start;
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
    r.action = null;
    r.flight.reset();
    r.samples.length = 0;
    r.samples.push({ t: this.t - 1, m: { p, v: [0, 0, 0], yaw, pitch: 0, f: GROUNDED } });
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
    this.inkFigures?.begin();
    for (const [id, r] of this.players) {
      const newest = r.samples[r.samples.length - 1];
      const m = newest && this.t - newest.t < STALE ? interpolate(r.samples, this.t - DELAY) : null;
      r.drawn = m !== null;
      if (!m) {
        r.flight.reset();
        this.tags.remove(id);
        continue;
      }
      r.hurt = Math.max(0, r.hurt - dt * 4);
      if (r.dying >= 0) r.dying = Math.min(1, r.dying + dt / FALL);
      r.at.x = m.p[0];
      r.at.y = m.p[1];
      r.at.z = m.p[2];
      r.at.yaw = m.yaw;
      // A teleport or a late snapshot can put the delayed figure around the lens for a frame.
      const eye = this.ctx.renderer.camera.position;
      if (
        Math.hypot(eye.x - r.at.x, eye.z - r.at.z) < 0.48 &&
        eye.y > r.at.y - 0.1 &&
        eye.y < r.at.y + TUNING.player.height + 0.35
      ) {
        this.tags.remove(id);
        continue;
      }
      const speed = Math.hypot(m.v[0], m.v[2]);
      r.flight.update(dt, (m.f & FLYING) !== 0 && r.dying < 0, m.yaw, speed, m.v[1]);
      const stride = Math.min(1.7, speed / TUNING.player.walkSpeed);
      r.walk += dt * 6 * Math.min(1.5, stride);
      const look: Look = r.accent === null ? r.info.look : { ...r.info.look, accent: r.accent };
      const swim = (m.f & SWIMMING) !== 0;
      const rest = r.dying < 0 && !(m.f & (FLYING | GLIDING | SWIMMING | DOWNED)) ? validRest(m.rest) : null;
      const resting = rest ? rest.sitting + rest.lying : 0;
      // what they act with: the weapon an arena attack named, while it plays out
      let held: HeldItem | null = m.h ?? null;
      let action: { kind: Gesture; t: number } | null = null;
      const a = r.action;
      if (a && this.t >= a.start) {
        const item = a.item ?? held;
        const seconds = item ? ACTION_SECONDS[item]?.[a.kind] : undefined;
        const k = seconds ? (this.t - a.start) / seconds : 1;
        if (k >= 1) r.action = null;
        else {
          held = item;
          action = { kind: a.kind, t: k };
        }
      }
      const sighted = (m.f & AIMING) !== 0 || this.t - r.fired < AIM_HOLD;
      const ease = 1 - Math.exp(-EASE * dt);
      r.aim += ((sighted ? 1 : 0) - r.aim) * ease;
      r.paint += (((m.f & PAINTING) !== 0 ? 1 : 0) - r.paint) * ease;
      if(m.f & INFECTED){
        if(!this.inkFigures){this.inkFigures=new MonsterFigures(this.group,this.material);this.inkFigures.begin();}
        this.inkFigures.draw(ENEMIES[0],{x:r.at.x,y:r.at.y,z:r.at.z,yaw:m.yaw,walk:r.walk,stride,air:!(m.f&GROUNDED),
          hurt:r.hurt,attack:-1,dying:r.dying,t:this.t,colors:[ENEMIES[0].eyes]});
        this.head.set(r.at.x,r.at.y+1.65,r.at.z);
        this.tags.place(id,r.info.name+' · 墨怪',this.head,r.accent);
        continue;
      }
      this.figures.draw(
        look,
        {
          x: m.p[0],
          y: m.p[1],
          z: m.p[2],
          yaw: rest?.yaw ?? m.yaw,
          pitch: m.pitch * (1 - resting),
          walk: r.walk,
          stride: swim || resting > 0.0001 ? 0 : stride,
          air: !swim && resting <= 0.0001 && (m.f & GROUNDED) === 0,
          glide: (m.f & GLIDING) !== 0,
          swim,
          flight: r.flight,
          ...(rest ? { rest } : {}),
          hurt: r.hurt,
          dying: r.dying,
          t: this.t,
          held,
          action,
          aim: r.aim,
          paint: r.paint,
        },
        this.head,
      );
      this.head.y += 0.4;
      if (r.dying >= 0) this.tags.remove(id);
      else this.tags.place(id, r.info.name, this.head, r.accent);
    }
    this.figures.end();
    this.inkFigures?.end();
  }

  dispose(): void {
    this.inkFigures?.dispose();
    this.figures.dispose();
    this.material.dispose();
    this.group.removeFromParent();
    this.tags.dispose();
  }
}
