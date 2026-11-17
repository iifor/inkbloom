// The messages between a game client and the world server, as JSON over a WebSocket. Shared by
// both sides; everything a client sends is checked here before the server looks at it.
// design: docs/game-design.md section 10
import type { Look } from '@/content/characters';
import { WEAPONS, type WeaponKey } from '@/content/weapons';
import type { ArenaMode, ArenaState } from '../arena/match';
import type { Patch } from '../patch';
import { cleanName, validLook } from '../profile';
import type { SceneRef } from '../state';
import type { Fix } from './fix';
import { validCity, validPatch, validScene } from './validate';

export const PROTOCOL = 1;
export const DEFAULT_PORT = 5195;
export const DEFAULT_MAX_PLAYERS = 10;
/** Motion updates per second, each way. */
export const SEND_HZ = 20;
/** Players farther apart than this do not get each other's motion. */
export const VIEW_RANGE = 300;

/** Motion flags. */
export const GROUNDED = 1;
export const GLIDING = 2;
export const SWIMMING = 4;
export const DASHING = 8;
/** Working a surface with the brush (or pushing back the tide's curtain). */
export const PAINTING = 16;
/** Sighting down a gun: the sniper's scope, or a skill that steadies the aim. */
export const AIMING = 32;
const FLAGS = 63;

/** What a player can have in hand for others to see: the brush or one of the weapons. The ink
 * marker and empty hands send nothing. */
export type HeldItem = 'brush' | WeaponKey;
export const HELD_ITEMS: readonly HeldItem[] = ['brush', ...WEAPONS.map((w) => w.key)];

/** Something another player does with what is in their hand, for their figure to act out
 * (the swing of a blade, a gun's recoil, a staff's cast). Outside the arena only: in the arena
 * the server already passes every attack on as an `act`. */
export type Gesture = 'attack' | 'skill';

export type Vec3 = readonly [number, number, number];

export interface PlayerInfo {
  readonly id: number;
  readonly name: string;
  readonly look: Look;
}

export interface Motion {
  readonly p: Vec3;
  readonly v: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  /** GROUNDED | GLIDING | SWIMMING | DASHING | PAINTING | AIMING */
  readonly f: number;
  /** What is in hand; absent for nothing. */
  readonly h?: HeldItem;
}

export type ClientMessage =
  | {
      readonly t: 'hello';
      readonly v: number;
      /** A random id the browser keeps, so a player gets their own things back next time. */
      readonly token: string;
      readonly name: string;
      readonly look: Look;
      /** The server's password, if it has one. */
      readonly password?: string;
    }
  /** Where the player is, 20 times a second; `town` is the town they are inside, if any. */
  | (Motion & { readonly t: 'move'; readonly scene: SceneRef; readonly town: string | null })
  /** A patch already applied locally, for the server to judge. */
  | { readonly t: 'patch'; readonly seq: number; readonly patch: Patch }
  /** Into or out of the arena, or a vote for the next round's mode. */
  | { readonly t: 'arena'; readonly a: 'join' | 'leave' | 'vote'; readonly mode?: ArenaMode }
  /** An attack or a skill outside the arena, for the players nearby to see. A few a second
   * at most (the server drops the rest). */
  | { readonly t: 'gesture'; readonly g: Gesture }
  /** In the arena: an attack or a skill, from `o` along `d`, as the player saw the world at
   * world clock `at`. The server works out what it hits. */
  | {
      readonly t: 'act';
      readonly w: WeaponKey;
      readonly k: ActKind;
      readonly o: Vec3;
      readonly d: Vec3;
      readonly at: number;
    };

