// The world server's rules, without the sockets: who is in, each player's own things, judging
// patches against them, the clock, who runs which town's tide, and the save file. Node-safe and
// tested directly; server/serve.ts wires it to WebSockets.
//
// Phase 1 of multiplayer (docs/game-design.md section 10): monsters still live on each client.
// The ink tide and erosion of a town are run by one client only, its keeper (the player who has
// been inside longest), so three players in a town do not drain it three times as fast.
//
// A client is not trusted beyond what it may do (messages are checked in protocol.ts and
// validate.ts first): it may only act near where it stands, only a town's keeper may drain it or
// claim its tide, and a patch that fails leaves nothing behind.
import type { Look } from '@/content/characters';
import { applyPatch, type Patch, type PatchResult } from '../patch';
import { DRAINED } from '../paint/surfaces';
import { cleanName, validLook } from '../profile';
import {
  type CitySave,
  type SceneRef,
  type WorldState,
  deserializeWorld,
  savedProgress,
  serializeWorld,
} from '../state';
import { createWilderness } from '../wilderness/generator';
import { ArenaHost, type Outgoing } from './arena-host';
import { layoutCache, worldPatchContext } from './patch-context';
import { DEFAULT_MAX_PLAYERS, type Motion, type PlayerInfo, SHARED_KINDS, VIEW_RANGE } from './protocol';
import { type PlayerSlice, deserializeSlice, newSlice, serializeSlice, withSlice } from './slices';
import { type Fix, cityFix } from './fix';
import { placeOf } from './validate';

/** A patch must act within this distance of where its sender stands, metres. */
export const NEAR = 600;
/** Players remembered in the save; past this the longest-unseen is forgotten. */
export const MAX_SAVED_PLAYERS = 500;
/** Shortest time between two held tides in one town, seconds of play. */
export const TIDE_GAP = 120;
/** Drains one keeper may send: a burst, then this many a second. */
const DRAIN_BURST = 60;
const DRAIN_RATE = 20;
/** Gestures (attacks and skills, to be seen) one player may send: a burst, then this many a
 * second. The rifle fires 9 times a second; more than this is not anyone playing. */
const GESTURE_BURST = 12;
const GESTURE_RATE = 12;
/** Different towns one player may act in within TOWN_WINDOW seconds. Working out a town the
 * server has not seen costs a noticeable moment, so nobody may make it do that over and over. */
const TOWN_BUDGET = 8;
const TOWN_WINDOW = 60;

interface Member {
  readonly id: number;
  readonly token: string;
  name: string;
  look: Look;
  readonly slice: PlayerSlice;
  motion: Motion | null;
  town: string | null;
  /** When they came into `town` (host clock), for picking keepers. */
  townSince: number;
  /** Drains they may still send right now (refills at DRAIN_RATE). */
  drains: number;
  /** Gestures they may still send right now (refills at GESTURE_RATE). */
  gestures: number;
  /** Towns acted in lately -> host uptime of the last time. */
  readonly towns: Map<string, number>;
}

interface SavedPlayer {
  name: string;
  look: Look;
  slice: PlayerSlice;
  /** World clock when they were last here, for forgetting the longest-gone first. */
  seen: number;
}

export type JoinResult =
  | {
      readonly ok: true;
      readonly id: number;
      /** The same player's older connection, now replaced (a dropped one that never closed). */
      readonly replaced: number | null;
    }
  | { readonly ok: false; readonly reason: string };

export type PatchOutcome = PatchResult & {
  readonly shared: boolean;
  /** The values the shared world ended with: what the patch changed if it went through, or
   * the true state of what it touched if not (so the sender can undo its early local change). */
  readonly fix: Fix | null;
};

export class WorldHost {
  private readonly members = new Map<number, Member>();
  private readonly players: Map<string, SavedPlayer>;
  private readonly patchContext;
  /** Town id -> world clock when its last tide was held. */
  private readonly tidesHeld = new Map<string, number>();
  private nextId = 1;
  /** Seconds the host has run, for ordering arrivals. */
  private uptime = 0;
  /** Something worth saving changed since the last save. */
  dirty = false;
  /** The arena (PvP), on the same clock. */
  readonly arena: ArenaHost;
  /** Arena messages from things that happened outside a message (someone dropping out), to go
   * out with the next tick. */
  private outbox: Outgoing[] = [];

