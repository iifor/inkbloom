// Every colour the renderer can draw. Indices are stored in saves and geometry, so append
// new colours at the end and never reorder. `paintable` colours show up in the graffiti
// brush; the rest are natural or architectural colours used only as original colours.

export interface ColorDef {
  readonly key: string;
  readonly name: string;
  readonly rgb: readonly [number, number, number];
  readonly paintable: boolean;
  /** Drawn as solid wet ink instead of a watercolour wash (the ink tide). */
  readonly solid?: boolean;
}

export const PALETTE = [
  { key: 'blue', name: '宝蓝', rgb: [0.27, 0.43, 0.74], paintable: true },
  { key: 'red', name: '朱红', rgb: [0.85, 0.33, 0.27], paintable: true },
  { key: 'orange', name: '橙', rgb: [0.94, 0.6, 0.27], paintable: true },
  { key: 'yellow', name: '鹅黄', rgb: [0.96, 0.84, 0.43], paintable: true },
  { key: 'green', name: '翠绿', rgb: [0.36, 0.64, 0.37], paintable: true },
  { key: 'teal', name: '青', rgb: [0.2, 0.55, 0.54], paintable: true },
  { key: 'sky', name: '天蓝', rgb: [0.48, 0.73, 0.88], paintable: true },
  { key: 'purple', name: '紫罗兰', rgb: [0.56, 0.44, 0.71], paintable: true },
  { key: 'pink', name: '玫粉', rgb: [0.92, 0.6, 0.66], paintable: true },
  { key: 'brown', name: '栗棕', rgb: [0.58, 0.39, 0.25], paintable: true },
  { key: 'cream', name: '米白', rgb: [0.97, 0.93, 0.81], paintable: true },
  { key: 'charcoal', name: '炭灰', rgb: [0.34, 0.35, 0.39], paintable: true },
  // natural colours, not offered by the brush
  { key: 'grass', name: '草地', rgb: [0.5, 0.74, 0.34], paintable: false },
  { key: 'forest', name: '林地', rgb: [0.24, 0.48, 0.29], paintable: false },
  { key: 'rock', name: '岩石', rgb: [0.62, 0.58, 0.52], paintable: false },
  { key: 'water', name: '水面', rgb: [0.32, 0.62, 0.8], paintable: false },
  { key: 'sand', name: '沙土', rgb: [0.88, 0.8, 0.6], paintable: false },
  { key: 'stone', name: '石板路', rgb: [0.72, 0.7, 0.66], paintable: false },
  { key: 'bark', name: '树皮', rgb: [0.45, 0.32, 0.22], paintable: false },
  { key: 'snow', name: '雪', rgb: [0.96, 0.97, 1.0], paintable: false },
  // the ink tide's own black, darker than any paint
  { key: 'ink', name: '墨', rgb: [0.06, 0.06, 0.09], paintable: false, solid: true },
] as const satisfies readonly ColorDef[];

export type ColorKey = (typeof PALETTE)[number]['key'];

const INDEX = new Map<string, number>(PALETTE.map((c, i) => [c.key, i]));

/** Palette index of a colour key. Throws on typos so content errors surface at load. */
export function color(key: ColorKey): number {
  const i = INDEX.get(key);
  if (i === undefined) throw new Error(`Unknown colour: ${key}`);
  return i;
}

export const PAINTABLE: readonly number[] = PALETTE.flatMap((c, i) => (c.paintable ? [i] : []));

/** The shader has a fixed-size palette array; keep the palette under this. */
export const MAX_COLORS = 32;
if (PALETTE.length > MAX_COLORS) throw new Error('Palette exceeds shader capacity');
