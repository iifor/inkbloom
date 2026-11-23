// The arena on this client (online only): the place itself (a ring of ink wall and stone cover
// round a stretch of wilderness), going in and out, and the fight as the server tells it.
//
// The server decides every hit (world/net/arena-host.ts). Here the other players are only
// targets for the feel of it: a shot that lands on someone shows its hit marker and hitstop at
// once, as against a monster; the damage, the falls and getting up come from the server.
// design: docs/game-design.md section 9.4
import * as THREE from 'three';
import { ARENA } from '@/content/arena';
import { color } from '@/content/palette';
import type { WeaponKey } from '@/content/weapons';
import { makeInkMaterial, shared } from '@/engine/render/ink-material';
import type { ArenaApi, GameContext, System, TargetHit, TargetSource } from '@/game/types';
import { bodyBox, chest, headBox, rayBox } from '@/world/arena/hits';
import type { ArenaMode, ArenaState, Team } from '@/world/arena/match';
import { type ArenaSite, findArenaSite } from '@/world/arena/site';
import { type ActKind, type ServerMessage, type Vec3, WEAPON_ACTS } from '@/world/net/protocol';
import type { NetSystem } from '@/systems/net/net-system';
import type { RemotePlayers } from '@/systems/net/remote-players';
import type { WeaponSlot } from '@/systems/tools/weapons';
import type { WildScene } from '@/systems/wilderness/wild-scene';
import { buildArena } from './arena-build';

/** Team colours, over each player's own accent. */
export const TEAM_COLORS = [color('red'), color('blue')] as const;
export const TEAM_NAMES = ['红队', '蓝队'] as const;
/** Lines kept in the kill feed, and how long each shows. */
const FEED = 5;
const FEED_SECONDS = 6;

const v3 = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v[0], v[1], v[2]);

export class ArenaSystem implements System, ArenaApi {
  readonly id = 'arena';
  readonly site: ArenaSite;
  state: ArenaState | null = null;
  /** Recent falls, newest last, for the HUD. */
  readonly feed: { text: string; mine: boolean; t: number }[] = [];
  private back: { pos: THREE.Vector3; yaw: number } | null = null;
  /** When the last state arrived (this system's clock), to count its seconds down. */
  private stateAt = 0;
  private wasInside = false;
  leaving = false;
  private safe: { pos: THREE.Vector3; yaw: number } | null = null;
  private t = 0;
  private stopTargets: (() => void) | null = null;
  private readonly root = new THREE.Group();
  private readonly material = makeInkMaterial();

  constructor(
    private readonly ctx: GameContext,
    private readonly net: NetSystem,
    private readonly remote: RemotePlayers,
    private readonly wild: WildScene,
    private readonly weapons: WeaponSlot,
  ) {
    this.site = findArenaSite(ctx.wilderness);
    // the arena is in full colour, whatever the towns round it look like
    shared.uArena.value.set(this.site.x, this.site.z, this.site.radius, 1);
    this.build();
    net.onArena = (m) => this.handle(m);
  }

  get me(): number {
    return this.net.me;
  }

  get inside(): boolean {
    return this.state?.members.some((m) => m.id === this.me) ?? false;
  }

  /** Seconds left in the current phase, counted down since the server said. */
  secondsLeft(): number {
    return this.state ? Math.max(0, this.state.left - (this.t - this.stateAt)) : 0;
  }

  teamOf(id: number): Team {
    if (this.state?.mode !== 'teams') return -1;
    return this.state.members.find((m) => m.id === id)?.team ?? -1;
  }

  /** The name of a player (this one or another). */
  nameOf(id: number): string {
    if (id === this.me) return '你';
    return this.remote.list().find((p) => p.id === id)?.name ?? '某人';
  }

  join(): void {
    if (this.inside || this.back || this.net.down) return;
    // to come back here afterwards
    const player = this.ctx.player;
    this.back = player.flying || player.gliding
      ? this.ctx.scenes.respawnPoint(player.position)
      : { pos: player.position.clone(), yaw: player.yaw };
    this.net.send({ t: 'arena', a: 'join' });
  }

  leave(): void {
    if (!this.inside || this.leaving) return;
    this.leaving = true;
    this.net.send({ t: 'arena', a: 'leave' });
  }

  vote(mode: ArenaMode): void {
    if (this.inside) this.net.send({ t: 'arena', a: 'vote', mode });
  }

