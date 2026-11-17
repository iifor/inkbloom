// The arena's rounds, as the server keeps them: who is in, which mode they voted for, teams,
// health, kills, who is down and when they get up, and when a round starts and ends. It knows
// nothing of the network or of shots: the host works out hits (hits.ts) and hands them here,
// and sends on the events this returns.
// design: docs/game-design.md section 9.4
import { ARENA } from '@/content/arena';
import type { Vec } from './hits';
import type { ArenaSite } from './site';

export type ArenaMode = 'ffa' | 'teams';
export type ArenaPhase = 'waiting' | 'countdown' | 'fighting' | 'results';
/** -1 in a free-for-all; 0 red, 1 blue. */
export type Team = -1 | 0 | 1;

export interface ArenaMember {
  readonly id: number;
  readonly team: Team;
  readonly kills: number;
  readonly deaths: number;
  readonly hp: number;
  readonly alive: boolean;
  readonly vote: ArenaMode;
}

/** What every player is told about the arena (the menu shows it to those outside, too). */
export interface ArenaState {
  readonly phase: ArenaPhase;
  readonly mode: ArenaMode;
  /** Seconds left in this phase (0 while waiting). */
  readonly left: number;
  readonly members: readonly ArenaMember[];
  /** Who won the round just over: a player, a team, or nobody (a draw). */
  readonly winner: { readonly id?: number; readonly team?: 0 | 1 } | null;
}

export type ArenaEvent =
  | {
      readonly kind: 'hit';
      readonly from: number;
      readonly to: number;
      readonly amount: number;
      readonly head: boolean;
      readonly hp: number;
    }
  | { readonly kind: 'down'; readonly who: number; readonly by: number; readonly w: string }
  | { readonly kind: 'spawn'; readonly who: number; readonly p: Vec; readonly yaw: number }
  | { readonly kind: 'state' };

interface Fighter {
  readonly id: number;
  readonly order: number;
  team: Team;
  kills: number;
  deaths: number;
  hp: number;
  shield: number;
  shieldUntil: number;
  focusUntil: number;
  alive: boolean;
  respawnAt: number;
  graceUntil: number;
  vote: ArenaMode;
  readonly last: Map<string, number>;
}

const STATE: ArenaEvent = { kind: 'state' };

export class ArenaMatch {
  phase: ArenaPhase = 'waiting';
  mode: ArenaMode = 'ffa';
  private phaseEnds = 0;
  private winner: ArenaState['winner'] = null;
  private readonly fighters = new Map<number, Fighter>();
  private joins = 0;

  constructor(
    private readonly site: ArenaSite,
    /** Where a player stands now (feet), for picking spawn points away from enemies. */
    private readonly where: (id: number) => Vec | null,
  ) {}

  get count(): number {
    return this.fighters.size;
  }

  has(id: number): boolean {
    return this.fighters.has(id);
  }

  isAlive(id: number): boolean {
    return this.fighters.get(id)?.alive ?? false;
  }

  join(id: number, now: number): ArenaEvent[] {
    if (this.fighters.has(id)) return [];
    const f: Fighter = {
      id,
      order: this.joins++,
      team: -1,
      kills: 0,
      deaths: 0,
      hp: ARENA.hp,
      shield: 0,
      shieldUntil: 0,
      focusUntil: 0,
      alive: true,
      respawnAt: 0,
      graceUntil: 0,
      vote: this.mode,
      last: new Map(),
    };
    this.fighters.set(id, f);
    // mid-round in teams: onto the smaller side
    if (this.phase === 'fighting' && this.mode === 'teams') f.team = this.smallerTeam(id);
    return [this.spawn(f, now), STATE];
  }

  leave(id: number): ArenaEvent[] {
    return this.fighters.delete(id) ? [STATE] : [];
  }

  vote(id: number, mode: ArenaMode): ArenaEvent[] {
    const f = this.fighters.get(id);
    if (!f || f.vote === mode) return [];
    f.vote = mode;
    return [STATE];
  }

