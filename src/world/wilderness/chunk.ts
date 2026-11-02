// A wilderness chunk as plain data. The renderer and physics build from this; tests check it.
import { BIOMES } from '@/content/biomes';
import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { type Entrance, type Wilderness, WATER_LEVEL } from './generator';
import { type PigmentSource, sourcesInChunk } from './sources';

export interface Tree {
  readonly x: number;
  readonly z: number;
  /** Ground height under the trunk. */
  readonly y: number;
  readonly height: number;
  readonly crown: number;
  readonly color: number;
}

export interface WildChunk {
  readonly cx: number;
  readonly cz: number;
  /** World position of the chunk's minimum corner. */
  readonly x0: number;
  readonly z0: number;
  /** Cells per side. */
  readonly n: number;
  readonly cell: number;
  /** Terraced height at each cell, row-major [iz * n + ix]. */
  readonly heights: Float32Array;
  readonly biomes: Uint8Array;
  readonly trees: readonly Tree[];
  readonly hasWater: boolean;
  readonly entrance: Entrance | null;
  readonly sources: readonly PigmentSource[];
}

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

export function generateWildChunk(w: Wilderness, cx: number, cz: number): WildChunk {
  const size = TUNING.world.chunkSize;
  const cell = TUNING.world.cellSize;
  const n = size / cell;
  const x0 = cx * size;
  const z0 = cz * size;
  const heights = new Float32Array(n * n);
  const biomes = new Uint8Array(n * n);
  let hasWater = false;
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const x = x0 + (ix + 0.5) * cell;
      const z = z0 + (iz + 0.5) * cell;
      const h = w.heightAt(x, z);
      heights[iz * n + ix] = h;
      biomes[iz * n + ix] = w.biomeAt(x, z);
      if (h < WATER_LEVEL) hasWater = true;
    }

  const entrances = w.entrancesNear(x0 + size / 2, z0 + size / 2, 1);
  const entrance = entrances.find((e) => e.chunk[0] === cx && e.chunk[1] === cz) ?? null;
  const clear = TUNING.structures.entranceFlatRadius;

  const trees: Tree[] = [];
  const at = (ix: number, iz: number): number =>
    ix >= 0 && iz >= 0 && ix < n && iz < n
      ? heights[iz * n + ix]!
      : w.heightAt(x0 + (ix + 0.5) * cell, z0 + (iz + 0.5) * cell);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const biome = BIOMES[biomes[iz * n + ix]!]!;
      const h = hashAt(w.seed, 'tree', cx * n + ix, cz * n + iz);
      if (unit(h) >= biome.treeDensity) continue;
      const y = heights[iz * n + ix]!;
      if (y < WATER_LEVEL + 0.5) continue;
      const slope = Math.max(
        Math.abs(at(ix + 1, iz) - y),
        Math.abs(at(ix - 1, iz) - y),
        Math.abs(at(ix, iz + 1) - y),
        Math.abs(at(ix, iz - 1) - y),
      );
      if (slope > biome.treeMaxSlope) continue;
      const x = x0 + (ix + 0.2 + 0.6 * unit(h >>> 3)) * cell;
      const z = z0 + (iz + 0.2 + 0.6 * unit(h >>> 11)) * cell;
      if (Math.hypot(x, z) < 14) continue;
      if (entrances.some((e) => Math.hypot(x - e.x, z - e.z) < clear)) continue;
      trees.push({
        x,
        z,
        y,
        height: 4 + 5 * unit(h >>> 5),
        crown: 1.6 + 1.4 * unit(h >>> 17),
        color: biome.treeColor,
      });
    }

  const sources = sourcesInChunk(w, cx, cz);
  // keep trees off the sources so they stay visible and reachable
  const clearTrees = trees.filter((t) => !sources.some((src) => Math.hypot(t.x - src.x, t.z - src.z) < 4));
  return { cx, cz, x0, z0, n, cell, heights, biomes, trees: clearTrees, hasWater, entrance, sources };
}
