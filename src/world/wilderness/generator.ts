// The wilderness is a set of global functions of (seed, x, z). Nothing here depends on which
// chunks were generated before, so neighbouring chunks always agree along their shared edge.
import { BIOMES, RULES, BIOME_INDEX, type ClimateSample } from '@/content/biomes';
import { LANDMARKS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import { hashAt } from '../math/hash';
import { createNoise2D, fbm, lerp, ridged, smoothstep, type Noise2D } from '../math/noise';

export const WATER_LEVEL = -0.75;

export interface Entrance {
  /** Stable city id; also the key of its save data. */
  readonly cityId: string;
  readonly chunk: readonly [number, number];
  /** World position of the landmark centre. */
  readonly x: number;
  readonly z: number;
  /** Ground height the landmark stands on. */
  readonly y: number;
  readonly landmark: number;
  readonly seed: number;
  /** Unit direction from the landmark to its door, axis-aligned. */
  readonly door: readonly [number, number];
}

export interface Wilderness {
  readonly seed: number;
  climate(x: number, z: number): ClimateSample;
  biomeAt(x: number, z: number): number;
  /** Terraced ground height. */
  heightAt(x: number, z: number): number;
  /** Ground height before terracing and entrance flattening. */
  rawHeightAt(x: number, z: number): number;
  entranceInCell(gx: number, gz: number): Entrance | null;
  /** Entrances whose grid cell is within `cells` of the cell containing (x, z). */
  entrancesNear(x: number, z: number, cells?: number): Entrance[];
}

const W = TUNING.world;
const S = TUNING.structures;

export function cityCellOf(chunk: number): number {
  const half = Math.floor(S.cityGrid / 2);
  return Math.floor((chunk + half) / S.cityGrid);
}

export function createWilderness(seed: number): Wilderness {
  const n = (salt: string): Noise2D => createNoise2D(hashAt(seed, salt));
  const reliefN = n('relief');
  const moistN = n('moisture');
  const waterN = n('water');
  const baseN = n('base');
  const hillN = n('hills');
  const peakN = n('peaks');

  const climate = (x: number, z: number): ClimateSample => {
    const dist = Math.hypot(x, z);
    return {
      relief: fbm(reliefN, x / 1100, z / 1100, 3),
      moisture: fbm(moistN, x / 800, z / 800, 3),
      water: Math.abs(fbm(waterN, x / 1400, z / 1400, 3)),
      wildness: smoothstep(W.spawnCalmRadius * 0.4, W.spawnCalmRadius * 1.6, dist),
    };
  };

  const biomeAt = (x: number, z: number): number => {
    const s = climate(x, z);
    for (const rule of RULES) if (rule.when(s)) return BIOME_INDEX.get(rule.biome)!;
    return BIOMES.length - 1;
  };

  const rawHeightAt = (x: number, z: number): number => {
    const s = climate(x, z);
    const wild = s.wildness;
    let h = 2.5 * fbm(baseN, x / 300, z / 300, 3) + 1.5;
    h += 6 * fbm(hillN, x / 140, z / 140, 3) * (0.25 + 0.75 * wild);
    const mountain = smoothstep(0.2, 0.7, s.relief) * smoothstep(0.4, 0.8, wild);
    h += mountain * 26 * (0.65 + 0.35 * fbm(peakN, x / 60, z / 60, 2));
    const river = smoothstep(0.09, 0.025, s.water) * smoothstep(0.25, 0.5, wild);
    h = lerp(h, -2, river);
    return h;
  };

  const cache = new Map<string, Entrance | null>();
  const entranceInCell = (gx: number, gz: number): Entrance | null => {
    const key = `${gx},${gz}`;
    if (cache.has(key)) return cache.get(key)!;
    const half = Math.floor(S.cityGrid / 2);
    let cx: number;
    let cz: number;
    if (gx === 0 && gz === 0) [cx, cz] = S.firstCityChunk;
    else {
      const h = hashAt(seed, 'city-cell', gx, gz);
      cx = gx * S.cityGrid - half + (h % S.cityGrid);
      cz = gz * S.cityGrid - half + ((h >>> 8) % S.cityGrid);
    }
    const x = (cx + 0.5) * W.chunkSize;
    const z = (cz + 0.5) * W.chunkSize;
    const base = rawHeightAt(x, z);
    const first = gx === 0 && gz === 0;
    let entrance: Entrance | null = null;
    if (first || base > WATER_LEVEL + 1) {
      const h = hashAt(seed, 'city', cx, cz);
      // door faces the world origin so the first approach meets it
      const door: [number, number] = Math.abs(x) > Math.abs(z) ? [-Math.sign(x), 0] : [0, -Math.sign(z) || 1];
      entrance = {
        cityId: `c${cx}_${cz}`,
        chunk: [cx, cz],
        x,
        z,
        y: Math.round(Math.max(base, 0.5) / W.terraceStep) * W.terraceStep,
        landmark: h % LANDMARKS.length,
        seed: h,
        door,
      };
    }
    cache.set(key, entrance);
    return entrance;
  };

  const entrancesNear = (x: number, z: number, cells = 1): Entrance[] => {
    const gx = cityCellOf(Math.floor(x / W.chunkSize));
    const gz = cityCellOf(Math.floor(z / W.chunkSize));
    const out: Entrance[] = [];
    for (let dx = -cells; dx <= cells; dx++)
      for (let dz = -cells; dz <= cells; dz++) {
        const e = entranceInCell(gx + dx, gz + dz);
        if (e) out.push(e);
      }
    return out;
  };

  const heightAt = (x: number, z: number): number => {
    let h = rawHeightAt(x, z);
    for (const e of entrancesNear(x, z, 1)) {
      const d = Math.hypot(x - e.x, z - e.z);
      const f = smoothstep(S.entranceFlatRadius, S.entranceFlatRadius * 0.55, d);
      if (f > 0) h = lerp(h, e.y, f);
    }
    return Math.round(h / W.terraceStep) * W.terraceStep;
  };

  return { seed, climate, biomeAt, heightAt, rawHeightAt, entranceInCell, entrancesNear };
}
