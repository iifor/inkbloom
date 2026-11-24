// A client's part of a server world, once a frame: apply what the server sent (others' motion
// and patches, the clock, corrections), and send this player's motion 20 times a second. This
// player's own patches go out from ctx.apply as they happen (modes/open-world.ts). What is in
// hand rides along with the motion; attacks and skills go out as gestures for others to see.
import * as THREE from 'three';
import type { GameContext, NetApi, System, FriendStatus } from '@/game/types';
import { bearing } from '@/world/objectives';
import { validTravelLeg } from '@/world/wilderness/travellers';
import type { Fix } from '@/world/net/fix';
import type { Patch } from '@/world/patch';
import {
  AIMING,
  type ClientMessage,
  DASHING,
  DOWNED,
  type FriendLocation,
  validFriendLocation,
  FLYING,
  GLIDING,
  GROUNDED,
  type Gesture,
  PAINTING,
  type PlayerInfo,
  SEND_HZ,
  type ServerMessage,
  SWIMMING,
} from '@/world/net/protocol';
import { deserializeSlice, putSlice } from '@/world/net/slices';
import { validPatch } from '@/world/net/validate';
import type { InHand } from '@/systems/tools/tool';
import type { Connection } from './connection';
import type { RemotePlayers } from './remote-players';

/** The clock jumps to the server's when this far off; closer, it eases over. */
const CLOCK_SNAP = 0.5;

