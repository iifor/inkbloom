import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { pathsOf } from './paths';

export interface FarmBuilding {
  x: number;
  z: number;
  hw: number;
  hd: number;
  foot: number;
  base: number;
  height: number;
  barn: boolean;
}

export interface Farmstead {
  x: number;
  z: number;
  hw: number;
  hd: number;
  front: 1 | -1;
  stoneWall: boolean;
  seed: number;
  buildings: readonly FarmBuilding[];
}

const SIZE = TUNING.world.chunkSize;
const CELL = TUNING.world.cellSize;
const GRID = 3;

export function farmsteadInChunk(
  w: Wilderness,
  cx: number,
  cz: number,
  obstacles: readonly { x: number; z: number; room: number }[],
): Farmstead | null {
  if (w.terrainVersion < 4) return null;
  // One candidate chunk per region, with empty regions and unsuitable sites left alone.
  const h = hashAt(w.seed, 'farmstead', Math.floor(cx / GRID), Math.floor(cz / GRID));
  if (
    unit(h) >= 0.85 ||
    ((cx % GRID) + GRID) % GRID !== hashInts(h, 1) % GRID ||
    ((cz % GRID) + GRID) % GRID !== hashInts(h, 2) % GRID
  )
    return null;
  const roll = unit(hashInts(h, 3));
  const count = roll < 0.52 ? 1 : roll < 0.85 ? 2 : 3;
  const hw = count === 1 ? 9 : 14;
  const hd = count === 3 ? 13 : 10;
  const paths = pathsOf(w);
  for (let i = 0; i < 12; i++) {
    const spot = hashInts(h, 10 + i);
    const x = cx * SIZE + 32 + unit(spot) * (SIZE - 64);
    const z = cz * SIZE + 32 + unit(hashInts(spot, 1)) * (SIZE - 64);
    if (Math.hypot(x - SIZE / 2, z - SIZE / 2) < 155 || w.townAt(x, z, 43)) continue;
    if (
      obstacles.some(
        (o) =>
          Math.hypot(Math.max(0, Math.abs(x - o.x) - hw), Math.max(0, Math.abs(z - o.z) - hd)) < o.room + 1,
      )
    )
      continue;
    const front = paths.edgeDistance(x, z + hd + 5) <= paths.edgeDistance(x, z - hd - 5) ? 1 : -1;
    const yard = groundRange(w, x, z, hw + 2, hd + 2);
    if (yard.low < WATER_LEVEL + 0.65 || yard.high - yard.low > 2.1) continue;
    let clear = true;
    for (let dx = -hw; dx <= hw && clear; dx += 2)
      for (let dz = -hd; dz <= hd && clear; dz += 2) clear = paths.edgeDistance(x + dx, z + dz) > 3;
    if (!clear) continue;
    const plans =
      count === 1
        ? [[0, -2, 4.2, 3.1]]
        : [
            [-6, -4.5, 4, 3],
            [6, -4, 3.4, 2.8],
          ];
    if (count === 3) plans.push([7.5, 6, 2.8, 2.45]);
    const buildings = plans.map(([dx, dz, width, depth], index): FarmBuilding => {
      const bx = x + dx!;
      const bz = z + dz! * front;
      const range = groundRange(w, bx, bz, width! + 0.25, depth! + 0.25);
      return {
        x: bx,
        z: bz,
        hw: width!,
        hd: depth!,
        foot: range.low - 0.14,
        base: range.high + 0.08,
        height: (index === 2 ? 2.8 : 3.25) + unit(hashInts(h, 40 + index)) * 0.65,
        barn: index === 1,
      };
    });
    if (buildings.some((b) => b.base - b.foot > 1.05)) continue;
    return { x, z, hw, hd, front, stoneWall: unit(hashInts(h, 4)) < 0.45, seed: h, buildings };
  }
  return null;
}

/** Include all grid corners of the terrain triangles that touch the footprint. */
function groundRange(w: Wilderness, x: number, z: number, hw: number, hd: number) {
  let low = Infinity;
  let high = -Infinity;
  for (let gx = Math.floor((x - hw) / CELL) * CELL; gx <= Math.ceil((x + hw) / CELL) * CELL; gx += CELL)
    for (let gz = Math.floor((z - hd) / CELL) * CELL; gz <= Math.ceil((z + hd) / CELL) * CELL; gz += CELL) {
      const y = w.heightAt(gx, gz);
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
  return { low, high };
}
