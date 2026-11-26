// The wilderness is a set of global functions of (seed, x, z). Nothing here depends on which
// chunks were generated before, so neighbouring chunks always agree along their shared edge.
import { BIOME_INDEX, climateBiome, type ClimateSample } from '@/content/biomes';
import { TUNING } from '@/content/tuning';
import type { Face } from '../city/layout';
import { settlementChunks } from '../city/settlement';
import { hashAt } from '../math/hash';
import { createNoise2D, fbm, lerp, smoothstep, type Noise2D } from '../math/noise';
import { pathsOf } from './paths';
import { WATER_LEVEL } from './water-level';
import { createLandforms } from './landforms';
import { createDrainage, type Drainage } from './drainage';
import { TERRAIN_VERSION, type TerrainVersion } from './terrain-version';
import { RIVER_LANE, RIVER_X } from './river-corridors';
import { createSettlementSiting } from './settlement-siting';

export { WATER_LEVEL } from './water-level';
/** Rivers run north–south, this many metres apart, the first this far east of spawn. */
export { RIVER_LANE, RIVER_X } from './river-corridors';
/** Height above the water where the sandy bank gives way to a full meadow. */
export const BANK_HEIGHT = 0.9;

/** Exposed sand also follows the old riverbeds in the climate map, including on dry ground. */
export function riverbedMeadow(s: ClimateSample): number {
  return 1 - smoothstep(0.24, 0.4, s.wildness) * (1 - smoothstep(0.025, 0.065, s.water));
}

/** A town: where it stands in the world. The name is historical (towns used to be entered
 * through a door in the wilderness); every system that keys on a city still uses it. */
export interface Entrance {
  /** Stable city id; also the key of its save data. */
  readonly cityId: string;
  /** World position of the town's centre. */
  readonly x: number;
  readonly z: number;
  /** The town's average ground height; its hills rise and fall about it. */
  readonly y: number;
  /** The town's north-west corner (smallest x and z) and side length, metres. */
  readonly ox: number;
  readonly oz: number;
  readonly size: number;
  readonly seed: number;
  /** City size in blocks per side. */
  readonly chunks: number;
  /** The wall the main gate is in: the one facing the world origin, so the first approach
   * from spawn meets it. */
  readonly gate: Face;
}

/** Metres from a point to a town's footprint; 0 inside it. */
export function townDistance(e: Entrance, x: number, z: number): number {
  const dx = Math.max(e.ox - x, 0, x - e.ox - e.size);
  const dz = Math.max(e.oz - z, 0, z - e.oz - e.size);
  return Math.hypot(dx, dz);
}

export interface Wilderness {
  readonly seed: number;
  readonly terrainVersion: TerrainVersion;
  /** Towns loaded from older saves keep their original footprint. */
  readonly legacyTowns: readonly string[];
  climate(x: number, z: number): ClimateSample;
  biomeAt(x: number, z: number): number;
  /** Ground height including riverbeds, lake shelves and the level ground of towns. */
  heightAt(x: number, z: number): number;
  /** Surveyed terrain before road cut/fill. Routing must use this to avoid feedback. */
  terrainHeightAt(x: number, z: number): number;
  /** Ground height before water channels and town levelling. */
  rawHeightAt(x: number, z: number): number;
  entranceInCell(gx: number, gz: number): Entrance | null;
  /** Towns whose grid cell is within `cells` of the cell containing (x, z). */
  entrancesNear(x: number, z: number, cells?: number): Entrance[];
  /** The town whose footprint, grown by `margin` metres, contains the point. */
  townAt(x: number, z: number, margin?: number): Entrance | null;
  /** River `lane` (rivers run north–south, `RIVER_LANE` metres apart) at z: the x of its middle
   * and its half-width there. */
  riverAt(lane: number, z: number): { x: number; half: number };
  waterGuidesAt: Drainage['waterGuidesAt'];
}

const W = TUNING.world;
const S = TUNING.structures;
/** 0..1 from the low bits of a hash. */
const unit = (h: number): number => (h & 0x3ff) / 1024;

export function cityCellOf(chunk: number): number {
  const half = Math.floor(S.cityGrid / 2);
  return Math.floor((chunk + half) / S.cityGrid);
}