  constructor(
    readonly state: WorldState,
    players: Map<string, SavedPlayer> = new Map(),
    readonly max = DEFAULT_MAX_PLAYERS,
  ) {
    this.players = players;
    const wilderness = createWilderness(state.seed);
    this.patchContext = worldPatchContext(wilderness, layoutCache(wilderness), (id) =>
      savedProgress(this.state, id),
    );
    this.arena = new ArenaHost(wilderness, () => this.state.clock);
  }

  get count(): number {
    return this.members.size;
  }

  /** Players in the save (online or not). */
  get remembered(): number {
    return this.players.size;
  }

  info(id: number): PlayerInfo | null {
    const m = this.members.get(id);
    return m ? { id: m.id, name: m.name, look: m.look } : null;
  }

  everyone(): PlayerInfo[] {
    return [...this.members.values()].map((m) => ({ id: m.id, name: m.name, look: m.look }));
  }

  /**
   * Let a player in, with their own things from last time if the token is known. The same
   * token already online is taken to be a dropped connection that never closed: the new one
   * replaces it.
   */
  join(token: string, name: string, look: Look): JoinResult {
    const old = [...this.members.values()].find((m) => m.token === token);
    if (old) this.leave(old.id);
    if (this.members.size >= this.max) return { ok: false, reason: `服务器已满（${this.max} 人）` };
    let saved = this.players.get(token);
    if (!saved) {
      this.forgetOldest();
      saved = { name, look, slice: newSlice(), seen: this.state.clock };
      this.players.set(token, saved);
    }
    saved.name = name;
    saved.look = look;
    saved.seen = this.state.clock;
    const id = this.nextId++;
    this.members.set(id, {
      id,
      token,
      name,
      look,
      slice: saved.slice,
      motion: null,
      town: null,
      townSince: 0,
      drains: DRAIN_BURST,
      gestures: GESTURE_BURST,
      towns: new Map(),
    });
    this.dirty = true;
    return { ok: true, id, replaced: old?.id ?? null };
  }

  /** Make room for one more remembered player: forget whoever has been away longest. */
  private forgetOldest(): void {
    if (this.players.size < MAX_SAVED_PLAYERS) return;
    const online = new Set([...this.members.values()].map((m) => m.token));
    let oldest: string | null = null;
    let seen = Infinity;
    for (const [token, p] of this.players)
      if (!online.has(token) && p.seen < seen) {
        seen = p.seen;
        oldest = token;
      }
    if (oldest) this.players.delete(oldest);
  }

  leave(id: number): void {
    const m = this.members.get(id);
    if (!m) return;
    const saved = this.players.get(m.token);
    if (saved) saved.seen = this.state.clock;
    this.members.delete(id);
    this.outbox.push(...this.arena.leave(id));
    this.dirty = true;
  }

  move(id: number, motion: Motion, scene: SceneRef, town: string | null): void {
    const m = this.members.get(id);
    if (!m) return;
    m.motion = motion;
    // a town a player claims to be in has to be where they stand (it makes them its keeper)
    const inTown = town !== null && this.near(motion, { kind: 'complete', city: town }) ? town : null;
    if (inTown !== m.town) {
      m.town = inTown;
      m.townSince = this.uptime;
    }
    m.slice.player = { scene, x: motion.p[0], y: motion.p[1], z: motion.p[2], yaw: motion.yaw };
    this.arena.track(id, motion.p);
    // where everyone stands is worth keeping too (saves still come at most every few seconds)
    this.dirty = true;
  }

  /** Whether a patch acts within reach of where this motion stands. */
  private near(motion: Motion | null, patch: Patch): boolean {
    const place = placeOf(patch);
    if (!place) return true;
    if (!motion) return false;
    return Math.hypot(place.x - motion.p[0], place.z - motion.p[2]) <= NEAR;
  }

