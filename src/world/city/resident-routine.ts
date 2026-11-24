// A resident's outing is reproducible from home, occupation and the world clock.
// Models can be unloaded or observed by different players without restarting the walk.
import { hashInts, unit } from '../math/hash';
import { findPath, type NavGrid, type Waypoint } from '../nav/path';

export type Occupation = 'guard' | 'woodcutter' | 'mage' | 'villager';
export type ResidentMotion = 'idle' | 'walk' | 'interact' | 'slash';
export interface ResidentHome extends Waypoint {
  angle: number;
  seed: number;
  since?: number;
}
export interface ActivitySite extends Waypoint {
  facing?: number;
}
export interface Neighbourhood {
  grid: NavGrid;
  ground(x: number, z: number): number;
  sites: Record<Occupation, readonly ActivitySite[]>;
  streets: readonly ActivitySite[];
}

const jobs = {
  guard: { range: 180, speed: 2.1, work: 10, motion: 'idle' },
  woodcutter: { range: 140, speed: 1.65, work: 22, motion: 'slash' },
  mage: { range: 120, speed: 1.5, work: 18, motion: 'interact' },
  villager: { range: 90, speed: 1.55, work: 12, motion: 'interact' },
} as const;
export const MAX_ROAM = Math.max(...Object.values(jobs).map((j) => j.range));
const SHIFT = 240;

export function outingTime(home: ResidentHome, clock: number) {
  const offset = home.since === undefined ? unit(hashInts(home.seed, 11)) * SHIFT : -home.since;
  const time = Math.max(0, clock + offset);
  return { shift: Math.floor(time / SHIFT), phase: time % SHIFT };
}

export interface Outing {
  points: Waypoint[];
  lengths: number[];
  distance: number;
  facing: number;
  working: boolean;
}

function cellCentre(grid: NavGrid, p: Waypoint) {
  const ox = grid.ox ?? 0,
    oz = grid.oz ?? 0;
  const ix = Math.floor((p.x - ox) / grid.cell),
    iz = Math.floor((p.z - oz) / grid.cell);
  return { ix, iz, x: ox + (ix + 0.5) * grid.cell, z: oz + (iz + 0.5) * grid.cell };
}

// A doorway on a rotated fence can share its raster cell with the fence.
function doorstep(grid: NavGrid, home: ResidentHome): Waypoint | undefined {
  const c = cellCentre(grid, home);
  if (grid.walkable(c.ix, c.iz)) return home;
  let nearest: Waypoint | undefined;
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      if (!grid.walkable(c.ix + dx, c.iz + dz)) continue;
      const x = c.x + dx * grid.cell,
        z = c.z + dz * grid.cell;
      const distance = Math.hypot(x - home.x, z - home.z);
      if (distance < best) {
        best = distance;
        nearest = { x, z };
      }
    }
  return nearest;
}

export function planOuting(area: Neighbourhood, home: ResidentHome, job: Occupation, shift: number): Outing {
  const spec = jobs[job];
  const { grid } = area;
  const startPoint = doorstep(grid, home);
  const resting = {
    points: [startPoint ?? home],
    lengths: [0],
    distance: 0,
    facing: home.angle,
    working: false,
  };
  if (!startPoint) return resting;
  // Rotate through nearby destinations; a resident without a reachable workplace takes a street walk.
  for (const [pass, sites] of [area.sites[job], area.streets].entries()) {
    const choices = sites.filter((p) => {
      const d = Math.hypot(p.x - home.x, p.z - home.z);
      return d >= 3 && d <= spec.range;
    });
    if (!choices.length) continue;
    const start = hashInts(home.seed, shift, pass) % choices.length;
    for (let i = 0; i < Math.min(choices.length, 4); i++) {
      const goal = choices[(start + i) % choices.length]!;
      const target = cellCentre(grid, goal);
      const path = findPath(grid, startPoint, { x: target.x, z: target.z }, 4500);
      const end = path?.at(-1);
      if (!path || !end || Math.hypot(end.x - goal.x, end.z - goal.z) > 3) continue;
      // Path smoothing tests lines between cell centres. Stay on those lines except
      // for the short stretches inside the doorway and destination cells.
      const origin = cellCentre(grid, startPoint);
      const points: Waypoint[] = [startPoint];
      if (origin.x !== startPoint.x || origin.z !== startPoint.z) points.push(origin);
      points.push(...path);
      if (end.x === target.x && end.z === target.z && (end.x !== goal.x || end.z !== goal.z))
        points.push(goal);
      const lengths = [0];
      for (let k = 1; k < points.length; k++)
        lengths.push(
          lengths[k - 1]! + Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.z - points[k - 1]!.z),
        );
      const distance = lengths[lengths.length - 1]!;
      if (distance < 2 || distance > spec.range || (2 * distance) / spec.speed + spec.work + 8 > SHIFT)
        continue;
      return { points, lengths, distance, facing: goal.facing ?? home.angle, working: pass === 0 };
    }
  }
  return resting;
}

export function residentPose(home: ResidentHome, job: Occupation, outing: Outing, phase: number) {
  const spec = jobs[job];
  const trip = outing.distance / spec.speed;
  // A short outing can be repeated; each shift ends at home before the next destination is chosen.
  const period = 2 * trip + spec.work + 8;
  const local = phase % period;
  const start = outing.points[0]!;
  const homePose = { x: start.x, z: start.z, angle: home.angle, motion: 'idle' as ResidentMotion };
  if (!trip || phase - local + period > SHIFT + 1e-8 || local < 4 || local >= 4 + 2 * trip + spec.work)
    return homePose;
  if (local >= 4 + trip && local < 4 + trip + spec.work) {
    const at = outing.points[outing.points.length - 1]!;
    const workTime = local - 4 - trip;
    return {
      x: at.x,
      z: at.z,
      angle: outing.facing + (job === 'guard' ? Math.sin(workTime * 0.5) * 0.8 : 0),
      motion: outing.working && workTime % 5 < 2 ? spec.motion : ('idle' as const),
    };
  }
  const back = local >= 4 + trip + spec.work;
  const distance = (back ? 4 + 2 * trip + spec.work - local : local - 4) * spec.speed;
  let k = 1;
  while (k < outing.lengths.length - 1 && outing.lengths[k]! < distance) k++;
  const a = outing.points[k - 1]!,
    b = outing.points[k]!;
  const t =
    (distance - outing.lengths[k - 1]!) / Math.max(0.000001, outing.lengths[k]! - outing.lengths[k - 1]!);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    angle: Math.atan2(b.x - a.x, b.z - a.z) + (back ? Math.PI : 0),
    motion: 'walk' as const,
  };
}
