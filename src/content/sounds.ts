// Recorded sounds the game uses, by name, each a few interchangeable takes picked at random.
// Files live in public/sounds/; each source's licence is recorded in CREDITS.md.
// Every recorded sound has a synthesised fallback in systems/audio: a missing file, a browser
// that cannot decode Ogg, or the first moments before loading finishes just play the synth.
// To add one: drop the file under public/sounds/, list it here, and play it by name.

const kenney = (names: readonly string[]): readonly string[] => names.map((n) => `sounds/kenney/${n}.ogg`);
const takes = (stem: string): readonly string[] => kenney([0, 1, 2, 3, 4].map((i) => `${stem}_00${i}`));

export const SOUNDS = {
  // footsteps (Kenney, Impact Sounds)
  stepGrass: takes('footstep_grass'),
  stepSnow: takes('footstep_snow'),
  stepStone: takes('footstep_concrete'),
  stepSoft: takes('footstep_carpet'),
  stepWood: takes('footstep_wood'),
  // hits (Kenney, Impact Sounds)
  hitWall: takes('impactGeneric_light'),
  hitSoft: takes('impactSoft_medium'),
  thudHeavy: takes('impactSoft_heavy'),
  punch: takes('impactPunch_medium'),
  // handling (Kenney, RPG Audio)
  bladeDraw: kenney(['drawKnife1', 'drawKnife2', 'drawKnife3']),
  bladeSlice: kenney(['knifeSlice', 'knifeSlice2']),
  gunClick: kenney(['metalClick']),
  gunLatch: kenney(['metalLatch']),
  cloth: kenney(['cloth1', 'cloth2', 'cloth3', 'cloth4']),
  // interface (Kenney, Interface Sounds)
  refused: kenney(['error_006']),
  pickUp: kenney(['drop_002']),
} as const satisfies Record<string, readonly string[]>;

export type SoundKey = keyof typeof SOUNDS;

/** Long ambience beds, streamed and looped; source-specific licences in CREDITS.md. */
export const BEDS = {
  /** Woodland birdsong (TinyWorlds, "Forest Ambience"). */
  forest: 'sounds/ambience/forest.ogg',
  /** Open-country birds and insects (SoundBits, SOME OF MANY, via AiSHA). */
  birds: 'sounds/ambience/aisha-meadow-birds.ogg',
  /** A small river over a low step ("Park ambiences", river). */
  river: 'sounds/ambience/river.ogg',
  /** Steady rain (kindland, "Rain and thunders"; a stretch without thunder). */
  rain: 'sounds/ambience/rain.ogg',
  /** SoundBits, SOME OF MANY (free), via AiSHA; edited in-game excerpts. */
  wind: 'sounds/ambience/aisha-wind.ogg',
  glideWind: 'sounds/ambience/aisha-glide-wind.ogg',
  inkRumble: 'sounds/ambience/aisha-ink-rumble.ogg',
} as const;

/** M01–M02: occasional complete pieces on calm, colourful days in the wild. */
export const TRACKS: readonly string[] = [
  'sounds/music/inkbloom-colour-fields.mp3',
  'sounds/music/inkbloom-blue-distance.mp3',
];

/** M03–M07: repeat with a short overlap rather than a hard file-end restart. */
export const MUSIC_BEDS = {
  grey: 'sounds/music/inkbloom-grey-world.mp3',
  colour: 'sounds/music/inkbloom-colour-world.mp3',
  night: 'sounds/music/inkbloom-night.mp3',
  winter: 'sounds/music/inkbloom-winter.mp3',
  tide: 'sounds/music/inkbloom-ink-tide.mp3',
} as const;

export type MusicMood = keyof typeof MUSIC_BEDS;
