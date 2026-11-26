// M03–M07 follow the world; M01–M02 take occasional turns on calm, colourful days.
// The original generative music remains a fallback while recordings load or cannot play.
import { MUSIC_BEDS, TRACKS, type MusicMood } from '@/content/sounds';
import { type Stream, type Synth, midi } from '@/engine/audio/synth';
import { dayHours } from '@/engine/render/daylight';
import { sceneKey, type GameContext } from '@/game/types';
import { seasonBlend } from '@/world/climate/calendar';
import { smoothstep } from '@/world/math/noise';
import { influenceOf, saturationAt } from '@/world/wilderness/drain';
import { cleansedNear } from '@/world/wilderness/ink-wells';
import { MusicBed } from './music-bed';

/** Slow and unhurried: the music is a bed under the world, not a tune to follow. */
const BPM = 64;
const EIGHTH = 60 / BPM / 2;
/** Chord roots (semitones from the key) per bar, and whether each chord is minor. */
const BRIGHT = [
  [0, false],
  [9, true],
  [5, false],
  [7, false],
] as const;
const DARK = [
  [0, true],
  [8, false],
  [3, false],
  [10, false],
] as const;
const MAJOR_PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];
const KEY = 57; // A3

export class Music {
  private next = 0;
  private step = 0;
  private brightness = 0.5;
  private tide = false;
  private occupied = false;
  private scene = '';
  private walk = 2;
  private sampleT = 0;
  /** The hour, season and weather's hold on the music: speed, how many notes, how loud. */
  private tempo = 1;
  private density = 1;
  private level = 1;
  /** 0..1: winter melodies ring like bells. */
  private bells = 0;
  /** A fair, calm day in the wild with colour around: a recorded piece may play. */
  private calm = false;
  /** The recorded piece playing, if any, and when the next may start (audio clock). */
  private track: Stream | null = null;
  private nextTrackAt = -1;
  private trackIndex = 0;
  /** How much of the generated music is heard, 0..1: it steps aside for a recorded piece. */
  private share = 1;
  private readonly bed: MusicBed;
  private bedMood: MusicMood = 'colour';
  private isNight = false;
  private isWinter = false;
  private isBright = true;
  private trackStarted = 0;

  constructor(
    private readonly synth: Synth,
    private readonly ctx: GameContext,
  ) {
    this.bed = new MusicBed(synth);
  }

  setTide(on: boolean): void {
    this.tide = on;
    this.sampleT = 0;
  }

  /** An occupied village stays tense even between ink tides. */
  private get tense(): boolean {
    return this.tide || this.occupied;
  }

  /** How much colour is around the player, 0..1. */
  private sample(): number {
    const { player, scenes, cities, wilderness } = this.ctx;
    const ref = scenes.active.ref;
    if (ref.kind === 'city') return cities.progress(ref.id);
    const p = player.position;
    const near = wilderness.entrancesNear(p.x, p.z, 1).map((e) => influenceOf(e, cities.progress(e.cityId)));
    return saturationAt(p.x, p.z, near, cleansedNear(wilderness, p.x, p.z, this.ctx.state.cleansed));
  }

