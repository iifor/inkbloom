export type FishKind = 'minnow' | 'crucian' | 'carp' | 'trout' | 'koi';
export type FishHabitat = 'shallows' | 'river' | 'lake';
type RGB = readonly [number, number, number];

export interface FishSpecies {
  readonly key: FishKind;
  readonly name: string;
  readonly length: number;
  readonly height: number;
  readonly width: number;
  readonly tail: number;
  readonly dorsal: number;
  readonly pace: number;
  readonly depth: number;
  readonly belly: RGB;
  readonly flank: RGB;
  readonly back: RGB;
  readonly fin: RGB;
  readonly weights: Readonly<Record<FishHabitat, number>>;
}

/** Relative silhouettes and matte painted skins; no extra fish are spawned for variety. */
export const FISH_SPECIES: readonly FishSpecies[] = [
  {
    key: 'minnow',
    name: '银色小鱼',
    length: 0.52,
    height: 0.58,
    width: 0.62,
    tail: 0.8,
    dorsal: 0.65,
    pace: 1.35,
    depth: 0.34,
    belly: [228, 230, 207],
    flank: [174, 199, 196],
    back: [62, 113, 125],
    fin: [170, 191, 175],
    weights: { shallows: 55, river: 32, lake: 15 },
  },
  {
    key: 'crucian',
    name: '鲫鱼',
    length: 0.76,
    height: 1.35,
    width: 1.04,
    tail: 0.95,
    dorsal: 1.15,
    pace: 0.7,
    depth: 0.5,
    belly: [222, 215, 180],
    flank: [171, 172, 137],
    back: [88, 111, 84],
    fin: [153, 142, 101],
    weights: { shallows: 35, river: 15, lake: 30 },
  },
  {
    key: 'carp',
    name: '金褐鲤鱼',
    length: 1.15,
    height: 1.08,
    width: 1.2,
    tail: 1.12,
    dorsal: 0.9,
    pace: 0.6,
    depth: 0.62,
    belly: [227, 210, 157],
    flank: [195, 158, 88],
    back: [105, 112, 62],
    fin: [176, 123, 68],
    weights: { shallows: 8, river: 18, lake: 37 },
  },
  {
    key: 'trout',
    name: '斑点鳟鱼',
    length: 1,
    height: 0.83,
    width: 0.85,
    tail: 0.9,
    dorsal: 0.85,
    pace: 1.05,
    depth: 0.52,
    belly: [218, 214, 180],
    flank: [159, 183, 158],
    back: [61, 101, 99],
    fin: [199, 169, 129],
    weights: { shallows: 0, river: 34, lake: 10 },
  },
  {
    key: 'koi',
    name: '红白锦鲤',
    length: 1.1,
    height: 1.06,
    width: 1.13,
    tail: 1.35,
    dorsal: 1,
    pace: 0.65,
    depth: 0.43,
    belly: [239, 229, 204],
    flank: [228, 218, 194],
    back: [199, 192, 163],
    fin: [228, 207, 172],
    weights: { shallows: 2, river: 1, lake: 8 },
  },
];
