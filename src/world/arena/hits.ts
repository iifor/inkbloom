// Hits between players, worked out where nobody can cheat them: on the server, against where
// each target stood on the shooter's screen (rewound a little), and only if nothing solid is in
// the way (the ground, cover, tree trunks). Plain maths over plain data, so tests run it too.
// design: docs/game-design.md 8.3 (head and body), 8.4 (rewinding), 11.3 (the hit box)
import { ARENA } from '@/content/arena';

export interface Vec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Box {
  readonly min: Vec;
  readonly max: Vec;
}

/** Every character's hit box, whatever they wear: a body and a head, from the feet. */
export const BODY = { half: 0.35, height: 1.42 } as const;
export const HEAD = { half: 0.18, centre: 1.62 } as const;

export function bodyBox(p: Vec): Box {
  return {
    min: { x: p.x - BODY.half, y: p.y, z: p.z - BODY.half },
    max: { x: p.x + BODY.half, y: p.y + BODY.height, z: p.z + BODY.half },
  };
}

export function headBox(p: Vec): Box {
  const y = p.y + HEAD.centre;
  return {
    min: { x: p.x - HEAD.half, y: y - HEAD.half, z: p.z - HEAD.half },
    max: { x: p.x + HEAD.half, y: y + HEAD.half, z: p.z + HEAD.half },
  };
}

/** Middle of the body, where blasts and sword arcs aim. */
export const chest = (p: Vec): Vec => ({ x: p.x, y: p.y + 0.9, z: p.z });

/** Distance along a ray (unit `d`) to where it enters a box, or null if it misses within max. */
export function rayBox(o: Vec, d: Vec, box: Box, max: number): number | null {
  let near = 0;
  let far = max;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < box.min[k] || o[k] > box.max[k]) return null;
      continue;
    }
    let t0 = (box.min[k] - o[k]) / d[k];
    let t1 = (box.max[k] - o[k]) / d[k];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return null;
  }
  return near;
}

/** What stops shots: the ground's height, and boxes (cover, trunks). */
export interface Solid {
  heightAt(x: number, z: number): number;
  readonly boxes: readonly Box[];
}

const STEP = 0.5;

/** How far a ray goes before something solid stops it (max if nothing does). */
export function clearDistance(solid: Solid, o: Vec, d: Vec, max: number): number {
  let end = max;
  for (const b of solid.boxes) {
    const t = rayBox(o, d, b, end);
    if (t !== null) end = t;
  }
  // the ground, a step at a time; a shot fired from just above it is not stopped at once
  for (let t = STEP; t < end; t += STEP) {
    const y = o.y + d.y * t;
    if (y < solid.heightAt(o.x + d.x * t, o.z + d.z * t) - 0.05) return Math.max(0, t - STEP);
  }
  return end;
}

/** Whether two points see each other. */
export function sees(solid: Solid, a: Vec, b: Vec): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  return clearDistance(solid, a, d, len) >= len - 0.05;
}

/** Where someone was over the last moments, as (server time, feet) samples, oldest first. */
export interface Track {
  readonly t: number;
  readonly p: Vec;
}

/** Where a track says its player stood at time t (held at either end). */
export function positionAt(track: readonly Track[], t: number): Vec | null {
  if (!track.length) return null;
  if (t <= track[0]!.t) return track[0]!.p;
  for (let i = 1; i < track.length; i++) {
    const b = track[i]!;
    if (b.t < t) continue;
    const a = track[i - 1]!;
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    return { x: a.p.x + (b.p.x - a.p.x) * f, y: a.p.y + (b.p.y - a.p.y) * f, z: a.p.z + (b.p.z - a.p.z) * f };
  }
  return track[track.length - 1]!.p;
}

/** The moment to judge a shot at: what the shooter saw (their clock less the view delay),
 * never further back than the rewind limit, never in the future. */
export function judgedAt(now: number, shooterSaw: number): number {
  return Math.min(now, Math.max(now - ARENA.rewind, shooterSaw - ARENA.viewDelay));
}