  update(dt: number): void {
    const s = this.synth;
    if (!s.ctx || !s.running) return;
    const scene = sceneKey(this.ctx.scenes.active.ref);
    if (scene !== this.scene) {
      this.scene = scene;
      this.sampleT = 0;
    }
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 1;
      // ease towards the target so walking into grey land changes the mood gradually
      this.brightness += (this.sample() - this.brightness) * 0.35;
      this.mood();
      this.takeTurns(s.now);
    }
    const featured = this.track?.playing ?? false;
    const recorded = this.bed.update(MUSIC_BEDS[this.bedMood], featured ? 0 : this.level);
    if (featured) this.track!.set(this.level, 4);
    const target = featured || recorded ? 0 : 1;
    this.share += (target - this.share) * (1 - Math.exp(-dt / 1.5));
    const now = s.now;
    if (this.next < now - 0.5) this.next = now + 0.05;
    while (this.next < now + 0.5) {
      this.play(this.next, this.step);
      this.step++;
      this.next += this.tense ? EIGHTH * 0.75 : EIGHTH / this.tempo;
    }
  }

  /** Village occupation and ink tides take priority over the hour, season and colour. */
  private mood(): void {
    const ref = this.ctx.scenes.active.ref;
    const village = ref.kind === 'city' ? this.ctx.state.cities.get(ref.id) : undefined;
    // The altar remains occupied after the streets are cleared, until the village is restored.
    this.occupied =
      !!village && !village.peaceful && !village.completed;
    const a = this.ctx.renderer.atmosphere;
    const len = dayHours(a.declination);
    const day =
      smoothstep(11.5 - len / 2, 12.5 - len / 2, a.hour) *
      (1 - smoothstep(11.5 + len / 2, 12.8 + len / 2, a.hour));
    const night = 1 - day;
    const sb = seasonBlend(a.year);
    const winter = (sb.from === 3 ? 1 - sb.t : 0) + (sb.to === 3 ? sb.t : 0);
    const summer = (sb.from === 1 ? 1 - sb.t : 0) + (sb.to === 1 ? sb.t : 0);
    const wet = Math.min(1, a.weather.rain + a.weather.snowfall * 0.6);
    const ease = (now: number, to: number): number => now + (to - now) * 0.3;
    this.tempo = ease(this.tempo, 1 - 0.15 * night - 0.1 * winter);
    this.density = ease(this.density, (1 - 0.5 * night) * (1 - 0.6 * wet) * (1 + 0.15 * summer));
    this.level = ease(this.level, (1 - 0.35 * night) * (1 - 0.5 * wet));
    this.bells = ease(this.bells, winter);
    // Hysteresis avoids switching tracks repeatedly around dusk, season and colour boundaries.
    if (night > 0.65) this.isNight = true;
    else if (night < 0.35) this.isNight = false;
    if (winter > 0.65) this.isWinter = true;
    else if (winter < 0.35) this.isWinter = false;
    if (this.brightness > 0.55) this.isBright = true;
    else if (this.brightness < 0.45) this.isBright = false;
    this.bedMood = this.tense
      ? 'tide'
      : this.isNight
        ? 'night'
        : this.isWinter
          ? 'winter'
          : this.isBright
            ? 'colour'
            : 'grey';
    this.calm =
      this.bedMood === 'colour' &&
      day > 0.5 &&
      wet < 0.3 &&
      this.brightness > 0.55 &&
      this.ctx.scenes.active.ref.kind === 'wild';
  }

  /** Once a second: start, end or interrupt a recorded piece, and fade the generated music round it. */
  private takeTurns(now: number): void {
    // The first piece follows a minute of the scene's background music.
    if (this.nextTrackAt < 0) this.nextTrackAt = now + 60;
    const t = this.track;
    if (t && (this.tense || !this.calm)) {
      t.stop(4);
      this.track = null;
      this.nextTrackAt = now + 90;
    } else if (t?.over || (t && !t.playing && now - this.trackStarted > 15)) {
      t.stop(0);
      this.track = null;
      this.nextTrackAt = now + 150 + Math.random() * 150;
    } else if (!t && !this.tense && this.calm && now >= this.nextTrackAt && TRACKS.length) {
      const url = TRACKS[this.trackIndex++ % TRACKS.length]!;
      this.trackStarted = now;
      this.track = this.synth.stream(import.meta.env.BASE_URL + url, {
        loop: false,
        gain: 0.55,
        bus: 'music',
      });
      this.track.set(this.level, 6);
    }
  }

  /** How loud the generated music is now: the hour and weather's level, less any recorded piece. */
  private get voice(): number {
    return this.level * this.share;
  }

  private play(t: number, step: number): void {
    const s = this.synth;
    if (this.share < 0.02) return;
    const bright = !this.tense && this.brightness > 0.5;
    const prog = bright ? BRIGHT : DARK;
    const scale = bright ? MAJOR_PENTA : MINOR_PENTA;
    const bar = Math.floor(step / 8) % prog.length;
    const e = step % 8;
    const [root, minor] = prog[bar]!;
    const chordRoot = KEY + root;
    const third = minor ? 3 : 4;
    const b = this.brightness;

    if (e === 0) {
      // pad: the chord, swelling in slowly and overlapping the next one
      for (const iv of [0, third, 7])
        s.tone({
          freq: midi(chordRoot + iv),
          dur: EIGHTH * 10,
          gain: (0.03 + 0.02 * b) * this.voice,
          type: 'sine',
          at: t,
          attack: 0.9 / this.tempo,
          bus: 'music',
        });
      s.tone({
        freq: midi(chordRoot - 12),
        dur: EIGHTH * 7,
        gain: 0.05 * this.voice,
        type: 'sine',
        at: t,
        attack: 0.25,
        bus: 'music',
      });
    }
    // melody: a gentle random walk on the scale, mostly by step; busier when the land has colour
    const density = this.tense ? 0.3 + 0.35 * b : (0.1 + 0.32 * b) * this.density;
    if (Math.random() < density && e % (b > 0.3 ? 1 : 2) === 0) {
      this.walk = Math.max(
        0,
        Math.min(8, this.walk + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.15 ? 2 : 1)),
      );
      const deg = this.walk;
      // winter: an octave up, a pure tone left to ring like a bell
      const bell = !this.tense && Math.random() < this.bells;
      const pitch = KEY + 12 + scale[deg % 5]! + 12 * Math.floor(deg / 5) + (bell ? 12 : 0);
      s.tone({
        freq: midi(pitch),
        // long, overlapping notes with a soft start, so the line flows instead of plinking
        dur: EIGHTH * (bell ? 4.5 : 2.6),
        gain: (0.04 + 0.025 * b) * this.voice * (bell ? 0.8 : 1),
        type: bell || !bright ? 'sine' : 'triangle',
        at: t,
        attack: 0.05,
        bus: 'music',
      });
    }
    if (this.tense) {
      // tension, but no harshness: a low heartbeat pulse and a soft tick
      if (e % 2 === 0)
        s.tone({
          freq: midi(KEY - 24),
          dur: EIGHTH * 0.9,
          gain: 0.09 * this.voice,
          type: 'triangle',
          at: t,
          attack: 0.02,
          bus: 'music',
        });
      s.tone({ freq: 1800, dur: 0.04, gain: 0.01 * this.voice, type: 'sine', at: t, bus: 'music' });
    }
  }

  dispose(): void {
    this.track?.stop(0);
    this.track = null;
    this.bed.dispose();
  }
}
