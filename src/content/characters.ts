// The default player characters as data: names, fixed colours per part, and what a player may
// change (skin, hair, one accent colour). Shapes live in systems/figures/player-figure.ts. All
// characters share one hit box, so a look never changes how easy someone is to hit.
// design: docs/game-design.md section 8.3
import { type ColorKey, color } from './palette';

export const SKIN_TONES = ['skinLight', 'skinWarm', 'skinDeep'] as const satisfies readonly ColorKey[];
export const HAIR_COLORS = ['charcoal', 'brown', 'sand', 'cream'] as const satisfies readonly ColorKey[];

export type CharacterKey = 'courier' | 'mason' | 'apprentice' | 'ranger';

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
    colors: { coat: 'cream', trousers: 'charcoal', boots: 'brown', bag: 'brown', plane: 'cream' },
    defaults: { skin: 0, hair: 1, accent: 'red' },
  },
  {
    key: 'mason',
    name: '石匠',
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
    colors: { coat: 'teal', vest: 'brown', trousers: 'sand', boots: 'brown', band: 'brown', goggles: 'sky' },
    defaults: { skin: 0, hair: 2, accent: 'orange' },
  },
] as const satisfies readonly CharacterDef[];

export function characterDef(key: CharacterKey): CharacterDef {
  return CHARACTERS.find((c) => c.key === key)!;
}

/** A character with its default colours. */
export function defaultLook(key: CharacterKey): Look {
  const d = characterDef(key).defaults;
  return { character: key, skin: d.skin, hair: d.hair, accent: color(d.accent) };
}
