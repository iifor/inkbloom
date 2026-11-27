import { hashAt } from '../math/hash';
import { Rng } from '../math/rng';
import type { WildChunk } from './chunk';
import { type Wilderness, WATER_LEVEL } from './generator';
import { pathsOf } from './paths';
import { waterCurrentsOf } from './water-current';

const crops = ['Wheat', 'Corn', 'Pumpkin'] as const;
type Crop = (typeof crops)[number];
export type CountryProp =
  | 'market'
  | 'windmill'
  | 'watermill'
  | 'sea_boat_sail_a'
  | 'sea_rowboat_large'
  | 'Column'
  | 'Column_Broken'
  | 'Statue_Horse'
  | `${Crop}_${1 | 2 | 3 | 4 | 'Crop'}`;
export interface CountrySite {
  model: CountryProp;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Longest horizontal dimension in metres. */
  width: number;
  wheelDirection?: number;
}

/** Placement uses the completed chunk, so props can respect its yards, roads and ecology. */
export function countrysideSites(w: Wilderness, chunk: WildChunk): CountrySite[] {
  const { cx, cz, x0, z0, n, cell, farmstead: farm } = chunk;
  const sites: CountrySite[] = [];
  const rng = new Rng(hashAt(w.seed, 'countryside', cx, cz));
  const paths = pathsOf(w);
  const inside = (x: number, z: number, r: number) =>
    x >= x0 + r && x <= x0 + n * cell - r && z >= z0 + r && z <= z0 + n * cell - r;
  function clear(x: number, z: number, r: number) {
    return (
      inside(x, z, r) &&
      Math.hypot(x, z) > 18 + r &&
      !w.townAt(x, z, r + 2) &&
      paths.edgeDistance(x, z) > r + 0.5 &&
      !chunk.trees.some((t) => Math.hypot(x - t.x, z - t.z) < r + 1) &&
      !chunk.groundProps.some((p) => Math.hypot(x - p.x, z - p.z) < r + p.scale * 1.5) &&
      !chunk.sources.some((s) => Math.hypot(x - s.x, z - s.z) < r + 1.8) &&
      !chunk.springs.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + r + 2) &&
      !chunk.lookouts.some((l) => Math.hypot(x - l.x, z - l.z) < r + 8) &&
      !(farm && Math.abs(x - farm.x) < farm.hw + r && Math.abs(z - farm.z) < farm.hd + r) &&
      !sites.some((s) => Math.hypot(x - s.x, z - s.z) < r + s.width * 0.53)
    );
  }
  function land(x: number, z: number, r: number) {
    if (!clear(x, z, r)) return false;
    const y = w.heightAt(x, z);
    return (
      y > WATER_LEVEL + 0.14 &&
      [-1, 1].every((dx) =>
        [-1, 1].every((dz) => {
          const corner = w.heightAt(x + dx * r, z + dz * r);
          return corner > WATER_LEVEL && Math.abs(corner - y) < 0.15 + r * 0.1;
        }),
      )
    );
  }
  function place(model: CountryProp, x: number, z: number, width: number, yaw: number, y = w.heightAt(x, z)) {
    sites.push({ model, x, y, z, width, yaw });
  }
  if (farm) {
    const side = rng.chance(0.5) ? 1 : -1;
    for (const sign of [side, -side]) {
      const x = farm.x + sign * (farm.hw + 5),
        z = farm.z;
      if (!land(x, z, 3.7)) continue;
      const crop = rng.pick(crops);
      const stage = rng.pick([1, 2, 3, 4] as const);
      const matureWidth = crop === 'Corn' ? 0.8 : crop === 'Pumpkin' ? 1.1 : 0.16;
      const rows = crop === 'Wheat' ? 9 : 4,
        step = crop === 'Wheat' ? 0.45 : 0.95;
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < 3; col++) {
          const size = rng.range(0.85, 1.1) * matureWidth * (0.4 + stage * 0.15);
          place(
            `${crop}_${stage}`,
            x + (row - (rows - 1) / 2) * step,
            z + (col - 1) * 1.1 + rng.range(-0.08, 0.08),
            size,
            rng.range(-0.35, 0.35),
          );
        }
      break;
    }
    const building = rng.chance(0.5) ? 'market' : 'windmill';
    for (const sign of [side, -side]) {
      const x = farm.x + sign * (farm.hw + 6),
        z = farm.z + farm.front * (farm.hd - 1);
      if (!land(x, z, 3.8)) continue;
      place(building, x, z, building === 'market' ? 4.7 : 5.6, farm.front === 1 ? 0 : Math.PI);
      if (building === 'market') {
        const produce = rng.pick(crops);
        for (let i = 0; i < 3; i++)
          place(`${produce}_Crop`, x + i * 0.44 - 0.44, z + farm.front * 2.35, 0.4, rng.next() * 3);
      }
      break;
    }
  }
  for (const ruin of chunk.ruins) {
    const start = rng.range(0, 2 * Math.PI);
    for (let i = 0; i < 5; i++) {
      const angle = start + i * 1.26,
        x = ruin.x + Math.sin(angle) * 10,
        z = ruin.z + Math.cos(angle) * 10;
      if (land(x, z, 1.3))
        place(
          rng.pick(['Column', 'Column_Broken', 'Statue_Horse'] as const),
          x,
          z,
          rng.range(1.1, 1.8),
          angle + Math.PI,
        );
      if (sites.filter((s) => s.model.startsWith('Column') || s.model === 'Statue_Horse').length >= 2) break;
    }
  }
  if (chunk.hasWater && rng.chance(0.48)) {
    const start = rng.int(0, n * n - 1);
    const mill = rng.chance(0.32);
    for (let i = 0; i < n * n; i++) {
      const k = (start + i) % (n * n);
      const bed = chunk.heights[k]!;
      if (bed > WATER_LEVEL - 0.35 || bed < WATER_LEVEL - 2.1) continue;
      const x = x0 + ((k % n) + 0.5) * cell,
        z = z0 + (Math.floor(k / n) + 0.5) * cell;
      if (!inside(x, z, 5) || paths.edgeDistance(x, z) < 5 || w.townAt(x, z, 5)) continue;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const bx = x + dx * 5,
          bz = z + dz * 5;
        if (w.heightAt(bx, bz) < WATER_LEVEL + 0.12) continue;
        if (mill) {
          if (w.heightAt(bx, bz) > WATER_LEVEL + 1.1) continue;
          // The axle is 1.5 m toward -Z from the model centre. Survey its wet and dry sides.
          let placed = false;
          for (const inset of [2, 3, 4, 5]) {
            const mx = x + dx * inset,
              mz = z + dz * inset;
            if (
              !clear(mx, mz, 3.5) ||
              w.heightAt(mx - dx * 1.5, mz - dz * 1.5) > WATER_LEVEL - 0.09 ||
              w.heightAt(mx + dx * 1.8, mz + dz * 1.8) < WATER_LEVEL + 0.05
            )
              continue;
            const yaw = Math.atan2(dx, dz),
              flow = waterCurrentsOf(w).surfaceAt(x, z);
            place('watermill', mx, mz, 6.2, yaw, WATER_LEVEL - 0.49);
            sites[sites.length - 1]!.wheelDirection =
              Math.sign(flow.x * Math.cos(yaw) - flow.z * Math.sin(yaw)) || 1;
            placed = true;
            break;
          }
          if (!placed) continue;
        } else {
          if (!clear(x, z, 2.6)) continue;
          const flow = waterCurrentsOf(w).surfaceAt(x, z);
          const yaw = Math.hypot(flow.x, flow.z) > 0.01 ? Math.atan2(flow.x, flow.z) : Math.atan2(-dz, dx);
          if (
            [-1, 1].some(
              (sign) =>
                w.heightAt(x + sign * 2 * Math.sin(yaw), z + sign * 2 * Math.cos(yaw)) > WATER_LEVEL - 0.22,
            )
          )
            continue;
          place(rng.chance(0.35) ? 'sea_boat_sail_a' : 'sea_rowboat_large', x, z, 4, yaw, WATER_LEVEL - 0.18);
        }
        return sites;
      }
    }
  }
  return sites;
}