/** What a weapon can do: its attack and its skill. */
export type ActKind = 'shot' | 'strike' | 'slash' | 'shell' | 'bigshell' | 'field' | 'shield' | 'focus';
export const WEAPON_ACTS: Readonly<Record<WeaponKey, readonly [attack: ActKind, skill: ActKind]>> = {
  rifle: ['shot', 'shield'],
  katana: ['strike', 'slash'],
  sniper: ['shot', 'focus'],
  launcher: ['shell', 'bigshell'],
  staff: ['shot', 'field'],
};

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly v: number;
      readonly id: number;
      readonly max: number;
      /** The shared world (serializeWorld) and this player's own things (serializeSlice). */
      readonly world: string;
      readonly you: string;
      readonly players: readonly PlayerInfo[];
    }
  /** The server will not take this player (full, a different version, or the password: then
   * `password` is set so the client can ask for it). */
  | { readonly t: 'refused'; readonly reason: string; readonly password?: boolean }
  | { readonly t: 'joined'; readonly player: PlayerInfo }
  /** Another player nearby attacked or used a skill (outside the arena). */
  | { readonly t: 'gesture'; readonly from: number; readonly g: Gesture }
  | { readonly t: 'left'; readonly id: number }
  /** The clock, nearby players' motion, and the towns this client runs the tide for. */
  | {
      readonly t: 'snap';
      readonly clock: number;
      readonly players: readonly (Motion & { readonly id: number })[];
      readonly keeps: readonly string[];
    }
  /** Another player's patch, already judged: apply its effect on the shared world, then the
   * values the server ended with. */
  | { readonly t: 'applied'; readonly from: number; readonly patch: Patch; readonly fix: Fix | null }
  /** One of this client's patches went through: the values the shared world ended with, and
   * this player's own things as the server has them. */
  | { readonly t: 'ok'; readonly seq: number; readonly fix: Fix | null; readonly you: string }
  /** One of this client's patches failed on the server: here is their true slice. */
  | {
      readonly t: 'rejected';
      readonly seq: number;
      readonly kind: Patch['kind'];
      readonly reason: string;
      readonly you: string;
      /** The true state of what it touched, to undo the early local change. */
      readonly fix: Fix | null;
    }
  /** The arena as it stands (to everyone: the menu shows it). */
  | { readonly t: 'arena'; readonly state: ArenaState }
  /** In the arena (to those in it): someone's attack, to draw; a hit; someone down; someone
   * getting up at `p` (the one getting up moves there). */
  | {
      readonly t: 'act';
      readonly from: number;
      readonly w: WeaponKey;
      readonly k: ActKind;
      readonly o: Vec3;
      readonly d: Vec3;
    }
  | {
      readonly t: 'hit';
      readonly from: number;
      readonly to: number;
      readonly amount: number;
      readonly head: boolean;
      readonly hp: number;
    }
  | { readonly t: 'down'; readonly who: number; readonly by: number; readonly w: string }
  | { readonly t: 'spawn'; readonly who: number; readonly p: Vec3; readonly yaw: number };

/** Patches that change the shared world, so other players need them. The rest only touch the
 * sender's own things. */
export const SHARED_KINDS: ReadonlySet<Patch['kind']> = new Set([
  'restore',
  'paint',
  'drain',
  'collect',
  'harvest',
  'defeat',
  'hunt',
  'request',
  'collectStock',
  'complete',
]);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Positions and speeds beyond these are not anywhere a player can be. */
const MAX_COORD = 1_000_000;
const MAX_SPEED = 500;
function vec3(v: unknown, limit: number): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => finite(x) && Math.abs(x) <= limit)) return null;
  const [x, y, z] = v as number[];
  return [x!, y!, z!];
}

/** A message from a client, checked; null when it is not one. Patches are rebuilt from their
 * known fields (validPatch); applyPatch then judges what they ask for. */
export function parseClientMessage(text: string): ClientMessage | null {
  if (text.length > 16_000) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'hello': {
      const look = validLook(m.look);
      if (!finite(m.v) || typeof m.token !== 'string' || !/^[\w-]{8,64}$/.test(m.token) || !look) return null;
      const password = typeof m.password === 'string' ? m.password.slice(0, 128) : '';
      return { t: 'hello', v: m.v, token: m.token, name: cleanName(m.name), look, password };
    }
    case 'move': {
      const p = vec3(m.p, MAX_COORD);
      const v = vec3(m.v, MAX_SPEED);
      const s = validScene(m.scene);
      if (!p || !v || !s || !finite(m.yaw) || !finite(m.pitch) || !finite(m.f)) return null;
      // empty hands, or something that can be held: anything else is not a move
      const h = m.h === undefined || m.h === null ? undefined : HELD_ITEMS.find((x) => x === m.h);
      if (h === undefined && m.h !== undefined && m.h !== null) return null;
      const town = validCity(m.town) ? m.town : null;
      const pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
      const move = {
        t: 'move',
        p,
        v,
        yaw: m.yaw % (Math.PI * 2),
        pitch,
        f: m.f & FLAGS,
        scene: s,
        town,
      } as const;
      return h ? { ...move, h } : move;
    }
    case 'gesture':
      return m.g === 'attack' || m.g === 'skill' ? { t: 'gesture', g: m.g } : null;
    case 'patch': {
      const patch = validPatch(m.patch);
      return finite(m.seq) && patch ? { t: 'patch', seq: m.seq, patch } : null;
    }
    case 'arena': {
      if (m.a !== 'join' && m.a !== 'leave' && m.a !== 'vote') return null;
      if (m.a !== 'vote') return { t: 'arena', a: m.a };
      return m.mode === 'ffa' || m.mode === 'teams' ? { t: 'arena', a: 'vote', mode: m.mode } : null;
    }
    case 'act': {
      const w = WEAPONS.find((x) => x.key === m.w)?.key;
      const o = vec3(m.o, MAX_COORD);
      const d = vec3(m.d, 2);
      if (!w || !o || !d || !finite(m.at) || !WEAPON_ACTS[w].includes(m.k as ActKind)) return null;
      // a direction, made exactly one long
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 0.5) return null;
      const unit: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
      return { t: 'act', w, k: m.k as ActKind, o, d: unit, at: m.at };
    }
    default:
      return null;
  }
}

/** A message from the server. The client trusts the server, so this only parses. */
export function parseServerMessage(text: string): ServerMessage | null {
  try {
    const m = JSON.parse(text) as ServerMessage;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}
