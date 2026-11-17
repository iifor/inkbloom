// The messages between a game client and the world server, as JSON over a WebSocket. Shared by
// both sides; everything a client sends is checked here before the server looks at it.
// design: docs/game-design.md section 10
import type { Look } from '@/content/characters';
import type { Patch } from '../patch';
import { cleanName, validLook } from '../profile';
import type { SceneRef } from '../state';

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
  /** GROUNDED | GLIDING | SWIMMING | DASHING */
  readonly f: number;
}

export type ClientMessage =
  | {
      readonly t: 'hello';
      readonly v: number;
      /** A random id the browser keeps, so a player gets their own things back next time. */
      readonly token: string;
      readonly name: string;
      readonly look: Look;
    }
  /** Where the player is, 20 times a second; `town` is the town they are inside, if any. */
  | (Motion & { readonly t: 'move'; readonly scene: SceneRef; readonly town: string | null })
  /** A patch already applied locally, for the server to judge. */
  | { readonly t: 'patch'; readonly seq: number; readonly patch: Patch };

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
  /** The server will not take this player (full, or a different version). */
  | { readonly t: 'refused'; readonly reason: string }
  | { readonly t: 'joined'; readonly player: PlayerInfo }
  | { readonly t: 'left'; readonly id: number }
  /** The clock, nearby players' motion, and the towns this client runs the tide for. */
  | {
      readonly t: 'snap';
      readonly clock: number;
      readonly players: readonly (Motion & { readonly id: number })[];
      readonly keeps: readonly string[];
    }
  /** Another player's patch, already judged: apply its effect on the shared world. */
  | { readonly t: 'applied'; readonly from: number; readonly patch: Patch }
  /** One of this client's patches failed on the server: here is their true slice. */
  | { readonly t: 'rejected'; readonly seq: number; readonly reason: string; readonly you: string };

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

/** Patches a client may not send: they hand out things without earning them. */
const FORBIDDEN: ReadonlySet<string> = new Set(['grant']);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) return null;
  const [x, y, z] = v as number[];
  return [x!, y!, z!];
}

function scene(v: unknown): SceneRef | null {
  const s = v as { kind?: unknown; id?: unknown } | null;
  if (s?.kind === 'wild') return { kind: 'wild' };
  if (s?.kind === 'city' && typeof s.id === 'string' && s.id.length < 40) return { kind: 'city', id: s.id };
  return null;
}

/** A message from a client, checked; null when it is not one. Patches are only checked for
 * shape here: applyPatch judges what they ask for. */
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
      return { t: 'hello', v: m.v, token: m.token, name: cleanName(m.name), look };
    }
    case 'move': {
      const p = vec3(m.p);
      const v = vec3(m.v);
      const s = scene(m.scene);
      if (!p || !v || !s || !finite(m.yaw) || !finite(m.pitch) || !finite(m.f)) return null;
      const town = typeof m.town === 'string' && m.town.length < 40 ? m.town : null;
      return { t: 'move', p, v, yaw: m.yaw, pitch: m.pitch, f: m.f | 0, scene: s, town };
    }
    case 'patch': {
      const patch = m.patch as { kind?: unknown } | null;
      if (!finite(m.seq) || !patch || typeof patch.kind !== 'string' || FORBIDDEN.has(patch.kind))
        return null;
      return { t: 'patch', seq: m.seq, patch: patch as Patch };
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
