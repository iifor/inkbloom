// Generative music that follows the colour around the player. Grey land plays sparse, minor
// and low; colourful land plays brighter, major and busier. During an ink tide a low pulse
// and a faster beat take over. Notes are scheduled half a second ahead on the audio clock.
import { type Synth, midi } from '@/engine/audio/synth';
import type { GameContext } from '@/game/types';
import { saturationAt } from '@/world/wilderness/drain';

const BPM = 76;
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
  private walk = 2;
  private sampleT = 0;

  constructor(
    private readonly synth: Synth,
    private readonly ctx: GameContext,
  ) {}

  setTide(on: boolean): void {
    this.tide = on;
  }

  /** How much colour is around the player, 0..1. */
  private sample(): number {
    const { player, scenes, cities, wilderness } = this.ctx;
    const ref = scenes.active.ref;
    if (ref.kind === 'city') return cities.progress(ref.id);
    const p = player.position;
    const near = wilderness
      .entrancesNear(p.x, p.z, 1)
      .map((e) => ({ x: e.x, z: e.z, progress: cities.progress(e.cityId) }));
    return saturationAt(p.x, p.z, near);
  }

  update(dt: number): void {
    const s = this.synth;
    if (!s.ctx || !s.running) return;
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 1;
      // ease towards the target so walking into grey land changes the mood gradually
      this.brightness += (this.sample() - this.brightness) * 0.35;
    }
    const now = s.now;
    if (this.next < now - 0.5) this.next = now + 0.05;
    while (this.next < now + 0.5) {
      this.play(this.next, this.step);
      this.step++;
      this.next += this.tide ? EIGHTH * 0.75 : EIGHTH;
    }
  }

  private play(t: number, step: number): void {
    const s = this.synth;
    const bright = this.brightness > 0.5;
    const prog = bright ? BRIGHT : DARK;
    const scale = bright ? MAJOR_PENTA : MINOR_PENTA;
    const bar = Math.floor(step / 8) % prog.length;
    const e = step % 8;
    const [root, minor] = prog[bar]!;
    const chordRoot = KEY + root;
    const third = minor ? 3 : 4;
    const b = this.brightness;

    if (e === 0) {
      // pad: the chord, soft and long
      for (const iv of [0, third, 7])
        s.tone({
          freq: midi(chordRoot + iv),
          dur: EIGHTH * 8,
          gain: 0.025 + 0.02 * b,
          type: 'triangle',
          at: t,
          attack: 0.4,
          bus: 'music',
        });
      s.tone({
        freq: midi(chordRoot - 12),
        dur: EIGHTH * 6,
        gain: 0.06,
        type: 'sine',
        at: t,
        attack: 0.05,
        bus: 'music',
      });
    }
    // melody: a gentle random walk on the scale; busier when the land has colour
    const density = 0.15 + 0.45 * b + (this.tide ? 0.2 : 0);
    if (Math.random() < density && e % (b > 0.3 ? 1 : 2) === 0) {
      this.walk = Math.max(
        0,
        Math.min(9, this.walk + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.3 ? 2 : 1)),
      );
      const deg = this.walk;
      const pitch = KEY + 12 + scale[deg % 5]! + 12 * Math.floor(deg / 5);
      s.tone({
        freq: midi(pitch),
        dur: EIGHTH * 1.6,
        gain: 0.05 + 0.03 * b,
        type: bright ? 'triangle' : 'sine',
        at: t,
        bus: 'music',
      });
    }
    if (this.tide) {
      // tension: a low pulse on every beat and a ticking hat
      if (e % 2 === 0)
        s.tone({
          freq: midi(KEY - 24),
          dur: EIGHTH * 0.9,
          gain: 0.12,
          type: 'sawtooth',
          at: t,
          bus: 'music',
        });
      s.tone({ freq: 8000, dur: 0.03, gain: 0.015, type: 'square', at: t, bus: 'music' });
    }
  }

  dispose(): void {}
}
