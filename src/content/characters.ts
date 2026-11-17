// The default player characters as data: names, fixed colours per part, and what a player may
// change (skin, hair, one accent colour). Shapes live in systems/figures/player-figure.ts. All
// characters share one hit box, so a look never changes how easy someone is to hit.
// design: docs/game-design.md section 11.3
import { type ColorKey, color } from './palette';

export const SKIN_TONES = ['skinLight', 'skinWarm', 'skinDeep'] as const satisfies readonly ColorKey[];
export const SKIN_NAMES = ['浅', '暖', '深'] as const;
export const HAIR_COLORS = ['charcoal', 'brown', 'sand', 'cream'] as const satisfies readonly ColorKey[];
export const HAIR_NAMES = ['炭灰', '栗棕', '沙土', '米白'] as const;

export type CharacterKey = 'courier' | 'mason' | 'apprentice' | 'ranger' | 'boatman' | 'gardener';

/** How one player looks: a character plus the colours they picked. */
export interface Look {
  readonly character: CharacterKey;
  /** Index into SKIN_TONES. */
  readonly skin: number;
  /** Index into HAIR_COLORS. */
  readonly hair: number;
  /** Palette index of the accent (a crayon the player has unlocked). */
  readonly accent: number;
}

export interface CharacterDef {
  readonly key: CharacterKey;
  readonly name: string;
  /** One line for the character select screen. */
  readonly blurb: string;
  /** The parts that keep their colour whatever the player picks. */
  readonly colors: Readonly<Record<string, ColorKey>>;
  readonly defaults: { readonly skin: number; readonly hair: number; readonly accent: ColorKey };
}

/** Parts every character has: eyes and cheeks. */
export const FACE_COLORS = { eye: 'charcoal', blush: 'pink' } as const satisfies Record<string, ColorKey>;

export const CHARACTERS = [
  {
    key: 'courier',
    name: '信使',
    blurb: '贝雷帽、长围巾、斜挎邮包，背后折着一架纸飞机',
    colors: { coat: 'cream', trousers: 'charcoal', boots: 'brown', bag: 'brown', plane: 'cream' },
    defaults: { skin: 0, hair: 1, accent: 'red' },
  },
  {
    key: 'mason',
    name: '石匠',
    blurb: '宽肩圆肚，背带工装，粗手套，带矿灯的安全帽',
    colors: {
      coat: 'cream',
      overalls: 'sky',
      trousers: 'sky',
      boots: 'brown',
      pouch: 'brown',
      lamp: 'cream',
    },
    defaults: { skin: 2, hair: 0, accent: 'yellow' },
  },
  {
    key: 'apprentice',
    name: '学徒',
    blurb: '尖兜帽、及膝长袍，背后一支大画笔',
    colors: {
      coat: 'cream',
      trousers: 'charcoal',
      boots: 'brown',
      belt: 'brown',
      brush: 'brown',
      ferrule: 'yellow',
    },
    defaults: { skin: 1, hair: 0, accent: 'purple' },
  },
  {
    key: 'ranger',
    name: '巡林人',
    blurb: '高马尾，额头推着护目镜，短披风和长靴',
    colors: { coat: 'teal', vest: 'brown', trousers: 'sand', boots: 'brown', band: 'brown', goggles: 'sky' },
    defaults: { skin: 0, hair: 2, accent: 'orange' },
  },
  {
    key: 'boatman',
    name: '船夫',
    blurb: '宽宽的斗笠、短雨衣，肩上一卷缆绳，腰间挂着布巾',
    colors: {
      coat: 'cream',
      trousers: 'charcoal',
      boots: 'brown',
      hat: 'sand',
      rope: 'brown',
      towel: 'cream',
    },
    defaults: { skin: 1, hair: 0, accent: 'blue' },
  },
  {
    key: 'gardener',
    name: '园丁',
    blurb: '插着花的大草帽、长围裙、一条垂在肩上的辫子',
    colors: { coat: 'cream', trousers: 'brown', boots: 'brown', hat: 'sand', petal: 'pink', bud: 'yellow' },
    defaults: { skin: 0, hair: 1, accent: 'green' },
  },
] as const satisfies readonly CharacterDef[];

export const CHARACTER_KEYS: readonly CharacterKey[] = CHARACTERS.map((c) => c.key);

export function characterDef(key: CharacterKey): CharacterDef {
  return CHARACTERS.find((c) => c.key === key)!;
}

/** A character with its default colours. */
export function defaultLook(key: CharacterKey): Look {
  const d = characterDef(key).defaults;
  return { character: key, skin: d.skin, hair: d.hair, accent: color(d.accent) };
}
