// The arena on the server: who is in it, where each of them was over the last second, and what
// their attacks hit. The round itself (health, kills, phases) is ArenaMatch's; the maths of a
// hit is hits.ts. This turns players' acts into hits and says which messages go to whom.
//
// Nothing a client says about a hit is believed: it says where it fired from and which way, and
// when; the server checks that the shot left from where that player stood, that the weapon was
// ready, and rewinds the targets to where the shooter saw them (at most 0.2 s) before tracing.
import { ARENA } from '@/content/arena';
import { WEAPONS, type WeaponKey } from '@/content/weapons';
import {
  type Candidate,
  type Solid,
  type Track,
  type Vec,
  inArc,
  inBlast,
  judgedAt,
  positionAt,
  shellBurst,
  traceShot,
} from '../arena/hits';
import { ArenaMatch, type ArenaEvent, type ArenaMode } from '../arena/match';
import { type ArenaSite, findArenaSite } from '../arena/site';
import type { Wilderness } from '../wilderness/generator';
import { type ActKind, type ServerMessage, type Vec3, WEAPON_ACTS } from './protocol';

/** How long a player's track is kept, seconds of world clock. */
const TRACK_SECONDS = 1;
/** Eye height over the feet (systems/player: TUNING.player.eyeHeight). */
const EYE = 1.65;
/** A field may be put down this far from the one casting it (systems/tools/weapons.ts: 40 m). */
const FIELD_REACH = 42;
/** Leeway on how often a weapon may fire: network jitter bunches messages together. */
const RATE_SLACK = 0.7;

/** A message and who gets it: everyone on the server, everyone in the arena, or one player. */
export type Outgoing = { readonly to: 'all' | 'arena' | number; readonly m: ServerMessage };

interface Field {
  readonly owner: number;
  readonly at: Vec;
  readonly until: number;
  next: number;
}

const vec = (v: Vec3): Vec => ({ x: v[0], y: v[1], z: v[2] });
const arr = (v: Vec): Vec3 => [v.x, v.y, v.z];

export class ArenaHost {
  private siteCache: ArenaSite | null = null;
  private matchCache: ArenaMatch | null = null;
  private readonly tracks = new Map<number, Track[]>();
  private fields: Field[] = [];

  constructor(
    private readonly wilderness: Wilderness,
    /** The world clock, which clients also keep. */
    private readonly clock: () => number,
  ) {}

  /** Worked out the first time anyone comes to the arena (a search of a few milliseconds). */
  get site(): ArenaSite {
    return (this.siteCache ??= findArenaSite(this.wilderness));
  }

  private get match(): ArenaMatch {
    return (this.matchCache ??= new ArenaMatch(this.site, (id) => this.latest(id)));
  }

  private get solid(): Solid {
    return {
      heightAt: (x, z) => this.wilderness.heightAt(x, z),
      boxes: [...this.site.cover, ...this.site.trunks],
    };
  }

  /** Whether anyone has come to the arena since the server started. */
  get started(): boolean {
    return this.matchCache !== null;
  }

  has(id: number): boolean {
    return this.matchCache?.has(id) ?? false;
  }

  /** The arena as everyone is told it. */
  stateMessage(): ServerMessage {
    return { t: 'arena', state: this.match.state(this.clock()) };
  }

  join(id: number): Outgoing[] {
    return this.send(this.match.join(id, this.clock()));
  }

  leave(id: number): Outgoing[] {
    this.tracks.delete(id);
    this.fields = this.fields.filter((f) => f.owner !== id);
    return this.matchCache ? this.send(this.match.leave(id)) : [];
  }

  vote(id: number, mode: ArenaMode): Outgoing[] {
    return this.matchCache ? this.send(this.match.vote(id, mode)) : [];
  }

  /** Where a player in the arena stands now (feet). */
  track(id: number, p: Vec3): void {
    if (!this.has(id)) return;
    const now = this.clock();
    const t = this.tracks.get(id) ?? [];
    t.push({ t: now, p: vec(p) });
    while (t.length > 2 && t[0]!.t < now - TRACK_SECONDS) t.shift();
    this.tracks.set(id, t);
  }

  private latest(id: number): Vec | null {
    const t = this.tracks.get(id);
    return t?.length ? t[t.length - 1]!.p : null;
  }

  tick(): Outgoing[] {
    if (!this.matchCache) return [];
    const now = this.clock();
    const events = this.match.tick(now);
    // ink circles bite every half second while they last
    for (const f of this.fields) {
      if (now < f.next) continue;
      f.next += ARENA.field.every;
      const targets = this.targets(f.owner, now, now);
      for (const h of inBlast(this.solid, f.at, ARENA.field.radius, targets))
        events.push(...this.match.damage(f.owner, h.id, ARENA.field.damage * h.share, false, 'staff', now));
    }
    this.fields = this.fields.filter((f) => f.until > now && this.match.has(f.owner));
    return this.send(events);
  }

