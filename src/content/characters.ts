// The default player characters as data: names, fixed colours per part, and what a player may
// change (skin, hair, one accent colour). Shapes live in systems/figures/player-rig.ts. All
// characters share one hit box, so a look never changes how easy someone is to hit.
// design: docs/game-design.md section 11.3
import { type ColorKey, color } from './palette';

export const SKIN_TONES = ['skinLight', 'skinWarm', 'skinDeep'] as const satisfies readonly ColorKey[];
export const SKIN_NAMES = ['浅', '暖', '深'] as const;
export const HAIR_COLORS = ['charcoal', 'brown', 'sand', 'cream'] as const satisfies readonly ColorKey[];
export const HAIR_NAMES = ['炭灰', '栗棕', '沙土', '米白'] as const;

export type CharacterKey =
  | 'courier'
  | 'mason'
  | 'apprentice'
  | 'ranger'
  | 'boatman'
  | 'gardener'
  | 'beach'
  | 'casual'
  | 'casual2'
  | 'farmer'
  | 'king'
  | 'punk'
  | 'spacesuit'
  | 'suit'
  | 'swat'
  | 'worker';

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
  /** Imported outfit file. KayKit roles use the kaykit: prefix. */
  readonly model?: string;
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
    model: 'adventurer',
    blurb: '短外套、长靴和旅行背包，带着颜色上路',
    colors: { coat: 'limewash', trousers: 'charcoal', boots: 'brown', bag: 'brown', plane: 'cream' },
    defaults: { skin: 0, hair: 1, accent: 'teal' },
  },
  {
    key: 'mason',
    name: '石匠',
    model: 'kaykit:barbarian',
    blurb: 'KayKit 村民 · 厚实护腕、皮革装束，常年在石料间忙碌',
    colors: {
      coat: 'limewash',
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
    model: 'kaykit:mage',
    blurb: 'KayKit 村民 · 尖帽与长袍，跟着师傅学习绘色',
    colors: {
      coat: 'limewash',
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
    model: 'kaykit:rogue-hooded',
    blurb: 'KayKit 村民 · 兜帽与短披风，熟悉林间的小路',
    colors: { coat: 'teal', vest: 'brown', trousers: 'sand', boots: 'brown', band: 'brown', goggles: 'sky' },
    defaults: { skin: 0, hair: 2, accent: 'orange' },
  },
  {
    key: 'boatman',
    name: '船夫',
    model: 'kaykit:rogue',
    blurb: 'KayKit 村民 · 轻装短衣，在河岸与渡口往返',
    colors: {
      coat: 'limewash',
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
    model: 'kaykit:rogue',
    blurb: 'KayKit 村民 · 绿色轻装，照料村里的花草',
    colors: {
      coat: 'limewash',
      trousers: 'brown',
      boots: 'brown',
      hat: 'sand',
      petal: 'pink',
      bud: 'yellow',
    },
    defaults: { skin: 0, hair: 1, accent: 'green' },
  },
  {
    key: 'beach',
    name: '海滨旅人',
    model: 'beach',
    blurb: '短裤与凉鞋，轻装走过海岸',
    colors: { coat: 'cream', trousers: 'red', boots: 'sand' },
    defaults: { skin: 1, hair: 1, accent: 'red' },
  },
  {
    key: 'casual',
    name: '街头青年',
    model: 'casual',
    blurb: '宽松上衣、牛仔裤和运动鞋',
    colors: { coat: 'purple', trousers: 'blue', boots: 'cream' },
    defaults: { skin: 0, hair: 0, accent: 'purple' },
  },
  {
    key: 'casual2',
    name: '休闲旅人',
    model: 'casual2',
    blurb: '衬衣、长裤，随性出门',
    colors: { coat: 'cream', trousers: 'blue', boots: 'sand' },
    defaults: { skin: 1, hair: 1, accent: 'red' },
  },
  {
    key: 'farmer',
    name: '农夫',
    model: 'farmer',
    blurb: '草帽、背带裤和工作靴',
    colors: { coat: 'limewash', trousers: 'blue', boots: 'bark' },
    defaults: { skin: 1, hair: 1, accent: 'blue' },
  },
  {
    key: 'king',
    name: '国王',
    model: 'king',
    blurb: '王冠、铠甲与披风',
    colors: { coat: 'blue', trousers: 'charcoal', boots: 'bark' },
    defaults: { skin: 0, hair: 3, accent: 'blue' },
  },
  {
    key: 'punk',
    name: '朋克',
    model: 'punk',
    blurb: '醒目发型、皮衣和长靴',
    colors: { coat: 'ink', trousers: 'blue', boots: 'ink' },
    defaults: { skin: 0, hair: 1, accent: 'red' },
  },
  {
    key: 'spacesuit',
    name: '宇航员',
    model: 'spacesuit',
    blurb: '密封头盔与厚实太空服',
    colors: { coat: 'cream', trousers: 'teal', boots: 'charcoal' },
    defaults: { skin: 0, hair: 0, accent: 'orange' },
  },
  {
    key: 'suit',
    name: '绅士',
    model: 'suit',
    blurb: '整齐西装、领带与皮鞋',
    colors: { coat: 'charcoal', trousers: 'charcoal', boots: 'ink' },
    defaults: { skin: 0, hair: 0, accent: 'blue' },
  },
  {
    key: 'swat',
    name: '特勤',
    model: 'swat',
    blurb: '头盔、护目镜与战术装备',
    colors: { coat: 'charcoal', trousers: 'charcoal', boots: 'ink' },
    defaults: { skin: 1, hair: 0, accent: 'charcoal' },
  },
  {
    key: 'worker',
    name: '工人',
    model: 'worker',
    blurb: '安全帽、反光背心和工具腰带',
    colors: { coat: 'sand', trousers: 'bark', boots: 'ink' },
    defaults: { skin: 1, hair: 1, accent: 'orange' },
  },
] as const satisfies readonly CharacterDef[];

export const CHARACTER_KEYS: readonly CharacterKey[] = CHARACTERS.map((c) => c.key);

export function characterDef(key: CharacterKey): CharacterDef {
  return CHARACTERS.find((c) => c.key === key)!;
}

export function characterModel(key: CharacterKey): string | undefined {
  return characterDef(key).model;
}

export function characterModelPath(key: CharacterKey): string | undefined {
  const model = characterModel(key);
  if (!model) return undefined;
  return model.startsWith('kaykit:')
    ? `models/kaykit/player-${model.slice(7)}.glb`
    : `models/quaternius/modular-${model}.glb`;
}

/** A character with its default colours. */
export function defaultLook(key: CharacterKey): Look {
  const d = characterDef(key).defaults;
  return { character: key, skin: d.skin, hair: d.hair, accent: color(d.accent) };
}
