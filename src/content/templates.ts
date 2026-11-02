// Parametric templates. A template is data: every parameter is an enum or a bounded range,
// so any combination the generator (or later the AI workshop) picks can be built. Builders
// read these; they never hard-code a style.
import { color } from './palette';

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface BuildingTemplate {
  readonly key: string;
  readonly name: string;
  readonly floors: Range;
  /** Original-colour choices; one is picked per building. */
  readonly walls: readonly number[];
  readonly roofs: readonly number[];
  readonly doors: readonly number[];
  /** Relative weight when the generator picks a template. */
  readonly weight: number;
}

export const BUILDINGS = [
  {
    key: 'house',
    name: '住宅',
    floors: { min: 1, max: 3 },
    walls: [color('cream'), color('yellow'), color('pink'), color('sky')],
    roofs: [color('red'), color('brown'), color('teal')],
    doors: [color('blue'), color('green'), color('brown')],
    weight: 5,
  },
  {
    key: 'shop',
    name: '商铺',
    floors: { min: 2, max: 4 },
    walls: [color('orange'), color('cream'), color('green')],
    roofs: [color('charcoal'), color('brown')],
    doors: [color('red'), color('yellow')],
    weight: 3,
  },
  {
    key: 'tower-block',
    name: '楼房',
    floors: { min: 4, max: 6 },
    walls: [color('cream'), color('sky'), color('purple')],
    roofs: [color('charcoal'), color('teal')],
    doors: [color('blue'), color('orange')],
    weight: 2,
  },
] as const satisfies readonly BuildingTemplate[];

export interface LandmarkTemplate {
  readonly key: string;
  readonly name: string;
  /** Stacked tiers from the ground up; each is narrower than the last. */
  readonly tiers: Range;
  readonly tierHeight: Range;
  readonly baseWidth: Range;
  readonly shrink: number;
  readonly spire: boolean;
  readonly body: readonly number[];
  readonly trim: readonly number[];
}

export const LANDMARKS = [
  {
    key: 'tower',
    name: '塔楼',
    tiers: { min: 4, max: 6 },
    tierHeight: { min: 5, max: 7 },
    baseWidth: { min: 12, max: 16 },
    shrink: 0.82,
    spire: true,
    body: [color('cream'), color('sky')],
    trim: [color('red'), color('blue')],
  },
  {
    key: 'clocktower',
    name: '钟楼',
    tiers: { min: 3, max: 4 },
    tierHeight: { min: 7, max: 9 },
    baseWidth: { min: 10, max: 12 },
    shrink: 0.9,
    spire: true,
    body: [color('brown'), color('cream')],
    trim: [color('yellow'), color('teal')],
  },
] as const satisfies readonly LandmarkTemplate[];