export function createWilderness(
  seed: number,
  legacyTowns: readonly string[] = [],
  terrainVersion: TerrainVersion = TERRAIN_VERSION,
): Wilderness {
  const legacy = new Set(legacyTowns);
  const n = (salt: string): Noise2D => createNoise2D(hashAt(seed, salt));
  const reliefN = n('relief');
  const moistN = n('moisture');
  const waterN = n('water');
  const baseN = n('base');
  const hillN = n('hills');
  const peakN = n('peaks');

  const bends = n('river-bends');
  const spawn = W.chunkSize / 2;
  const landforms = createLandforms(seed);
  const drainage = createDrainage(seed, (x, z) => landforms(x, z).height, terrainVersion >= 3, terrainVersion >= 6);
  // Preserve the introductory valley, then gradually reveal the larger regions.
  const regional = (x: number, z: number) =>
    terrainVersion === 1 ? 0 : smoothstep(700, 1100, Math.hypot(x - spawn, z - spawn));

  // Continuous channels cross chunk boundaries. The first one crosses the route to the city.
  const riverMiddle = (lane: number, z: number): number => {
    const t = (z - spawn) / 155;
    return spawn + RIVER_X + lane * RIVER_LANE + 29 * bends(lane + 0.3, t) + 12 * Math.sin(t * 1.8);
  };
  const riverHalf = (z: number): number => 11 + 15 * smoothstep(0.1, 0.7, bends(4.3, z / 270));
  const riverDistance = (x: number, z: number): number =>
    Math.abs(x - riverMiddle(Math.round((x - spawn - RIVER_X) / RIVER_LANE), z));

  const legacyClimate = (x: number, z: number): ClimateSample => {
    const dist = Math.hypot(x, z);
    return {
      relief: fbm(reliefN, x / 1100, z / 1100, 3),
      moisture: fbm(moistN, x / 800, z / 800, 3),
      water: Math.abs(fbm(waterN, x / 1400, z / 1400, 3)),
      wildness: smoothstep(W.spawnCalmRadius * 0.4, W.spawnCalmRadius * 1.6, dist),
    };
  };
  const climate = (x: number, z: number): ClimateSample => {
    const s = legacyClimate(x, z),
      blend = regional(x, z);
    if (!blend) return s;
    return {
      ...s,
      relief: lerp(s.relief, landforms(x, z).mountain * 0.9, blend),
      // Wet ground is defined by the carved channel, not unrelated noise contours.
      water: lerp(s.water, Math.max(0.12, s.water), blend),
    };
  };

  const biomeAt = (x: number, z: number): number => {
    if (terrainHeightAt(x, z) <= WATER_LEVEL + 0.2) return BIOME_INDEX.get('water')!;
    return BIOME_INDEX.get(climateBiome(climate(x, z)))!;
  };

  const rawHeightAt = (x: number, z: number): number => {
    const blend = regional(x, z);
    if (blend === 1) return landforms(x, z).height;
    const s = legacyClimate(x, z);
    const wild = s.wildness;
    let h = 2.5 * fbm(baseN, x / 300, z / 300, 3) + 1.5;
    h += 6 * fbm(hillN, x / 140, z / 140, 3) * (0.25 + 0.75 * wild);
    const mountain = smoothstep(0.2, 0.7, s.relief) * smoothstep(0.4, 0.8, wild);
    h += mountain * 26 * (0.65 + 0.35 * fbm(peakN, x / 60, z / 60, 2));
    const river = smoothstep(0.09, 0.025, s.water) * smoothstep(0.25, 0.5, wild);
    h = lerp(h, -2, river);
    return blend ? lerp(h, landforms(x, z).height, blend) : h;
  };

  const siteInCell = createSettlementSiting(seed, (x, z) =>
    drainage.basinGround(drainage.riverGround(rawHeightAt(x, z), x, z), x, z),
  );
  /** Numeric key for a pair of city-cell coordinates (cells are hundreds of metres across). */
  const cellKey = (gx: number, gz: number): number => (gx + 32768) * 65536 + (gz + 32768);
  const cache = new Map<number, Entrance | null>();
  const entranceInCell = (gx: number, gz: number): Entrance | null => {
    const key = cellKey(gx, gz);
    const known = cache.get(key);
    if (known !== undefined) return known;
    const half = Math.floor(S.cityGrid / 2);
    const first = gx === 0 && gz === 0;
    // the id names a chunk of the cell, as it always has, so saved progress keeps its key
    let cx: number;
    let cz: number;
    if (first) [cx, cz] = S.firstCityChunk;
    else {
      const h = hashAt(seed, 'city-cell', gx, gz);
      cx = gx * S.cityGrid - half + (h % S.cityGrid);
      cz = gz * S.cityGrid - half + ((h >>> 8) % S.cityGrid);
    }
    const h = hashAt(seed, 'city', cx, cz);
    const chunks = first
      ? TUNING.city.firstCityChunks
      : legacy.has(`c${cx}_${cz}`)
        ? TUNING.city.chunks
        : settlementChunks(seed, cx, cz);
    const size = chunks * W.chunkSize;
    let ox: number;
    let oz: number;
    if (first) [ox, oz] = S.firstTownOrigin;
    else if (terrainVersion >= 5) {
      const site = siteInCell(gx, gz, size);
      if (!site) {
        cache.set(key, null);
        return null;
      }
      ({ ox, oz } = site);
    } else {
      // the middle of the cell, nudged a little, so towns never crowd one another
      const mid = (S.cityGrid * 0.5 - half) * W.chunkSize;
      ox = gx * S.cityGrid * W.chunkSize + mid - size / 2 + S.townJitter * (2 * unit(h >>> 4) - 1);
      oz = gz * S.cityGrid * W.chunkSize + mid - size / 2 + S.townJitter * (2 * unit(h >>> 14) - 1);
      // on the terrain's own 4 m grid, so the town's ground and the land meet corner to corner
      ox = Math.round(ox / W.cellSize) * W.cellSize;
      oz = Math.round(oz / W.cellSize) * W.cellSize;
      if (regional(ox + size / 2, oz + size / 2) === 1) {
        // Keep the same town ids and cell bounds; choose a gentler, drier site within that cell.
        const centreX = gx * S.cityGrid * W.chunkSize + mid;
        const centreZ = gz * S.cityGrid * W.chunkSize + mid;
        const limit = (S.cityGrid * W.chunkSize - size) / 2 - S.townSkirt;
        let best = Infinity,
          bestX = ox,
          bestZ = oz;
        for (const dx of [-limit, 0, limit])
          for (const dz of [-limit, 0, limit]) {
            const px = Math.round((centreX + dx - size / 2) / W.cellSize) * W.cellSize;
            const pz = Math.round((centreZ + dz - size / 2) / W.cellSize) * W.cellSize;
            let low = Infinity,
              high = -Infinity,
              total = 0,
              wet = 0;
            for (const u of [0.15, 0.5, 0.85])
              for (const v of [0.15, 0.5, 0.85]) {
                const x = px + u * size,
                  z = pz + v * size;
                const height = drainage.basinGround(drainage.riverGround(rawHeightAt(x, z), x, z), x, z);
                low = Math.min(low, height);
                high = Math.max(high, height);
                total += height;
                if (height < WATER_LEVEL + 0.5) wet++;
              }
            const score = high - low + (total / 9) * 0.12 + wet * 8 + Math.hypot(px - ox, pz - oz) * 0.003;
            if (score < best) {
              best = score;
              bestX = px;
              bestZ = pz;
            }
          }
        ox = bestX;
        oz = bestZ;
      }
    }
    // the town's hills are the land's, gentler, about its average height
    const surveyed = regional(ox + size / 2, oz + size / 2) === 1;
    let sum = 0;
    for (let i = 0; i < 5; i++)
      for (let k = 0; k < 5; k++) {
        const x = ox + ((i + 0.5) / 5) * size,
          z = oz + ((k + 0.5) / 5) * size;
        const raw = rawHeightAt(x, z);
        sum += surveyed ? drainage.basinGround(drainage.riverGround(raw, x, z), x, z) : raw;
      }
    const y = sum / 25;
    let entrance: Entrance | null = null;
    if (first || y > WATER_LEVEL + 1) {
      const x = ox + size / 2;
      const z = oz + size / 2;
      const gate: Face = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'nx' : 'px') : z > 0 ? 'nz' : 'pz';
      entrance = {
        cityId: `c${cx}_${cz}`,
        x,
        z,
        y: Math.max(y, WATER_LEVEL + 1.25),
        ox,
        oz,
        size,
        seed: h,
        chunks,
        gate: first ? 'nx' : gate,
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

  // heightAt runs thousands of times per chunk: keep each city cell's neighbourhood of
  // towns ready, instead of gathering a fresh list on every call. A town stays well inside
  // its own cell, so the cells around a point hold every town that can reach it.
  const nearCache = new Map<number, Entrance[]>();
  const townsNear = (x: number, z: number): Entrance[] => {
    const key = cellKey(cityCellOf(Math.floor(x / W.chunkSize)), cityCellOf(Math.floor(z / W.chunkSize)));
    let near = nearCache.get(key);
    if (!near) nearCache.set(key, (near = entrancesNear(x, z, 1)));
    return near;
  };
  const townAt = (x: number, z: number, margin = 0): Entrance | null => {
    for (const e of townsNear(x, z))
      if (x > e.ox - margin && z > e.oz - margin && x < e.ox + e.size + margin && z < e.oz + e.size + margin)
        return e;
    return null;
  };
  const skirt = S.townSkirt;
  /** The river channel cut into land of height h. Local widenings form pools, with a deep
   * channel and gently sloping shores. */
  const river = (h: number, x: number, z: number): number => {
    if (terrainVersion >= 2) return drainage.riverGround(h, x, z, riverAt, regional(x, z));
    const bank = riverDistance(x, z);
    const width = riverHalf(z);
    const channel = lerp(WATER_LEVEL - 2.8, WATER_LEVEL, smoothstep(0, width, bank));
    return lerp(Math.min(h, channel), h, smoothstep(width * 0.8, width + 17, bank));
  };
  const legacyLakeDistance = (x: number, z: number) => {
    const lane = Math.round((x - spawn - 90) / 720), reach = Math.round((z - spawn + 166) / 960);
    const variation = bends(lane + 0.71, reach + 0.32);
    const lakeX = spawn + 90 + lane * 720 + 13 * variation;
    const lakeZ = spawn - 166 + reach * 960 + 11 * variation;
    return Math.hypot((x - lakeX) / (152 + 14 * variation), (z - lakeZ) / (107 + 10 * variation));
  };
  const ground = (x: number, z: number): number => {
    let h = rawHeightAt(x, z);
    if (h < WATER_LEVEL - 0.45) {
      // A small isolated hollow holds ankle-to-knee-deep water. Broad natural basins retain their depth.
      const rim = Math.max(
        rawHeightAt(x - 10, z),
        rawHeightAt(x + 10, z),
        rawHeightAt(x, z - 10),
        rawHeightAt(x, z + 10),
      );
      h = lerp(h, WATER_LEVEL - 0.45, smoothstep(WATER_LEVEL - 0.8, WATER_LEVEL + 0.1, rim));
    }
    const start = 1 - smoothstep(16, 43, Math.hypot(x - spawn, z - spawn));
    h = lerp(h, Math.max(h, WATER_LEVEL + 2), start);
    h = river(h, x, z);
    // Lakes open off river channels, with long shallow shelves and a broad, deep interior.
    const blend = regional(x, z);
    const beforeBasin = h;
    if (blend < 1) {
      const basin = legacyLakeDistance(x, z);
      if (basin < 1.45) {
        const shore = basin + 0.08 * bends(x / 48, z / 48);
        const bed = WATER_LEVEL - 4.8 * (1 - smoothstep(0.4, 1.12, shore));
        h = lerp(Math.min(h, bed), h, smoothstep(0.92, 1.35, shore));
      }
    }
    if (blend) h = lerp(h, drainage.basinGround(beforeBasin, x, z), blend);
    const puddle = Math.hypot((x - (spawn - 28)) / 8, (z - (spawn + 25)) / 6);
    if (puddle < 1.8) h = lerp(Math.min(h, WATER_LEVEL - 0.38), h, smoothstep(0.5, 1.8, puddle));
    for (const e of townsNear(x, z)) {
      const dx = Math.max(e.ox - x, 0, x - e.ox - e.size);
      const dz = Math.max(e.oz - z, 0, z - e.oz - e.size);
      if (dx >= skirt || dz >= skirt) continue;
      // in a town the land keeps its shape but not its steepness, and stays above the water
      // except where a river runs through (the town bridges it); lakes stop at its edge
      const surveyed = regional(e.x, e.z) === 1;
      const base = surveyed ? drainage.basinGround(river(rawHeightAt(x, z), x, z), x, z) : rawHeightAt(x, z);
      const grade = Math.max(WATER_LEVEL + 0.6, e.y + S.townRelief * (base - e.y));
      // Valley shaping was already included in the survey; keep channels open through grading.
      const town = surveyed
        ? drainage.crossChannelGround(drainage.riverGround(grade, x, z, riverAt, 0), x, z)
        : river(grade, x, z);
      if (dx === 0 && dz === 0) return town;
      h = lerp(h, town, smoothstep(skirt, 0, Math.hypot(dx, dz)));
    }
    return h;
  };

  // Cache corner samples in bounded tiles. Streaming, raycasts, and placement all share them.
  const tiles = new Map<string, Float32Array>();
  const nSide = W.chunkSize / W.cellSize;
  const corner = (ix: number, iz: number): number => {
    const cx = Math.floor(ix / nSide),
      cz = Math.floor(iz / nSide);
    const key = `${cx},${cz}`;
    let tile = tiles.get(key);
    if (!tile) {
      if (tiles.size >= 128) tiles.delete(tiles.keys().next().value!);
      tiles.set(key, (tile = new Float32Array(nSide * nSide).fill(NaN)));
    }
    const i = (iz - cz * nSide) * nSide + ix - cx * nSide;
    if (Number.isNaN(tile[i])) tile[i] = ground(ix * W.cellSize, iz * W.cellSize);
    return tile[i]!;
  };
  const interpolate = (x: number, z: number, sample: (ix: number, iz: number) => number): number => {
    const gx = x / W.cellSize,
      gz = z / W.cellSize;
    const ix = Math.floor(gx),
      iz = Math.floor(gz);
    const u = gx - ix,
      v = gz - iz;
    if (u === 0 && v === 0) return sample(ix, iz);
    const east = sample(ix + 1, iz),
      south = sample(ix, iz + 1);
    if (u + v <= 1) return (1 - u - v) * sample(ix, iz) + u * east + v * south;
    return (u + v - 1) * sample(ix + 1, iz + 1) + (1 - v) * east + (1 - u) * south;
  };
  const terrainHeightAt = (x: number, z: number): number => interpolate(x, z, corner);
  const roadTiles = new Map<string, Float32Array>();
  const roadCorner = (ix: number, iz: number): number => {
    const cx = Math.floor(ix / nSide),
      cz = Math.floor(iz / nSide);
    const key = `${cx},${cz}`;
    let tile = roadTiles.get(key);
    if (!tile) {
      if (roadTiles.size >= 128) roadTiles.delete(roadTiles.keys().next().value!);
      roadTiles.set(key, (tile = new Float32Array(nSide * nSide).fill(NaN)));
    }
    const i = (iz - cz * nSide) * nSide + ix - cx * nSide;
    if (Number.isNaN(tile[i])) {
      const x = ix * W.cellSize,
        z = iz * W.cellSize,
        h = corner(ix, iz);
      const slope =
        Math.hypot(corner(ix + 1, iz) - corner(ix - 1, iz), corner(ix, iz + 1) - corner(ix, iz - 1)) /
        (2 * W.cellSize);
      const earthwork = smoothstep(0.1, 0.22, slope);
      // Keep towns, gates, water channels and fords exactly where they were surveyed.
      tile[i] =
        !earthwork || h <= WATER_LEVEL + 0.25 || townAt(x, z, 4)
          ? h
          : lerp(h, pathsOf(world).groundAt(x, z, h), earthwork);
    }
    return tile[i]!;
  };
  const heightAt = (x: number, z: number): number => interpolate(x, z, roadCorner);

  const sampleRiver = (lane: number, z: number) => {
    const old = { x: riverMiddle(lane, z), half: riverHalf(z) };
    const blend = regional(spawn + RIVER_X + lane * RIVER_LANE, z);
    if (!blend) return old;
    const next = drainage.riverAt(lane, z);
    return { x: lerp(old.x, next.x, blend), half: lerp(old.half, next.half, blend) };
  };
  // Terrain rows share the same river section across hundreds of x samples. Cache
  // exact coordinates (including fractional z), with a fixed memory ceiling.
  const riverSections = new Map<string, { x: number; half: number }>();
  const riverAt = (lane: number, z: number) => {
    const key = `${lane},${z}`;
    let river = riverSections.get(key);
    if (!river) {
      if (riverSections.size >= 8192) riverSections.delete(riverSections.keys().next().value!);
      riverSections.set(key, (river = sampleRiver(lane, z)));
    }
    return { ...river };
  };
  const world: Wilderness = {
    seed,
    terrainVersion,
    legacyTowns: [...legacyTowns],
    climate,
    biomeAt,
    heightAt,
    terrainHeightAt,
    rawHeightAt,
    entranceInCell,
    entrancesNear,
    townAt,
    riverAt,
    waterGuidesAt(x, z) {
      const blend = regional(x, z);
      const old = blend < 1 ? 1 - smoothstep(0.8, 1.25, legacyLakeDistance(x, z)) : 0;
      if (!blend) return { basin: old, branch: null };
      const { basin, branch } = drainage.waterGuidesAt(x, z);
      return { basin: lerp(old, basin, blend), branch };
    },
  };
  return world;
}