export interface Candidate {
  readonly id: number;
  /** Feet, at the judged moment. */
  readonly p: Vec;
}

export interface ShotHit {
  readonly id: number;
  readonly head: boolean;
  readonly dist: number;
}

/** The first player a shot reaches before anything solid, if any. */
export function traceShot(
  solid: Solid,
  o: Vec,
  d: Vec,
  range: number,
  targets: readonly Candidate[],
): ShotHit | null {
  let best: ShotHit | null = null;
  for (const c of targets) {
    const head = rayBox(o, d, headBox(c.p), range);
    const body = rayBox(o, d, bodyBox(c.p), range);
    const t = head !== null && (body === null || head <= body) ? head : body;
    if (t === null || (best && t >= best.dist)) continue;
    best = { id: c.id, head: t === head, dist: t };
  }
  if (!best) return null;
  return clearDistance(solid, o, d, best.dist) >= best.dist - 0.05 ? best : null;
}

/** Players in a sword's arc: near enough, in front, and not behind a wall. */
export function inArc(
  solid: Solid,
  o: Vec,
  d: Vec,
  range: number,
  halfAngle: number,
  targets: readonly Candidate[],
): number[] {
  const out: number[] = [];
  for (const c of targets) {
    const m = chest(c.p);
    const dx = m.x - o.x;
    const dy = m.y - o.y;
    const dz = m.z - o.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > range + BODY.half) continue;
    // up close the body itself fills the arc
    const cos = dist < 0.6 ? 1 : (dx * d.x + dy * d.y + dz * d.z) / dist;
    if (cos < Math.cos(halfAngle + Math.atan2(BODY.half, Math.max(dist, 0.1)))) continue;
    if (sees(solid, o, m)) out.push(c.id);
  }
  return out;
}

/** Players a blast reaches, with how much of its damage each takes (all of it at the middle,
 * 40% at the edge; nothing through a wall). */
export function inBlast(
  solid: Solid,
  at: Vec,
  radius: number,
  targets: readonly Candidate[],
): { id: number; share: number }[] {
  const out: { id: number; share: number }[] = [];
  for (const c of targets) {
    const m = chest(c.p);
    const dist = Math.max(0, Math.hypot(m.x - at.x, m.y - at.y, m.z - at.z) - BODY.half);
    if (dist > radius) continue;
    // lifted a little off the ground so a blast at the feet still reaches the body
    if (!sees(solid, { x: at.x, y: at.y + 0.3, z: at.z }, m)) continue;
    out.push({ id: c.id, share: 0.4 + 0.6 * (1 - dist / radius) });
  }
  return out;
}

/** A launcher shell's flight: where it bursts (on the ground, cover, near a player other than
 * the shooter, or wherever it is when its life runs out). Same path as the shell drawn on the
 * shooter's screen (systems/tools/weapons.ts fireShell). */
export function shellBurst(solid: Solid, o: Vec, d: Vec, targets: readonly Candidate[]): Vec {
  const S = ARENA.shell;
  const dt = 1 / 60;
  let p = o;
  let v = { x: d.x * S.speed, y: d.y * S.speed + S.lift, z: d.z * S.speed };
  for (let t = 0; t < S.life; t += dt) {
    v = { x: v.x, y: v.y - S.gravity * dt, z: v.z };
    const step = Math.hypot(v.x, v.y, v.z) * dt;
    const dir = { x: (v.x * dt) / step, y: (v.y * dt) / step, z: (v.z * dt) / step };
    const stop = clearDistance(solid, p, dir, step);
    const next = { x: p.x + dir.x * stop, y: p.y + dir.y * stop, z: p.z + dir.z * stop };
    // a step is shorter than clearDistance's ground stride: test the ground where it lands
    if (stop < step - 1e-6 || next.y <= solid.heightAt(next.x, next.z)) return next;
    for (const c of targets) {
      const m = chest(c.p);
      if (Math.hypot(m.x - next.x, m.y - next.y, m.z - next.z) < S.probe + BODY.half) return next;
    }
    p = next;
  }
  return p;
}
