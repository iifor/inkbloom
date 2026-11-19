import type { CityLayout } from './layout';
import { ROAD_NONE } from './site';
import { villageOutline } from './outline';

export interface BoundarySpan {
  readonly x: number;
  readonly z: number;
  readonly tx: number;
  readonly tz: number;
  readonly length: number;
  readonly ix: number;
  readonly iz: number;
}

/** Geometry and collision share a curved border with road and river openings. */
export function boundarySpans(city: CityLayout): BoundarySpan[] {
  if (city.boundary === 'none') return [];
  const { n, cell, ox, oz } = city;
  const points = villageOutline(city).points;
  const spans: BoundarySpan[] = [];
  const clear = (x: number, z: number): boolean => {
    const ix = Math.floor((x - ox) / cell),
      iz = Math.floor((z - oz) / cell);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const gx = ix + dx,
          gz = iz + dz;
        if (gx < 0 || gz < 0 || gx >= n || gz >= n) continue;
        const i = gz * n + gx;
        if (city.roads[i] !== ROAD_NONE || city.water[i] || city.buildingOf[i]) return false;
      }
    return true;
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z),
      steps = Math.max(1, Math.ceil(length / cell));
    const tx = (b.x - a.x) / length,
      tz = (b.z - a.z) / length;
    for (let j = 0; j < steps; j++) {
      const len = length / steps;
      const x = a.x + tx * len * (j + 0.5),
        z = a.z + tz * len * (j + 0.5);
      if (
        !clear(x, z) ||
        !clear(x - (tx * len) / 2, z - (tz * len) / 2) ||
        !clear(x + (tx * len) / 2, z + (tz * len) / 2)
      )
        continue;
      spans.push({
        x,
        z,
        tx,
        tz,
        length: len,
        ix: Math.floor((x - ox) / cell),
        iz: Math.floor((z - oz) / cell),
      });
    }
  }
  return spans;
}