  /** The true state of whatever this patch touches in the shared world. */
  private truth(patch: Patch): Fix | null {
    const city = 'city' in patch ? this.state.cities.get(patch.city) : undefined;
    const fix: { -readonly [K in keyof Fix]?: Fix[K] } = {};
    if (city && 'city' in patch) fix.city = cityFix(patch.city, undefined, city);
    if (patch.kind === 'harvest' && this.state.harvested.has(patch.source))
      fix.harvested = [[patch.source, this.state.harvested.get(patch.source)!]];
    // always: a kill the server would not take has to come back to life on the client (an ink
    // well's guard left dead there would let it try to cleanse the well for a quarter of an hour)
    if (patch.kind === 'hunt') fix.hunted = [[patch.monster, this.state.hunted.get(patch.monster) ?? null]];
    // always: a client that cleansed a well the server would not has to put it back
    if (patch.kind === 'cleanse') fix.cleansed = [[patch.well, this.state.cleansed.get(patch.well) ?? null]];
    return Object.keys(fix).length ? fix : null;
  }

  /** Judge a player's patch against their own things and the shared world. */
  patch(id: number, patch: Patch): PatchOutcome {
    const fail = (reason: string): PatchOutcome => ({
      ok: false,
      reason,
      shared: false,
      fix: this.truth(patch),
    });
    const m = this.members.get(id);
    if (!m) return fail('不在这个世界里');
    if (!this.near(m.motion, patch)) return fail('离那里太远了');
    if ('city' in patch && !this.townAllowed(m, patch.city)) return fail('一下子去了太多城');
    if (patch.kind === 'drain' || patch.kind === 'tideHeld') {
      // the town's tide and erosion are its keeper's to run
      if (this.keepers().get(patch.city) !== id) return fail('只有这座城的看守能这样做');
    }
    if (patch.kind === 'drain') {
      if (m.drains < 1) return fail('抽色太快了');
      if ((this.state.cities.get(patch.city)?.states[patch.surface] ?? DRAINED) === DRAINED)
        return fail('已经没有颜色了');
      m.drains -= 1;
    }
    if (patch.kind === 'tideHeld') {
      const last = this.tidesHeld.get(patch.city);
      if (last !== undefined && this.state.clock - last < TIDE_GAP) return fail('刚守住过一波墨潮');
    }
    const { result, cityBefore } = this.attempt(m, patch);
    if (!result.ok) return fail(result.reason);
    if (patch.kind === 'tideHeld') this.tidesHeld.set(patch.city, this.state.clock);
    this.dirty = true;
    // what the shared world ended with (stamped with the server's clock, where it matters)
    const fix: { -readonly [K in keyof Fix]?: Fix[K] } = {};
    const city = 'city' in patch ? this.state.cities.get(patch.city) : undefined;
    if (city && 'city' in patch) {
      const c = cityFix(patch.city, cityBefore, city);
      if (c) fix.city = c;
    }
    if (patch.kind === 'harvest') fix.harvested = [[patch.source, this.state.harvested.get(patch.source)!]];
    if (patch.kind === 'hunt') fix.hunted = [[patch.monster, this.state.hunted.get(patch.monster)!]];
    if (patch.kind === 'cleanse') fix.cleansed = [[patch.well, this.state.cleansed.get(patch.well)!]];
    return { ok: true, shared: SHARED_KINDS.has(patch.kind), fix: Object.keys(fix).length ? fix : null };
  }

  /** Whether this player may act in this town now (see TOWN_BUDGET); remembers it if so. */
  private townAllowed(m: Member, town: string): boolean {
    for (const [t, when] of m.towns) if (this.uptime - when > TOWN_WINDOW) m.towns.delete(t);
    if (!m.towns.has(town) && m.towns.size >= TOWN_BUDGET) return false;
    m.towns.set(town, this.uptime);
    return true;
  }

  /** Run a patch so that it either fully happens or leaves nothing behind (not even a half-paid
   * reward from one that threw partway). */
  private attempt(m: Member, patch: Patch): { result: PatchResult; cityBefore: CitySave | undefined } {
    const slice = structuredClone(m.slice);
    const city = 'city' in patch ? patch.city : null;
    const citySave = city ? this.state.cities.get(city) : undefined;
    const cityBefore = citySave ? structuredClone(citySave) : undefined;
    const timed =
      patch.kind === 'harvest'
        ? { map: this.state.harvested, key: patch.source }
        : patch.kind === 'hunt'
          ? { map: this.state.hunted, key: patch.monster }
          : patch.kind === 'cleanse'
            ? { map: this.state.cleansed, key: patch.well }
            : null;
    const timedBefore = timed?.map.get(timed.key);
    let result: PatchResult;
    try {
      result = withSlice(this.state, m.slice, () => applyPatch(this.state, patch, this.patchContext));
    } catch {
      result = { ok: false, reason: '无法识别的操作' };
    }
    if (!result.ok) {
      Object.assign(m.slice, slice);
      if (city) {
        if (cityBefore) this.state.cities.set(city, cityBefore);
        else this.state.cities.delete(city);
      }
      if (timed) {
        if (timedBefore === undefined) timed.map.delete(timed.key);
        else timed.map.set(timed.key, timedBefore);
      }
    }
    return { result, cityBefore };
  }

