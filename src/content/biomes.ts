// Wilderness biomes as data. The classifier walks RULES top to bottom and takes the first
// match, so adding a biome is: add a BiomeDef, add a rule above the fallback.
import { color } from './palette';

export interface BiomeDef {
  readonly key: string;
  readonly name: string;
  /** Top surface colour. */
  readonly ground: number;
  /** Colour of terrace sides. */
  readonly cliff: number;
  /** Trees per terrain cell (0..1). */
  readonly treeDensity: number;
  readonly treeColor: number;
  /** Trees are skipped on cells steeper than this (metres of neighbour difference). */
  readonly treeMaxSlope: number;
}

export const BIOMES = [
  {
    key: 'water',
    name: '湖河',
    ground: color('sand'),
    cliff: color('sand'),
    treeDensity: 0,
    treeColor: color('forest'),
    treeMaxSlope: 0,
  },
  {
    key: 'mountain',
    name: '山地',
    ground: color('rock'),
    cliff: color('rock'),
    treeDensity: 0.012,
    treeColor: color('forest'),
    treeMaxSlope: 1,
  },
  {
    key: 'forest',
    name: '森林',
    ground: color('forest'),
    cliff: color('bark'),
    treeDensity: 0.12,
    treeColor: color('forest'),
    treeMaxSlope: 1.5,
  },
  {
    key: 'grassland',
    name: '草原',
    ground: color('grass'),
    cliff: color('sand'),
    treeDensity: 0.008,
    treeColor: color('green'),
    treeMaxSlope: 1.5,
  },
] as const satisfies readonly BiomeDef[];

export type BiomeKey = (typeof BIOMES)[number]['key'];
export const BIOME_INDEX = new Map<string, number>(BIOMES.map((b, i) => [b.key, i]));

/** Climate values sampled at a world position, each roughly in [-1, 1] (water in [0, 1]). */
export interface ClimateSample {
  readonly relief: number;
  readonly moisture: number;
  readonly water: number;
  /** 0 at spawn, 1 far from it. */
  readonly wildness: number;
}

export const RULES: readonly { biome: BiomeKey; when: (s: ClimateSample) => boolean }[] = [
  { biome: 'water', when: (s) => s.water < 0.045 && s.wildness > 0.3 },
  { biome: 'mountain', when: (s) => s.relief > 0.35 && s.wildness > 0.5 },
  { biome: 'forest', when: (s) => s.moisture > 0.15 },
  { biome: 'grassland', when: () => true },
];
