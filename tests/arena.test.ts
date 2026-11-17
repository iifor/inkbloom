import { describe, expect, it } from 'vitest';
import { ARENA } from '@/content/arena';
import {
  type Box,
  type Candidate,
  type Solid,
  type Vec,
  inArc,
  inBlast,
  judgedAt,
  positionAt,
  sees,
  shellBurst,
  traceShot,
} from '@/world/arena/hits';
import { ArenaMatch, type ArenaEvent } from '@/world/arena/match';
import { type ArenaSite, findArenaSite } from '@/world/arena/site';
import { WATER_LEVEL, createWilderness, townDistance } from '@/world/wilderness/generator';
import { ruinsInChunk } from '@/world/wilderness/ruins';

const flat = (boxes: Box[] = []): Solid => ({ heightAt: () => 0, boxes });
const at = (x: number, z: number, y = 0): Vec => ({ x, y, z });
const eye = (x: number, z: number): Vec => ({ x, y: 1.65, z });
const toward = (a: Vec, b: Vec): Vec => {
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d, z: (b.z - a.z) / d };
};

describe('arena site', () => {
  const w = createWilderness(11);
  const site = findArenaSite(w);

  it('is the same place every time, on dry rolling ground away from towns and ruins', () => {
    expect(findArenaSite(createWilderness(11))).toEqual(site);
    const d = Math.hypot(site.x, site.z);
    expect(d).toBeGreaterThanOrEqual(ARENA.nearest - 1);
    expect(d).toBeLessThanOrEqual(ARENA.farthest + 1);
    for (let a = 0; a < Math.PI * 2; a += 0.3)
      for (const r of [0, 20, 40]) {
        const h = w.heightAt(site.x + Math.cos(a) * r, site.z + Math.sin(a) * r);
        expect(h).toBeGreaterThan(WATER_LEVEL);
      }
    for (const e of w.entrancesNear(site.x, site.z, 2))
      expect(townDistance(e, site.x, site.z)).toBeGreaterThanOrEqual(ARENA.townClear);
    const size = 128;
    for (let cx = Math.floor((site.x - 70) / size); cx <= Math.floor((site.x + 70) / size); cx++)
      for (let cz = Math.floor((site.z - 70) / size); cz <= Math.floor((site.z + 70) / size); cz++)
        for (const r of ruinsInChunk(w, cx, cz))
          expect(Math.hypot(r.x - site.x, r.z - site.z)).toBeGreaterThan(site.radius);
  });

  it('has its spawn points inside, clear of cover, facing the middle', () => {
    expect(site.spawns).toHaveLength(ARENA.spawns);
    for (const s of site.spawns) {
      expect(Math.hypot(s.x - site.x, s.z - site.z)).toBeLessThan(site.radius);
      for (const b of site.cover)
        expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z).toBe(false);
      // yaw 0 looks down -z: forward is (-sin, -cos)
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      expect(fx * (site.x - s.x) + fz * (site.z - s.z)).toBeGreaterThan(0);
    }
  });
});

