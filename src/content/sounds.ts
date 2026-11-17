// Recorded sounds the game uses, by name, each a few interchangeable takes picked at random.
// All are public domain (CC0) and live in public/sounds/ (credits in public/sounds/CREDITS.md).
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

/** Long ambience beds, streamed and looped (OpenGameArt, CC0; cut into seamless loops). */
export const BEDS = {
  /** Woodland birdsong (TinyWorlds, "Forest Ambience"). */
  forest: 'sounds/ambience/forest.ogg',
  /** Birdsong in open parkland ("Park ambiences", birds). */
  birds: 'sounds/ambience/birds.ogg',
  /** A small river over a low step ("Park ambiences", river). */
  river: 'sounds/ambience/river.ogg',
  /** Steady rain (kindland, "Rain and thunders"; a stretch without thunder). */
  rain: 'sounds/ambience/rain.ogg',
} as const;

/** Recorded music (Komiku, CC0), played now and then between stretches of generated music. */
export const TRACKS: readonly string[] = [
  'sounds/music/komiku-champ-de-tournesol.ogg',
  'sounds/music/komiku-bleu.ogg',
];