export class NetSystem implements System, NetApi {
  readonly id = 'net';
  private sendT = 0;
  private seq = 0;
  /** This player's patches the server has not answered yet. */
  private readonly pending = new Set<number>();
  private keeping = new Set<string>();
  private readonly last = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private told = false;
  private directory = new Map<number, FriendLocation>();
  private directoryAt = -Infinity;
  private tracked: number | null = null;
  private visitSeq = 0;
  private visitPending: { id: number; request: number; at: number } | null = null;
  private visitUntil = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly conn: Connection,
    private readonly remote: RemotePlayers,
    /** Other players' patches, for their effect on the shared world: `apply` as they come,
     * `flush` once a frame for any that had to wait; `correct` sets the server's values. */
    private readonly remotePatches: {
      apply(patch: Patch, fix: Fix | null): void;
      flush(): void;
      correct(fix: Fix | null): void;
    },
    /** What this player has in hand (the tool belt). */
    private readonly inHand: () => InHand,
  ) {
    for (const p of conn.welcome.players) remote.add(p);
    this.last.copy(ctx.player.position);
    ctx.events.on('weapon:fired', () => this.gesture('attack'));
    ctx.events.on('weapon:skill', () => this.gesture('skill'));
  }

  /** An attack or skill for the players nearby to see. In the arena the server already passes
   * every attack on to the others as an `act` (systems/arena), so nothing more goes out. */
  private gesture(g: Gesture): void {
    if (!this.ctx.arena?.inside) this.conn.send({ t: 'gesture', g });
  }

  /** The arena's messages go here (systems/arena/arena-system.ts). */
  onArena: ((m: ServerMessage) => void) | null = null;

  get max(): number {
    return this.conn.welcome.max;
  }

  /** This player's id on the server. */
  get me(): number {
    return this.conn.welcome.id;
  }

  send(m: ClientMessage): void {
    this.conn.send(m);
  }

  get players(): readonly PlayerInfo[] {
    return this.remote.list();
  }

  get down(): string | null {
    return this.conn.closed;
  }

  private friendReason(id: number): string {
    const p = this.directory.get(id);
    if (this.down) return '连接已断开';
    if (this.ctx.arena?.inside || p?.arena) return '竞技场内不可定位或传送';
    if (!this.players.some((p) => p.id === id)) return '伙伴已离线';
    if (!p?.p || performance.now() - this.directoryAt > 5000) return '等待位置更新';
    if (!p.alive) return '伙伴正在恢复';
    return '';
  }

  private friendDetail(p: FriendLocation): string {
    if (!p.p) return '';
    const { player } = this.ctx;
    const dir = bearing(player.position, player.yaw, { x: p.p[0], z: p.p[2] });
    const distance = dir.metres >= 1000 ? `${(dir.metres / 1000).toFixed(1)} 公里` : `${dir.metres} 米`;
    const place = p.scene?.kind === 'city' ? (this.ctx.cities.byId(p.scene.id)?.name ?? '村庄') : '野外';
    const height = p.p[1] - player.position.y;
    return `${dir.arrow} ${distance} · ${place}${Math.abs(height) > 8 ? (height > 0 ? ' · 高处' : ' · 低处') : ''}`;
  }

  get friends(): readonly FriendStatus[] {
    return this.players.map((p) => {
      const blocked = this.friendReason(p.id);
      const cooldown = Math.ceil((this.visitUntil - performance.now()) / 1000);
      const reason =
        blocked ||
        (!this.ctx.combat.alive
          ? '恢复后可传送'
          : this.visitPending
            ? '正在请求传送'
            : cooldown > 0
              ? `${cooldown} 秒后可传送`
              : '');
      return {
        id: p.id,
        name: p.name,
        detail: blocked || this.friendDetail(this.directory.get(p.id)!),
        tracking: this.tracked === p.id,
        canTrack: !blocked,
        canVisit: !reason,
        reason,
      };
    });
  }

  get friendGuide(): string {
    if (this.tracked === null || this.ctx.arena?.inside || this.down) return '';
    const friend = this.players.find((p) => p.id === this.tracked);
    if (!friend) return '';
    const blocked = this.friendReason(friend.id);
    return `${friend.name} · ${blocked || this.friendDetail(this.directory.get(friend.id)!)} · P 伙伴`;
  }

  trackFriend(id: number): void {
    if (this.tracked === id) this.tracked = null;
    else if (!this.friendReason(id)) this.tracked = id;
  }

  visitFriend(id: number): boolean {
    const status = this.friends.find((p) => p.id === id);
    if (!status?.canVisit) {
      this.ctx.events.emit('toast', { text: status?.reason || '伙伴已离线' });
      return false;
    }
    const request = ++this.visitSeq;
    this.visitPending = { id, request, at: performance.now() };
    this.conn.send({ t: 'visit', target: id, request });
    return true;
  }

  private arrive(m: Extract<ServerMessage, { t: 'visit' }>): void {
    const pending = this.visitPending;
    if (!pending || pending.request !== m.request) return;
    this.visitPending = null;
    if (!m.target) {
      this.ctx.events.emit('toast', { text: String(m.reason).slice(0, 100) });
      return;
    }
    if (!validFriendLocation(m.target) || m.target.id !== pending.id || !m.target.p) return;
    this.directory.set(m.target.id, m.target);
    this.directoryAt = performance.now();
    this.visitUntil = performance.now() + 8000;
    const accepted = this.ctx.scenes.travelNear(() => {
      if (this.friendReason(pending.id) || !this.ctx.combat.alive) return null;
      const friend = this.players.find((p) => p.id === pending.id);
      const pos = this.directory.get(pending.id)?.p;
      return friend && pos ? { pos: new THREE.Vector3(...pos), name: friend.name } : null;
    });
    if (!accepted) this.ctx.events.emit('toast', { text: '当前无法传送，请稍后再试' });
  }

  keeps(town: string): boolean {
    return this.keeping.has(town);
  }

  requestTravellerPlan(trail: string): void {
    if (this.conn.welcome.travellerAI && !this.down) this.conn.send({ t: 'traveller', trail });
  }

  sendPatch(patch: Patch): void {
    this.pending.add(++this.seq);
    this.conn.send({ t: 'patch', seq: this.seq, patch });
  }

  leave(): void {
    this.conn.close();
  }

  update(dt: number): void {
    if (this.visitPending && (this.down || performance.now() - this.visitPending.at > 5000)) {
      this.visitPending = null;
      this.ctx.events.emit('toast', { text: '传送请求未完成，请检查连接后重试' });
    }
    for (const m of this.conn.take()) {
      try {
        this.handle(m);
      } catch (e) {
        // whatever a server sends, the game goes on
        console.warn('ignored a message from the server', e);
      }
    }
    this.remotePatches.flush();
    this.sendMotion(dt);
  }

  private handle(m: ServerMessage): void {
    switch (m.t) {
      case 'traveller':
        if (typeof m.trail === 'string' && validTravelLeg(m.leg))
          this.ctx.state.travellerLegs.set(m.trail, m.leg);
        break;
      case 'friends':
        if (
          Array.isArray(m.players) &&
          m.players.length <= this.max &&
          m.players.every(validFriendLocation)
        ) {
          this.directory = new Map(m.players.map((p) => [p.id, p]));
          this.directoryAt = performance.now();
        }
        break;
      case 'visit':
        this.arrive(m);
        break;
      case 'snap': {
        const off = m.clock - this.ctx.state.clock;
        this.ctx.state.clock += Math.abs(off) > CLOCK_SNAP ? off : off * 0.1;
        for (const p of m.players) this.remote.push(p.id, p);
        this.keeping = new Set(m.keeps);
        break;
      }
      case 'applied': {
        // checked like any patch from the network: a server is not trusted to send sense
        const patch = validPatch(m.patch);
        if (patch) this.remotePatches.apply(patch, m.fix);
        break;
      }
      case 'joined':
        this.remote.add(m.player);
        this.ctx.events.emit('toast', { text: `${m.player.name} 进入了这个世界` });
        break;
      case 'left': {
        const who = this.remote.list().find((p) => p.id === m.id)?.name;
        this.remote.remove(m.id);
        this.directory.delete(m.id);
        if (this.tracked === m.id) this.tracked = null;
        if (who) this.ctx.events.emit('toast', { text: `${who} 离开了` });
        break;
      }
      case 'ok':
        this.answered(m.seq, m.fix, m.you);
        break;
      case 'rejected':
        this.answered(m.seq, m.fix, m.you);
        // the tide and erosion are the game's doing, not the player's: no message for those
        if (m.kind !== 'drain' && m.kind !== 'tideHeld')
          this.ctx.events.emit('toast', {
            text: `服务器没有接受：${String(m.reason).slice(0, 60)}`,
            seconds: 3,
          });
        break;
      case 'gesture':
        this.remote.gesture(m.from, m.g);
        break;
      case 'arena':
      case 'act':
      case 'hit':
      case 'down':
      case 'spawn':
        this.onArena?.(m);
        break;
      default:
        break;
    }
  }

  /** The server's answer to one of this player's patches: its values for the shared world, and
   * this player's own things as they stand there. Those are taken only once every patch sent
   * has been answered: while some are on their way, the server's copy is missing them, and
   * taking it would undo them here (a later answer brings them, as the server has them). */
  private answered(seq: number, fix: Fix | null, you: string): void {
    this.pending.delete(seq);
    this.remotePatches.correct(fix);
    if (!this.pending.size) putSlice(this.ctx.state, deserializeSlice(you));
  }

  private sendMotion(dt: number): void {
    if (this.conn.closed && !this.told) {
      this.told = true;
      this.ctx.events.emit('toast', { text: `${this.conn.closed}（之后的进度不会保存）`, seconds: 8 });
    }

    // this player's motion; velocity from how far they moved, so no physics internals are needed
    const { player, scenes } = this.ctx;
    const p = player.position;
    if (dt > 0) this.vel.subVectors(p, this.last).divideScalar(dt);
    this.last.copy(p);
    if (this.ctx.arena?.leaving) return;
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / SEND_HZ;
    const hands = this.inHand();
    const f =
      (player.grounded ? GROUNDED : 0) |
      (player.gliding ? GLIDING : 0) |
      (player.flying ? FLYING : 0) |
      (!this.ctx.combat.alive ? DOWNED : 0) |
      (player.waterMode === 'swimming' ? SWIMMING : 0) |
      (player.dashing ? DASHING : 0) |
      (hands.painting ? PAINTING : 0) |
      (hands.aiming ? AIMING : 0);
    const ref = scenes.active.ref;
    const rest = player.restMotion;
    this.conn.send({
      t: 'move',
      ...(rest ? { rest } : {}),
      ...(hands.item ? { h: hands.item } : {}),
      p: [p.x, p.y, p.z],
      v: [this.vel.x, this.vel.y, this.vel.z],
      yaw: player.yaw,
      pitch: player.pitch,
      f,
      scene: ref,
      town: ref.kind === 'city' ? ref.id : null,
    });
  }
}
