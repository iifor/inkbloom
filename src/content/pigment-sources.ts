// Wilderness pigment sources as data. Each chunk rolls once per kind (`perChunk` is the
// chance) and places it on a cell that matches `biomes` and `placement`. Harvesting gives
// `amount` of one of `colors` (picked per source) plus `ink`, and unlocks that colour.
import type { BiomeKey } from './biomes';
import { color } from './palette';

export type Placement = 'land' | 'shore' | 'high';

export interface PigmentSourceDef {
  readonly key: string;
  readonly name: string;
  readonly biomes: readonly BiomeKey[];
  readonly placement: Placement;
  readonly colors: readonly number[];
  readonly amount: number;
  readonly ink: number;
  /** Chance per chunk that this kind appears (0..1). */
  readonly perChunk: number;
  /** Natural colour of the plant/rock the pigment grows on. */
  readonly base: number;
}

export const PIGMENT_SOURCES = [
  {
    key: 'flowers',
    name: '花田',
    biomes: ['grassland'],
    placement: 'land',
    colors: [color('yellow'), color('orange'), color('pink'), color('red')],
    amount: 3,
    ink: 2,
    perChunk: 0.9,
    base: color('grass'),
  },
  {
    key: 'berries',
    name: '浆果丛',
    biomes: ['forest'],
    placement: 'land',
    colors: [color('purple'), color('red'), color('blue')],
    amount: 3,
    ink: 3,
    perChunk: 0.8,
    base: color('forest'),
  },
  {
    key: 'ore',
    name: '矿脉',
    biomes: ['mountain'],
    placement: 'high',
    colors: [color('teal'), color('brown'), color('sky'), color('charcoal')],
    amount: 4,
    ink: 4,
    perChunk: 0.8,
    base: color('rock'),
  },
  {
    key: 'reeds',
    name: '芦苇丛',
    biomes: ['grassland', 'forest', 'water'],
    placement: 'shore',
    colors: [color('green'), color('teal'), color('sky')],
    amount: 3,
    ink: 2,
    perChunk: 0.6,
    base: color('sand'),
  },
] as const satisfies readonly PigmentSourceDef[];
