// Seeded architectural palettes and proportions. Template order is part of the saved world.
import { color } from './palette';

export interface Range {
  readonly min: number;
  readonly max: number;
}
export type HouseStyle = 'cottage' | 'shop' | 'barn';

export interface BuildingTemplate {
  readonly key: HouseStyle;
  readonly name: string;
  /** Historical storeys used to calculate paint cost and the saved surface fingerprint. */
  readonly paintFloors: Range;
  readonly eaves: number;
  /** Also seed resident recolour requests. Keep the original choices and order. */
  readonly walls: readonly number[];
  readonly roofs: readonly number[];
  readonly doors: readonly number[];
  readonly weight: number;
}

export const BUILDINGS = [
  {
    key: 'cottage',
    name: '农舍',
    paintFloors: { min: 1, max: 3 },
    eaves: 3.3,
    walls: [color('cream'), color('yellow'), color('pink'), color('sky')],
    roofs: [color('clayTile'), color('slateTile')],
    doors: [color('brown'), color('teal')],
    weight: 5,
  },
  {
    key: 'shop',
    name: '村中小铺',
    paintFloors: { min: 2, max: 4 },
    eaves: 3.6,
    walls: [color('orange'), color('cream'), color('green')],
    roofs: [color('slateTile'), color('clayTile')],
    doors: [color('blue'), color('red')],
    weight: 3,
  },
  {
    key: 'barn',
    name: '谷仓',
    paintFloors: { min: 4, max: 6 },
    eaves: 4.1,
    walls: [color('cream'), color('sky'), color('purple')],
    roofs: [color('clayTile'), color('slateTile')],
    doors: [color('brown'), color('charcoal')],
    weight: 2,
  },
] as const satisfies readonly BuildingTemplate[];

/** Wilderness ruins. Each guards a crayon: reaching it unlocks a colour. */
export interface RuinTemplate {
  readonly key: string;
  readonly name: string;
  readonly shape: 'circle' | 'bridge' | 'steles' | 'shrine';
  readonly stone: number;
}

export const RUINS = [
  { key: 'stone-circle', name: '石圈', shape: 'circle', stone: color('rock') },
  { key: 'broken-bridge', name: '旧桥人家', shape: 'bridge', stone: color('stone') },
  { key: 'stele-grove', name: '碑林', shape: 'steles', stone: color('charcoal') },
  // which ruin a cell holds is picked by hash modulo this list's length: appending moves
  // existing ruins to other templates (looks only; ids, places and crayons stay)
  { key: 'hill-shrine', name: '山神小祠', shape: 'shrine', stone: color('stone') },
] as const satisfies readonly RuinTemplate[];