  /** Whether `id` may act again: at most once per `gap` seconds for each `key`. */
  allow(id: number, key: string, gap: number, now: number): boolean {
    const f = this.fighters.get(id);
    if (!f || !f.alive) return false;
    if (now - (f.last.get(key) ?? -Infinity) < gap) return false;
    f.last.set(key, now);
    return true;
  }

  shield(id: number, now: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    f.shield = ARENA.shield.amount;
    f.shieldUntil = now + ARENA.shield.seconds;
  }

  focus(id: number, now: number): void {
    const f = this.fighters.get(id);
    if (f) f.focusUntil = now + ARENA.focus.seconds;
  }

  focused(id: number, now: number): boolean {
    return (this.fighters.get(id)?.focusUntil ?? 0) > now;
  }

  /** Whom `id` can hurt right now: up, past their grace, not a teammate, during a round. */
  targetsFor(id: number, now: number): number[] {
    const me = this.fighters.get(id);
    if (!me || this.phase !== 'fighting') return [];
    const out: number[] = [];
    for (const f of this.fighters.values()) {
      if (f.id === id || !f.alive || f.graceUntil > now) continue;
      if (this.mode === 'teams' && f.team === me.team) continue;
      out.push(f.id);
    }
    return out;
  }

  /** `from` hurts `to` with weapon `w`. Checks targetsFor again, so stale hits do nothing. */
  damage(from: number, to: number, amount: number, head: boolean, w: string, now: number): ArenaEvent[] {
    if (!this.targetsFor(from, now).includes(to)) return [];
    const f = this.fighters.get(to)!;
    let rest = Math.round(amount);
    if (f.shield > 0 && f.shieldUntil > now) {
      const soak = Math.min(f.shield, rest);
      f.shield -= soak;
      rest -= soak;
    }
    f.hp = Math.max(0, f.hp - rest);
    const out: ArenaEvent[] = [{ kind: 'hit', from, to, amount: Math.round(amount), head, hp: f.hp }];
    if (f.hp > 0) return out;
    f.alive = false;
    f.deaths++;
    f.respawnAt = now + ARENA.respawn;
    const killer = this.fighters.get(from);
    if (killer && killer !== f) killer.kills++;
    out.push({ kind: 'down', who: to, by: from, w }, STATE);
    if (this.reachedTarget()) this.endRound(now);
    return out;
  }

  /** Time passes: rounds start and end, the fallen get up. */
  tick(now: number): ArenaEvent[] {
    const out: ArenaEvent[] = [];
    for (const f of this.fighters.values())
      if (!f.alive && f.respawnAt <= now) out.push(this.spawn(f, now), STATE);
    const enough = this.fighters.size >= 2;
    switch (this.phase) {
      case 'waiting':
        if (enough) this.setPhase('countdown', now + ARENA.countdown, out);
        break;
      case 'countdown':
        if (!enough) this.setPhase('waiting', 0, out);
        else if (now >= this.phaseEnds) this.startRound(now, out);
        break;
      case 'fighting':
        if (!enough) this.setPhase('waiting', 0, out);
        else if (now >= this.phaseEnds) {
          this.endRound(now);
          out.push(STATE);
        } else if (this.mode === 'teams') this.balance(out);
        break;
      case 'results':
        if (now >= this.phaseEnds)
          this.setPhase(enough ? 'countdown' : 'waiting', now + ARENA.countdown, out);
        break;
    }
    return out;
  }

  state(now: number): ArenaState {
    return {
      phase: this.phase,
      mode: this.mode,
      left: this.phase === 'waiting' ? 0 : Math.max(0, Math.round((this.phaseEnds - now) * 10) / 10),
      members: [...this.fighters.values()].map((f) => ({
        id: f.id,
        team: f.team,
        kills: f.kills,
        deaths: f.deaths,
        hp: f.hp,
        alive: f.alive,
        vote: f.vote,
      })),
      winner: this.phase === 'results' ? this.winner : null,
    };
  }

  private setPhase(phase: ArenaPhase, ends: number, out: ArenaEvent[]): void {
    this.phase = phase;
    this.phaseEnds = ends;
    out.push(STATE);
  }

