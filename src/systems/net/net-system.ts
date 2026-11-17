// A client's part of a server world, once a frame: apply what the server sent (others' motion
// and patches, the clock, corrections), and send this player's motion 20 times a second. This
// player's own patches go out from ctx.apply as they happen (modes/open-world.ts). What is in
// hand rides along with the motion; attacks and skills go out as gestures for others to see.
import * as THREE from 'three';
import type { GameContext, NetApi, System } from '@/game/types';
import type { Fix } from '@/world/net/fix';
import type { Patch } from '@/world/patch';
import {
  AIMING,
  type ClientMessage,
  DASHING,
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

  keeps(town: string): boolean {
    return this.keeping.has(town);
  }

  sendPatch(patch: Patch): void {
    this.pending.add(++this.seq);
    this.conn.send({ t: 'patch', seq: this.seq, patch });
  }

  leave(): void {
    this.conn.close();
  }

  update(dt: number): void {
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
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / SEND_HZ;
    const hands = this.inHand();
    const f =
      (player.grounded ? GROUNDED : 0) |
      (player.gliding ? GLIDING : 0) |
      (player.waterMode === 'swimming' ? SWIMMING : 0) |
      (player.dashing ? DASHING : 0) |
      (hands.painting ? PAINTING : 0) |
      (hands.aiming ? AIMING : 0);
    const ref = scenes.active.ref;
    this.conn.send({
      t: 'move',
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