describe('arena hits', () => {
  const target: Candidate = { id: 2, p: at(0, -10) };

  it('a shot at the head is a head hit, at the chest a body hit, past them a miss', () => {
    const o = eye(0, 0);
    expect(traceShot(flat(), o, toward(o, { x: 0, y: 1.62, z: -10 }), 100, [target])).toMatchObject({
      id: 2,
      head: true,
    });
    expect(traceShot(flat(), o, toward(o, { x: 0, y: 0.9, z: -10 }), 100, [target])).toMatchObject({
      id: 2,
      head: false,
    });
    expect(traceShot(flat(), o, toward(o, { x: 2, y: 1, z: -10 }), 100, [target])).toBeNull();
    // out of range
    expect(traceShot(flat(), o, toward(o, { x: 0, y: 0.9, z: -10 }), 5, [target])).toBeNull();
  });

  it('cover and the ground stop shots', () => {
    const o = eye(0, 0);
    const wall: Box = { min: { x: -2, y: -1, z: -5.5 }, max: { x: 2, y: 3, z: -5 } };
    const d = toward(o, { x: 0, y: 0.9, z: -10 });
    expect(traceShot(flat([wall]), o, d, 100, [target])).toBeNull();
    // a hill in between
    const hill: Solid = { heightAt: (_x, z) => (z < -3 && z > -7 ? 3 : 0), boxes: [] };
    expect(traceShot(hill, o, d, 100, [target])).toBeNull();
    expect(sees(hill, o, { x: 0, y: 0.9, z: -10 })).toBe(false);
    expect(sees(flat(), o, { x: 0, y: 0.9, z: -10 })).toBe(true);
  });

  it('judges a shot where the target stood on the shooter’s screen, rewinding at most 0.2 s', () => {
    const track = [
      { t: 10, p: at(0, 0) },
      { t: 10.1, p: at(1, 0) },
      { t: 10.2, p: at(2, 0) },
    ];
    expect(positionAt(track, 10.05)!.x).toBeCloseTo(0.5);
    expect(positionAt(track, 9)).toEqual(at(0, 0));
    expect(positionAt(track, 11)).toEqual(at(2, 0));
    expect(judgedAt(20, 19.95)).toBeCloseTo(19.85);
    expect(judgedAt(20, 10)).toBeCloseTo(20 - ARENA.rewind);
    expect(judgedAt(20, 30)).toBe(20);
  });

  it('a sword reaches what is in front and close, a blast falls off with distance', () => {
    const o = eye(0, 0);
    const near: Candidate = { id: 3, p: at(0, -2) };
    const behind: Candidate = { id: 4, p: at(0, 2) };
    const far: Candidate = { id: 5, p: at(0, -6) };
    expect(inArc(flat(), o, { x: 0, y: 0, z: -1 }, 2.8, 0.9, [near, behind, far])).toEqual([3]);
    const hits = inBlast(flat(), at(0, 0), 4.5, [
      { id: 6, p: at(0, 0) },
      { id: 7, p: at(3, 0) },
      { id: 8, p: at(9, 0) },
    ]);
    expect(hits.map((h) => h.id)).toEqual([6, 7]);
    expect(hits[0]!.share).toBeGreaterThan(hits[1]!.share);
  });

  it('a shell bursts on the ground ahead, or beside a player in its path', () => {
    const o = eye(0, 0);
    const burst = shellBurst(flat(), o, { x: 0, y: 0, z: -1 }, []);
    expect(burst.z).toBeLessThan(-5);
    expect(burst.y).toBeLessThanOrEqual(0.05);
    const inPath = shellBurst(flat(), o, { x: 0, y: 0, z: -1 }, [{ id: 2, p: at(0, -4) }]);
    expect(inPath.z).toBeGreaterThan(-4);
  });
});