  private startRound(now: number, out: ArenaEvent[]): void {
    // the mode most voted for; a tie keeps the last one
    let teams = 0;
    for (const f of this.fighters.values()) teams += f.vote === 'teams' ? 1 : -1;
    if (teams !== 0) this.mode = teams > 0 ? 'teams' : 'ffa';
    const order = [...this.fighters.values()].sort((a, b) => a.order - b.order);
    order.forEach((f, i) => {
      f.team = this.mode === 'teams' ? ((i % 2) as 0 | 1) : -1;
      f.kills = 0;
      f.deaths = 0;
      f.hp = ARENA.hp;
      f.alive = false;
    });
    this.winner = null;
    this.setPhase('fighting', now + ARENA.roundSeconds, out);
    // everyone stands up at once, spread out
    for (const f of order) out.push(this.spawn(f, now));
  }

  private teamKills(team: 0 | 1): number {
    let n = 0;
    for (const f of this.fighters.values()) if (f.team === team) n += f.kills;
    return n;
  }

  private reachedTarget(): boolean {
    if (this.phase !== 'fighting') return false;
    if (this.mode === 'teams') return Math.max(this.teamKills(0), this.teamKills(1)) >= ARENA.killsTeams;
    return [...this.fighters.values()].some((f) => f.kills >= ARENA.killsFfa);
  }

  private endRound(now: number): void {
    if (this.mode === 'teams') {
      const red = this.teamKills(0);
      const blue = this.teamKills(1);
      this.winner = red === blue ? null : { team: red > blue ? 0 : 1 };
    } else {
      const best = [...this.fighters.values()].sort(
        (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.order - b.order,
      )[0];
      this.winner = best && best.kills > 0 ? { id: best.id } : null;
    }
    this.phase = 'results';
    this.phaseEnds = now + ARENA.results;
  }

  private smallerTeam(except: number): 0 | 1 {
    let red = 0;
    let blue = 0;
    for (const f of this.fighters.values()) {
      if (f.id === except) continue;
      if (f.team === 0) red++;
      if (f.team === 1) blue++;
    }
    return red <= blue ? 0 : 1;
  }

  /** Someone left and a side is empty or two short: move the newest from the bigger side. */
  private balance(out: ArenaEvent[]): void {
    const sides: Fighter[][] = [[], []];
    for (const f of this.fighters.values()) if (f.team >= 0) sides[f.team]!.push(f);
    const [red, blue] = sides as [Fighter[], Fighter[]];
    if (Math.abs(red.length - blue.length) < 2 && red.length && blue.length) return;
    const big = red.length > blue.length ? red : blue;
    const moved = big.sort((a, b) => b.order - a.order)[0];
    if (!moved) return;
    moved.team = big === red ? 1 : 0;
    out.push(STATE);
  }

  /** Up again (or for the first time), full health, a moment of grace, at the spawn point
   * farthest from anyone who could shoot them. */
  private spawn(f: Fighter, now: number): ArenaEvent {
    f.alive = true;
    f.hp = ARENA.hp;
    f.shield = 0;
    f.graceUntil = now + ARENA.grace;
    const threats: Vec[] = [];
    for (const o of this.fighters.values()) {
      if (o === f || !o.alive || (this.mode === 'teams' && o.team === f.team && f.team >= 0)) continue;
      const p = this.where(o.id);
      if (p) threats.push(p);
    }
    let best = this.site.spawns[0]!;
    let bestScore = -Infinity;
    for (const s of this.site.spawns) {
      const score = threats.length ? Math.min(...threats.map((t) => Math.hypot(t.x - s.x, t.z - s.z))) : 0;
      // a little randomness among the safe ones so nobody always gets up in the same place
      const tie = score + Math.random() * 6;
      if (tie > bestScore) {
        bestScore = tie;
        best = s;
      }
    }
    return { kind: 'spawn', who: f.id, p: { x: best.x, y: best.y, z: best.z }, yaw: best.yaw };
  }
}
