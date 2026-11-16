// The four seasons, in order from the first day of the year, and how the land looks in each.
// Each look is held in the middle of its season and blends into the next over the days around
// the change (see `seasonBlend`). Colours with a `season` class in the palette are recoloured
// by the renderer: towards `rgb` by `amount`, keeping most of their own lightness, so dark
// woods stay darker than sunny meadows. See docs/seasons-weather.md.
type RGB = readonly [number, number, number];

export interface SeasonLook {
  readonly rgb: RGB;
  /** 0 keeps the palette colour, 1 takes `rgb` (at the palette colour's lightness). */
  readonly amount: number;
  /** Some places take this colour instead (autumn reds among the yellows, spring blossom). */
  readonly alt?: RGB;
  /** Share of places that take `alt`, 0..1. */
  readonly altShare?: number;
}

export interface SeasonDef {
  readonly key: 'spring' | 'summer' | 'autumn' | 'winter';
  readonly name: string;
  /** Ground, grass and blades (palette `season: 'meadow'`). */
  readonly meadow: SeasonLook;
  /** Broadleaf crowns (palette `season: 'leaf'`). Cedars have no class: they stay green. */
  readonly leaf: SeasonLook;
  /** Wildflowers, as a share of the most there ever are. */
  readonly flowers: number;
  /** Leans the weather wetter (+) or drier (−): added to the cloud field's humidity. */
  readonly wet: number;
  /** Prevailing wind, metres per second along +x (east) and +z (south). Clouds drift with it. */
  readonly wind: readonly [number, number];
  /** Petals or leaves blowing about in the wild (more in wind), and their three colours. */
  readonly litter: { readonly amount: number; readonly colors: readonly [RGB, RGB, RGB] };
}

export const SEASONS: readonly SeasonDef[] = [
  {
    key: 'spring',
    name: '春',
    meadow: { rgb: [0.62, 0.82, 0.34], amount: 0.35 },
    leaf: { rgb: [0.58, 0.8, 0.4], amount: 0.45, alt: [0.96, 0.78, 0.84], altShare: 0.18 },
    flowers: 1,
    // spring rain on a south-easterly
    wet: 0.1,
    wind: [-2.8, -2.8],
    // blossom petals
    litter: {
      amount: 0.5,
      colors: [
        [0.98, 0.8, 0.86],
        [0.96, 0.7, 0.78],
        [1, 0.94, 0.95],
      ],
    },
  },
  {
    key: 'summer',
    name: '夏',
    meadow: { rgb: [0.47, 0.74, 0.3], amount: 0 },
    leaf: { rgb: [0.36, 0.64, 0.37], amount: 0 },
    flowers: 0.6,
    // showers and, when it is hot, thunderstorms; a light southerly
    wet: 0.03,
    wind: [0, -3],
    litter: {
      amount: 0,
      colors: [
        [0.4, 0.6, 0.3],
        [0.4, 0.6, 0.3],
        [0.4, 0.6, 0.3],
      ],
    },
  },
  {
    key: 'autumn',
    name: '秋',
    meadow: { rgb: [0.8, 0.68, 0.34], amount: 0.55 },
    leaf: { rgb: [0.95, 0.72, 0.22], amount: 0.85, alt: [0.88, 0.36, 0.2], altShare: 0.45 },
    flowers: 0.2,
    // clear, dry autumn days on a north-westerly
    wet: -0.12,
    wind: [2.8, 2.8],
    // falling leaves
    litter: {
      amount: 1,
      colors: [
        [0.93, 0.62, 0.2],
        [0.95, 0.8, 0.3],
        [0.8, 0.33, 0.18],
      ],
    },
  },
  {
    key: 'winter',
    name: '冬',
    meadow: { rgb: [0.64, 0.56, 0.42], amount: 0.65 },
    leaf: { rgb: [0.5, 0.4, 0.33], amount: 0.85 },
    flowers: 0,
    // grey skies and snow on a cold northerly
    wet: 0.05,
    wind: [0, 5],
    litter: {
      amount: 0,
      colors: [
        [0.5, 0.4, 0.33],
        [0.5, 0.4, 0.33],
        [0.5, 0.4, 0.33],
      ],
    },
  },
];