describe('arena rounds', () => {
  const site: ArenaSite = {
    x: 0,
    z: 0,
    radius: 45,
    cover: [],
    trunks: [],
    spawns: Array.from({ length: 10 }, (_, i) => ({
      x: Math.cos(i) * 36,
      y: 0,
      z: Math.sin(i) * 36,
      yaw: 0,
    })),
  };
  const places = new Map<number, Vec>();
  const match = (): ArenaMatch => new ArenaMatch(site, (id) => places.get(id) ?? null);
  const kinds = (events: ArenaEvent[]) => events.map((e) => e.kind);

  /** Two players in, through the countdown, fighting at time 100. */
  function fighting(m: ArenaMatch, ids = [1, 2], now = 100): void {
    for (const id of ids) m.join(id, now - 20);
    m.tick(now - 20);
    expect(m.phase).toBe('countdown');
    m.tick(now);
    expect(m.phase).toBe('fighting');
  }

  it('waits for a second player, counts down, then fights', () => {
    const m = match();
    expect(kinds(m.join(1, 0))).toEqual(['spawn', 'state']);
    m.tick(1);
    expect(m.phase).toBe('waiting');
    m.join(2, 2);
    m.tick(3);
    expect(m.phase).toBe('countdown');
    // no hurting anyone before the round
    expect(m.targetsFor(1, 4)).toEqual([]);
    const start = m.tick(3 + ARENA.countdown);
    expect(m.phase).toBe('fighting');
    expect(kinds(start).filter((k) => k === 'spawn')).toHaveLength(2);
  });

  it('nobody is hurt in their moment of grace; a shield soaks first; at 0 health they go down', () => {
    const m = match();
    fighting(m);
    expect(m.damage(1, 2, 50, false, 'rifle', 100.5)).toEqual([]);
    const t = 100 + ARENA.grace + 0.1;
    m.shield(2, t);
    const hit = m.damage(1, 2, 30, false, 'rifle', t);
    expect(hit[0]).toMatchObject({ kind: 'hit', to: 2, hp: 95 });
    const down = m.damage(1, 2, 200, true, 'sniper', t + 0.1);
    expect(kinds(down)).toEqual(['hit', 'down', 'state']);
    expect(m.isAlive(2)).toBe(false);
    expect(m.state(t).members.find((x) => x.id === 1)!.kills).toBe(1);
    // up again after the respawn time
    const up = m.tick(t + 0.1 + ARENA.respawn);
    expect(kinds(up)).toContain('spawn');
    expect(m.isAlive(2)).toBe(true);
  });

  it('a free-for-all ends at the kill target, and names the winner', () => {
    const m = match();
    fighting(m);
    let t = 110;
    for (let k = 0; k < ARENA.killsFfa; k++) {
      expect(kinds(m.damage(1, 2, 999, false, 'sniper', t))).toContain('down');
      if (m.phase !== 'fighting') break;
      t += ARENA.respawn;
      m.tick(t);
      // past the grace of getting up
      t += ARENA.grace + 0.1;
    }
    expect(m.phase).toBe('results');
    expect(m.state(t).winner).toEqual({ id: 1 });
    m.tick(t + ARENA.results + 1);
    expect(m.phase).toBe('countdown');
  });

  it('teams by majority vote; teammates cannot hurt each other', () => {
    const m = match();
    for (const id of [1, 2, 3, 4]) m.join(id, 0);
    m.vote(1, 'teams');
    m.vote(2, 'teams');
    m.vote(3, 'teams');
    m.tick(1);
    m.tick(1 + ARENA.countdown);
    expect(m.mode).toBe('teams');
    const teams = new Map(m.state(20).members.map((x) => [x.id, x.team]));
    expect(new Set(teams.values())).toEqual(new Set([0, 1]));
    const t = 20;
    const mate = [2, 3, 4].find((id) => teams.get(id) === teams.get(1))!;
    const foe = [2, 3, 4].find((id) => teams.get(id) !== teams.get(1))!;
    expect(m.targetsFor(1, t)).not.toContain(mate);
    expect(m.targetsFor(1, t)).toContain(foe);
    expect(m.damage(1, mate, 50, false, 'rifle', t)).toEqual([]);
  });

  it('a tie in the vote keeps the last mode; too few players stops the round', () => {
    const m = match();
    fighting(m);
    m.vote(1, 'teams');
    expect(m.mode).toBe('ffa');
    m.leave(2);
    m.tick(101);
    expect(m.phase).toBe('waiting');
  });

  it('rate-limits each kind of act', () => {
    const m = match();
    m.join(1, 0);
    expect(m.allow(1, 'sniper', 0.8, 1)).toBe(true);
    expect(m.allow(1, 'sniper', 0.8, 1.5)).toBe(false);
    expect(m.allow(1, 'rifle', 0.08, 1.5)).toBe(true);
    expect(m.allow(1, 'sniper', 0.8, 1.9)).toBe(true);
    expect(m.allow(9, 'rifle', 0.08, 2)).toBe(false);
  });

  it('gets up at the spawn point farthest from enemies', () => {
    const m = match();
    places.set(1, { x: 36, y: 0, z: 0 });
    m.join(1, 0);
    const [spawn] = m.join(2, 0);
    expect(spawn).toMatchObject({ kind: 'spawn', who: 2 });
    const p = (spawn as Extract<ArenaEvent, { kind: 'spawn' }>).p;
    expect(Math.hypot(p.x - 36, p.z)).toBeGreaterThan(50);
    places.clear();
  });
});
