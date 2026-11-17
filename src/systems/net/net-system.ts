// A client's part of a server world, once a frame: apply what the server sent (others' motion
// and patches, the clock, corrections), and send this player's motion 20 times a second. This
// player's own patches go out from ctx.apply as they happen (modes/open-world.ts).
import * as THREE from 'three';
import type { GameContext, NetApi, System } from '@/game/types';
import type { Patch } from '@/world/patch';
import { DASHING, GLIDING, GROUNDED, type PlayerInfo, SEND_HZ, SWIMMING } from '@/world/net/protocol';
import { deserializeSlice, putSlice } from '@/world/net/slices';
import type { Connection } from './connection';
import type { RemotePlayers } from './remote-players';

/** The clock jumps to the server's when this far off; closer, it eases over. */
const CLOCK_SNAP = 0.5;

export class NetSystem implements System, NetApi {
  readonly id = 'net';
  private sendT = 0;
  private seq = 0;
  private keeping = new Set<string>();
  private readonly last = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private told = false;

  constructor(
    private readonly ctx: GameContext,
    private readonly conn: Connection,
    private readonly remote: RemotePlayers,
    /** Run another player's patch for its effect on the shared world. */
    private readonly applyRemote: (patch: Patch) => void,
  ) {
    for (const p of conn.welcome.players) remote.add(p);
    this.last.copy(ctx.player.position);
  }

  get max(): number {
    return this.conn.welcome.max;
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
    this.conn.send({ t: 'patch', seq: ++this.seq, patch });
  }

  leave(): void {
    this.conn.close();
  }

  update(dt: number): void {
    for (const m of this.conn.take()) {
      switch (m.t) {
        case 'snap': {
          const off = m.clock - this.ctx.state.clock;
          this.ctx.state.clock += Math.abs(off) > CLOCK_SNAP ? off : off * 0.1;
          for (const p of m.players) this.remote.push(p.id, p);
          this.keeping = new Set(m.keeps);
          break;
        }
        case 'applied':
          this.applyRemote(m.patch);
          break;
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
        case 'rejected':
          // the server knows best: take its word for this player's own things
          putSlice(this.ctx.state, deserializeSlice(m.you));
          this.ctx.events.emit('toast', { text: `服务器没有接受：${m.reason}`, seconds: 3 });
          break;
        default:
          break;
      }
    }
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
    const f =
      (player.grounded ? GROUNDED : 0) |
      (player.gliding ? GLIDING : 0) |
      (player.waterMode === 'swimming' ? SWIMMING : 0) |
      (player.dashing ? DASHING : 0);
    const ref = scenes.active.ref;
    this.conn.send({
      t: 'move',
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