  /** The others `id` may hurt, where they stood at time t. */
  private targets(id: number, now: number, t: number): Candidate[] {
    const out: Candidate[] = [];
    for (const target of this.match.targetsFor(id, now)) {
      const p = positionAt(this.tracks.get(target) ?? [], t);
      if (p) out.push({ id: target, p });
    }
    return out;
  }

  /** A player's attack or skill. */
  act(id: number, a: { w: WeaponKey; k: ActKind; o: Vec3; d: Vec3; at: number }): Outgoing[] {
    if (!this.has(id)) return [];
    const now = this.clock();
    const def = WEAPONS.find((x) => x.key === a.w)!;
    const me = this.latest(id);
    if (!me) return [];
    const o = vec(a.o);
    const d = vec(a.d);
    // from where they stand (allowing for their own movement on the way here), inside the walls
    if (Math.hypot(o.x - me.x, o.y - (me.y + EYE), o.z - me.z) > ARENA.reach) return [];
    if (Math.hypot(me.x - this.site.x, me.z - this.site.z) > this.site.radius + 2) return [];
    const skill = WEAPON_ACTS[a.w][1] === a.k;
    const gap = skill ? def.skill.cooldown : def.interval;
    if (!this.match.allow(id, skill ? `skill:${a.w}` : a.w, gap * RATE_SLACK, now)) return [];

    const events: ArenaEvent[] = [];
    const t = judgedAt(now, a.at);
    const targets = this.targets(id, now, t);
    const hurt = (to: number, amount: number, head = false): void => {
      events.push(...this.match.damage(id, to, amount, head, a.w, now));
    };
    switch (a.k) {
      case 'shot': {
        const hit = traceShot(this.solid, o, d, def.range, targets);
        if (!hit) break;
        const focus = a.w === 'sniper' && this.match.focused(id, now) ? ARENA.focus.multiplier : 1;
        hurt(hit.id, def.pvp.damage * (hit.head ? def.pvp.head : 1) * focus, hit.head);
        break;
      }
      case 'strike':
        for (const to of inArc(this.solid, o, d, def.range, def.area, targets)) hurt(to, def.pvp.damage);
        break;
      case 'slash': {
        const flat = Math.hypot(d.x, d.z) || 1;
        const along = { x: d.x / flat, y: 0, z: d.z / flat };
        const S = ARENA.slash;
        for (const to of inArc(this.solid, o, along, S.range, S.halfAngle, targets)) hurt(to, S.damage);
        break;
      }
      case 'shell':
      case 'bigshell': {
        const big = a.k === 'bigshell';
        const at = shellBurst(this.solid, o, d, targets);
        const area = big ? ARENA.bigShell.area : def.area;
        const damage = big ? ARENA.bigShell.damage : def.pvp.damage;
        for (const h of inBlast(this.solid, at, area, targets)) hurt(h.id, damage * h.share);
        break;
      }
      case 'field':
        // `o` is where the circle goes (where the caster aimed), not their eye
        if (Math.hypot(o.x - me.x, o.z - me.z) <= FIELD_REACH)
          this.fields.push({ owner: id, at: o, until: now + ARENA.field.seconds, next: now });
        break;
      case 'shield':
        this.match.shield(id, now);
        break;
      case 'focus':
        this.match.focus(id, now);
        break;
    }
    // the others in the arena see it happen
    const seen: Outgoing = { to: 'arena', m: { t: 'act', from: id, w: a.w, k: a.k, o: a.o, d: a.d } };
    return [seen, ...this.send(events)];
  }

  /** Arena members, for sending `to: 'arena'` messages. */
  members(): number[] {
    return this.matchCache ? this.match.state(this.clock()).members.map((m) => m.id) : [];
  }

  private send(events: readonly ArenaEvent[]): Outgoing[] {
    const out: Outgoing[] = [];
    let state = false;
    for (const e of events)
      switch (e.kind) {
        case 'hit':
          out.push({
            to: 'arena',
            m: { t: 'hit', from: e.from, to: e.to, amount: e.amount, head: e.head, hp: e.hp },
          });
          break;
        case 'down':
          out.push({ to: 'arena', m: { t: 'down', who: e.who, by: e.by, w: e.w } });
          break;
        case 'spawn':
          // they are somewhere else now: rewinding should not drag them across the field
          this.tracks.set(e.who, [{ t: this.clock(), p: e.p }]);
          out.push({ to: 'arena', m: { t: 'spawn', who: e.who, p: arr(e.p), yaw: e.yaw } });
          break;
        case 'state':
          state = true;
          break;
      }
    if (state) out.push({ to: 'all', m: this.stateMessage() });
    return out;
  }
}