  act(w: WeaponKey, k: ActKind, o: THREE.Vector3, d: THREE.Vector3): void {
    this.net.send({ t: 'act', w, k, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], at: this.ctx.state.clock });
  }

  update(dt: number): void {
    this.t += dt;
    while (this.feed.length && this.t - this.feed[0]!.t > FEED_SECONDS) this.feed.shift();
    if (!this.inside) return;
    if (this.leaving && this.net.down && this.state) {
      this.state = { ...this.state, members: this.state.members.filter((m) => m.id !== this.me) };
      this.left();
      this.ctx.events.emit('arena:changed', {});
      return;
    }
    const player = this.ctx.player;
    const p = player.position;
    const distance = Math.hypot(p.x - this.site.x, p.z - this.site.z);
    if (this.safe && distance > this.site.radius) player.teleport(this.safe.pos, this.safe.yaw);
    else if (this.safe && player.grounded && distance < this.site.radius - 1) {
      this.safe.pos.copy(p);
      this.safe.yaw = player.yaw;
    }
  }

  private handle(m: ServerMessage): void {
    switch (m.t) {
      case 'arena': {
        const before = this.state;
        this.state = m.state;
        this.stateAt = this.t;
        this.announce(before, m.state);
        this.paintTeams();
        if (this.inside !== this.wasInside) {
          if (this.inside) this.entered();
          // the server took this player out (they dropped and came back, say)
          else this.left();
        }
        this.ctx.events.emit('arena:changed', {});
        break;
      }
      case 'act':
        if (m.from === this.me) break;
        // what it looks like where it lands, and the one who did it acting it out
        this.weapons.seen(m.w, m.k, v3(m.o), v3(m.d));
        this.remote.gesture(m.from, WEAPON_ACTS[m.w]?.[1] === m.k ? 'skill' : 'attack', m.w);
        break;
      case 'hit': {
        this.updateMember(m.to, { hp: m.hp });
        if (m.to === this.me) {
          const from = this.remote.where(m.from);
          this.ctx.combat.hit(m.amount, m.hp, from ? new THREE.Vector3(from.x, from.y + 1.2, from.z) : null);
          break;
        }
        this.remote.flinch(m.to);
        const at = this.remote.where(m.to);
        // numbers and a health bar only for this player's own hits
        if (at && m.from === this.me)
          this.ctx.events.emit('rival:hit', {
            at: chest(at),
            id: m.to,
            amount: m.amount,
            hp: m.hp / ARENA.hp,
            head: m.head,
            anchor: at,
          });
        break;
      }
      case 'down': {
        this.updateMember(m.who, { hp: 0, alive: false });
        if (m.who === this.me) {
          this.ctx.combat.fall();
          this.ctx.events.emit('toast', {
            text: `被 ${this.nameOf(m.by)} 击倒，${ARENA.respawn} 秒后重生`,
            seconds: 3,
          });
        } else {
          this.remote.fall(m.who);
          const at = this.remote.where(m.who);
          if (at && m.by === this.me) this.ctx.events.emit('rival:down', { at: chest(at), id: m.who });
        }
        const by = m.by === m.who ? '' : `${this.nameOf(m.by)} → `;
        this.feed.push({
          text: `${by}${this.nameOf(m.who)}`,
          mine: m.by === this.me || m.who === this.me,
          t: this.t,
        });
        while (this.feed.length > FEED) this.feed.shift();
        this.ctx.events.emit('arena:changed', {});
        break;
      }
      case 'spawn': {
        this.updateMember(m.who, { hp: ARENA.hp, alive: true });
        if (m.who !== this.me) {
          this.remote.rise(m.who, m.p, m.yaw);
          break;
        }
        const pos = v3(m.p);
        this.safe = { pos: pos.clone(), yaw: m.yaw };
        this.ctx.player.flying = false;
        this.ctx.combat.serverHealth(true);
        this.ctx.scenes.enterWild({ pos, yaw: m.yaw });
        this.ctx.combat.rise(pos, m.yaw);
        break;
      }
      default:
        break;
    }
  }

  /** Keep the local copy of the arena's members current between full states. */
  private updateMember(id: number, change: { hp?: number; alive?: boolean }): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      members: this.state.members.map((x) => (x.id === id ? { ...x, ...change } : x)),
    };
  }

  private entered(): void {
    this.wasInside = true;
    this.stopTargets = this.ctx.combat.addTargets(this.targets());
    this.ctx.events.emit('title', { text: '竞技场', sub: 'Esc / P 打开菜单 · 退出竞技场' });
  }

  private left(): void {
    if (!this.wasInside) return;
    this.wasInside = false;
    this.leaving = false;
    this.safe = null;
    this.feed.length = 0;
    this.stopTargets?.();
    this.stopTargets = null;
    this.ctx.combat.serverHealth(false);
    this.paintTeams();
    // back where they came from
    this.ctx.scenes.enterWild(this.back ?? undefined);
    this.back = null;
  }

  /** Big moments on the title card: the countdown, the start, who won. */
  private announce(before: ArenaState | null, now: ArenaState): void {
    if (!this.inside || before?.phase === now.phase) return;
    const mode = now.mode === 'teams' ? '组队' : '混战';
    if (now.phase === 'countdown')
      this.ctx.events.emit('title', {
        text: `${Math.ceil(now.left)} 秒后开始`,
        sub: `下一局按投票：现在是${mode}`,
      });
    if (now.phase === 'fighting')
      this.ctx.events.emit('title', {
        text: '开始！',
        sub:
          now.mode === 'teams'
            ? `${TEAM_NAMES[this.teamOf(this.me) as 0 | 1] ?? ''} · 先到 ${ARENA.killsTeams} 杀`
            : `混战 · 先到 ${ARENA.killsFfa} 杀`,
      });
    if (now.phase === 'results') {
      const w = now.winner;
      const text =
        w?.team !== undefined
          ? `${TEAM_NAMES[w.team]}获胜`
          : w?.id !== undefined
            ? `${this.nameOf(w.id)}获胜`
            : '平局';
      this.ctx.events.emit('title', { text, sub: `${ARENA.results} 秒后开始下一局` });
    }
  }

  /** Teams wear their colour; outside a team round everyone wears their own. */
  private paintTeams(): void {
    const teams = this.inside && this.state?.mode === 'teams' && this.state.phase !== 'waiting';
    for (const p of this.remote.list()) {
      const team = teams ? this.teamOf(p.id) : -1;
      this.remote.setAccent(p.id, team >= 0 ? TEAM_COLORS[team as 0 | 1] : null);
    }
  }

  /** The others in the arena as targets: for this player's hit markers and hitstop only. */
  private targets(): TargetSource {
    const hurtable = (): { id: number; p: { x: number; y: number; z: number } }[] => {
      const mine = this.teamOf(this.me);
      const out: { id: number; p: { x: number; y: number; z: number } }[] = [];
      for (const id of this.remote.standing()) {
        const member = this.state?.members.find((m) => m.id === id);
        if (!member?.alive || (mine >= 0 && member.team === mine)) continue;
        out.push({ id, p: this.remote.where(id)! });
      }
      return out;
    };
    // the server says what it does; here it only feels like a hit
    const feel = (dist: number): TargetHit => ({ dist, damage: () => false });
    return {
      raycast: (o, d, max) => {
        let best: number | null = null;
        for (const t of hurtable()) {
          const head = rayBox(o, d, headBox(t.p), max);
          const body = rayBox(o, d, bodyBox(t.p), max);
          for (const x of [head, body]) if (x !== null && (best === null || x < best)) best = x;
        }
        return best === null ? null : feel(best);
      },
      inArc: (o, d, range, halfAngle) =>
        hurtable()
          .map((t) => chest(t.p))
          .filter((m) => {
            const to = new THREE.Vector3(m.x - o.x, m.y - o.y, m.z - o.z);
            return to.length() < range + 0.35 && to.normalize().dot(d) > Math.cos(halfAngle + 0.2);
          })
          .map((m) => feel(Math.hypot(m.x - o.x, m.y - o.y, m.z - o.z))),
      inSphere: (point, radius) =>
        hurtable()
          .map((t) => chest(t.p))
          .map((m) => Math.hypot(m.x - point.x, m.y - point.y, m.z - point.z))
          .filter((dist) => dist < radius + 0.35)
          .sort((a, b) => a - b)
          .map(feel),
    };
  }

  /** The wall and the cover, with their colliders, in the wilderness. */
  private build(): void {
    const { site } = this;
    const w = this.ctx.wilderness;
    const W = ARENA.wall;
    const corner = (a: number, r: number, up: number): THREE.Vector3 => {
      const x = site.x + Math.cos(a) * r;
      const z = site.z + Math.sin(a) * r;
      return new THREE.Vector3(x, w.heightAt(x, z) + up, z);
    };
    const inner = site.radius;
    const outer = site.radius + W.thickness;
    // colliders: each stretch of wall as a turned box, a little long so stretches overlap
    for (let i = 0; i < W.segments; i++) {
      const a0 = (i / W.segments) * Math.PI * 2;
      const a1 = ((i + 1) / W.segments) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      const cx = site.x + Math.cos(mid) * (inner + W.thickness / 2);
      const cz = site.z + Math.sin(mid) * (inner + W.thickness / 2);
      const lo = Math.min(corner(a0, inner, 0).y, corner(a1, inner, 0).y) - 1;
      const hi = Math.max(corner(a0, inner, 0).y, corner(a1, inner, 0).y) + W.height;
      const half = Math.sin(Math.PI / W.segments) * outer + 0.2;
      const hz = W.thickness / 2 + 0.2;
      this.wild.physics.addBox(
        'arena',
        { x: cx - half, y: lo, z: cz - hz },
        { x: cx + half, y: hi, z: cz + hz },
        {},
        Math.atan2(Math.cos(mid), Math.sin(mid)),
      );
    }
    for (const b of site.cover) this.wild.physics.addBox('arena', b.min, b.max);
    const mesh = new THREE.Mesh(
      buildArena(site, (x, z) => w.heightAt(x, z)),
      this.material,
    );
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.wild.root.add(this.root);
  }

  dispose(): void {
    this.stopTargets?.();
    this.wild.physics.removeGroup('arena');
    this.root.removeFromParent();
    this.material.dispose();
    shared.uArena.value.set(0, 0, 0, 0);
  }
}
