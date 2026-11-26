import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { pathsOf } from './paths';

export type AnimalSpecies = 'rabbit' | 'bird' | 'boar';
export type OutdoorRole = 'gatherer' | 'ranger' | 'walker';
export interface LifeSite {
  readonly id: string;
  readonly seed: number;
  readonly x: number;
  readonly z: number;
  readonly kind: AnimalSpecies | OutdoorRole;
  readonly person: boolean;
  readonly count: number;
}

/** Flat, dry footing for an entire small group, not just its centre. */
export function lifeGround(w: Wilderness, x: number, z: number, radius = 5): boolean {
  const y = w.heightAt(x, z);
  if (y < WATER_LEVEL + 1 || w.townAt(x, z, 18)) return false;
  for (const [dx, dz] of [
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
  ]) {
    const h = w.heightAt(x + dx!, z + dz!);
    if (h < WATER_LEVEL + 0.6 || Math.abs(h - y) > radius * 0.3) return false;
  }
  return true;
}

/** Stable homes, independent of loading order and the viewer. Motion is local scenery. */
export function lifeInChunk(w: Wilderness, cx: number, cz: number): LifeSite[] {
  const size = TUNING.world.chunkSize;
  const seed = hashAt(w.seed, 'outdoor-life', cx, cz);
  const sites: LifeSite[] = [];
  const paths = pathsOf(w);
  if (unit(seed) < 0.8) {
    for (let a = 0; a < 12; a++) {
      const h = hashInts(seed, a, 1);
      const x = cx * size + 16 + unit(h) * (size - 32);
      const z = cz * size + 16 + unit(hashInts(h, 2)) * (size - 32);
      if (!lifeGround(w, x, z) || paths.edgeDistance(x, z) < 6) continue;
      const moisture = w.climate(x, z).moisture;
      const kind = moisture > 0.18 ? 'boar' : unit(hashInts(h, 3)) < 0.55 ? 'rabbit' : 'bird';
      sites.push({ id: `fauna:${cx},${cz}`, seed: h, x, z, kind, person: false, count: 2 + (h % 3) });
      break;
    }
  }
  // Along paths, but off the walking surface. One small outing per selected chunk.
  if (unit(hashInts(seed, 8)) < 0.65) {
    const trails = paths.trailsNear(cx * size, cz * size, (cx + 1) * size, (cz + 1) * size);
    for (const trail of trails) {
      for (let i = 2; i < trail.pts.length; i += 2) {
        const ax = trail.pts[i - 2]!,
          az = trail.pts[i - 1]!;
        const dx = trail.pts[i]! - ax,
          dz = trail.pts[i + 1]! - az;
        const length = Math.hypot(dx, dz);
        if (length < 1) continue;
        const h = hashInts(seed, i);
        const t = 0.2 + unit(h) * 0.6;
        const side = (h & 1 ? 1 : -1) * (trail.width / 2 + 5);
        const x = ax + dx * t - (dz / length) * side;
        const z = az + dz * t + (dx / length) * side;
        if (Math.floor(x / size) !== cx || Math.floor(z / size) !== cz) continue;
        if (!lifeGround(w, x, z, 7) || paths.bridgeAt(x, z)) continue;
        const kind = (['gatherer', 'ranger', 'walker'] as const)[h % 3]!;
        sites.push({ id: `outing:${cx},${cz}`, seed: h, x, z, kind, person: true, count: 1 });
        return sites;
      }
    }
  }
  return sites;
}