  /** A player's own things as text (sent to them on joining, or to correct them). */
  sliceOf(id: number): string | null {
    const m = this.members.get(id);
    return m ? serializeSlice(m.slice) : null;
  }

  /** The shared world as text, for a joining player. */
  world(): string {
    return serializeWorld(this.state);
  }

  /** Time passes. Returns the arena's messages (rounds starting and ending, players getting up,
   * ink circles biting). */
  tick(dt: number): Outgoing[] {
    this.uptime += dt;
    this.state.clock += dt;
    for (const m of this.members.values()) {
      m.drains = Math.min(DRAIN_BURST, m.drains + DRAIN_RATE * dt);
      m.gestures = Math.min(GESTURE_BURST, m.gestures + GESTURE_RATE * dt);
    }
    const out = [...this.outbox, ...this.arena.tick()];
    this.outbox = [];
    return out;
  }

  /** Town id -> the player who runs its tide and erosion: whoever has been inside longest. */
  keepers(): Map<string, number> {
    const out = new Map<string, { id: number; since: number }>();
    for (const m of this.members.values()) {
      if (!m.town) continue;
      const k = out.get(m.town);
      if (!k || m.townSince < k.since || (m.townSince === k.since && m.id < k.id))
        out.set(m.town, { id: m.id, since: m.townSince });
    }
    return new Map([...out].map(([town, k]) => [town, k.id]));
  }

  /** The other players near this one, with their latest motion. */
  nearby(id: number): (Motion & { id: number })[] {
    const me = this.members.get(id)?.motion;
    if (!me) return [];
    const out: (Motion & { id: number })[] = [];
    for (const m of this.members.values()) {
      if (m.id === id || !m.motion) continue;
      const d = Math.hypot(m.motion.p[0] - me.p[0], m.motion.p[2] - me.p[2]);
      if (d <= VIEW_RANGE) out.push({ id: m.id, ...m.motion });
    }
    return out;
  }

  /** Who gets to see this player's gesture: the players near them, or nobody when they send
   * too many. The server only passes it on; nothing about it is judged. */
  gesture(id: number): number[] {
    const m = this.members.get(id);
    if (!m || m.gestures < 1) return [];
    m.gestures -= 1;
    return this.nearby(id).map((o) => o.id);
  }

  /** The save file: the shared world and every player remembered. */
  save(): string {
    const players: Record<string, { name: string; look: Look; slice: string; seen: number }> = {};
    for (const [token, p] of this.players)
      players[token] = { name: p.name, look: p.look, slice: serializeSlice(p.slice), seen: p.seen };
    this.dirty = false;
    return JSON.stringify({ v: 1, world: serializeWorld(this.state), players });
  }

  /** Read a save file back. Throws SaveError when the world in it is unreadable; a broken
   * player entry is skipped (that player starts fresh). */
  static load(text: string, max?: number): WorldHost {
    const raw = JSON.parse(text) as {
      world?: unknown;
      players?: Record<string, { name?: unknown; look?: unknown; slice?: unknown; seen?: unknown }>;
    };
    const state = deserializeWorld(String(raw.world));
    const players = new Map<string, SavedPlayer>();
    for (const [token, p] of Object.entries(raw.players ?? {})) {
      if (players.size >= MAX_SAVED_PLAYERS) break;
      try {
        const look = validLook(p.look);
        if (!look || !/^[\w-]{8,64}$/.test(token)) continue;
        const seen = typeof p.seen === 'number' && Number.isFinite(p.seen) ? p.seen : 0;
        players.set(token, { name: cleanName(p.name), look, slice: deserializeSlice(String(p.slice)), seen });
      } catch {
        // skip it
      }
    }
    return new WorldHost(state, players, max);
  }
}
