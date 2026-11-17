// The world server's rules, without the sockets: who is in, each player's own things, judging
// patches against them, the clock, who runs which town's tide, and the save file. Node-safe and
// tested directly; server/main.ts wires it to WebSockets.
//
// Phase 1 of multiplayer (docs/game-design.md section 10): monsters still live on each client.
// The ink tide and erosion of a town are run by one client only, its keeper (the player who has
// been inside longest), so three players in a town do not drain it three times as fast.
import type { Look } from '@/content/characters';
import { applyPatch, type Patch, type PatchResult } from '../patch';
import { cleanName, validLook } from '../profile';
import { type SceneRef, type WorldState, deserializeWorld, savedProgress, serializeWorld } from '../state';
import { createWilderness } from '../wilderness/generator';
import { layoutCache, worldPatchContext } from './patch-context';
import { DEFAULT_MAX_PLAYERS, type Motion, type PlayerInfo, SHARED_KINDS, VIEW_RANGE } from './protocol';
import { type PlayerSlice, deserializeSlice, newSlice, serializeSlice, withSlice } from './slices';

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
}

interface SavedPlayer {
  name: string;
  look: Look;
  slice: PlayerSlice;
}

export type JoinResult =
  { readonly ok: true; readonly id: number } | { readonly ok: false; readonly reason: string };

export class WorldHost {
  private readonly members = new Map<number, Member>();
  private readonly players: Map<string, SavedPlayer>;
  private readonly patchContext;
  private nextId = 1;
  /** Seconds the host has run, for ordering arrivals. */
  private uptime = 0;
  /** Something worth saving changed since the last save. */
  dirty = false;

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
  }

  get count(): number {
    return this.members.size;
  }

  info(id: number): PlayerInfo | null {
    const m = this.members.get(id);
    return m ? { id: m.id, name: m.name, look: m.look } : null;
  }

  everyone(): PlayerInfo[] {
    return [...this.members.values()].map((m) => ({ id: m.id, name: m.name, look: m.look }));
  }

  /** Let a player in, with their own things from last time if the token is known. */
  join(token: string, name: string, look: Look): JoinResult {
    if ([...this.members.values()].some((m) => m.token === token))
      return { ok: false, reason: '这个角色已经在这个世界里了' };
    if (this.members.size >= this.max) return { ok: false, reason: `服务器已满（${this.max} 人）` };
    let saved = this.players.get(token);
    if (!saved) {
      saved = { name, look, slice: newSlice() };
      this.players.set(token, saved);
    }
    saved.name = name;
    saved.look = look;
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
    });
    this.dirty = true;
    return { ok: true, id };
  }

  leave(id: number): void {
    if (this.members.delete(id)) this.dirty = true;
  }

  move(id: number, motion: Motion, scene: SceneRef, town: string | null): void {
    const m = this.members.get(id);
    if (!m) return;
    m.motion = motion;
    if (town !== m.town) {
      m.town = town;
      m.townSince = this.uptime;
    }
    m.slice.player = { scene, x: motion.p[0], y: motion.p[1], z: motion.p[2], yaw: motion.yaw };
    // where everyone stands is worth keeping too (saves still come at most every few seconds)
    this.dirty = true;
  }

  /** Judge a player's patch against their own things and the shared world. */
  patch(id: number, patch: Patch): PatchResult & { readonly shared: boolean } {
    const m = this.members.get(id);
    if (!m) return { ok: false, reason: '不在这个世界里', shared: false };
    let result: PatchResult;
    try {
      result = withSlice(this.state, m.slice, () => applyPatch(this.state, patch, this.patchContext));
    } catch {
      // a malformed patch from a client: refuse it rather than fall over
      result = { ok: false, reason: '无法识别的操作' };
    }
    if (result.ok) this.dirty = true;
    return { ...result, shared: result.ok && SHARED_KINDS.has(patch.kind) };
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

  tick(dt: number): void {
    this.uptime += dt;
    this.state.clock += dt;
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

  /** The save file: the shared world and every player who has ever joined. */
  save(): string {
    const players: Record<string, { name: string; look: Look; slice: string }> = {};
    for (const [token, p] of this.players)
      players[token] = { name: p.name, look: p.look, slice: serializeSlice(p.slice) };
    this.dirty = false;
    return JSON.stringify({ v: 1, world: serializeWorld(this.state), players });
  }

  /** Read a save file back. Throws SaveError when the world in it is unreadable; a broken
   * player entry is skipped (that player starts fresh). */
  static load(text: string, max?: number): WorldHost {
    const raw = JSON.parse(text) as {
      world?: unknown;
      players?: Record<string, { name?: unknown; look?: unknown; slice?: unknown }>;
    };
    const state = deserializeWorld(String(raw.world));
    const players = new Map<string, SavedPlayer>();
    for (const [token, p] of Object.entries(raw.players ?? {})) {
      try {
        const look = validLook(p.look);
        if (!look) continue;
        players.set(token, { name: cleanName(p.name), look, slice: deserializeSlice(String(p.slice)) });
      } catch {
        // skip it
      }
    }
    return new WorldHost(state, players, max);
  }
}
