// All the game's sound. Listens to game events and plays procedural recipes; the rest of the
// game never calls audio directly. To give something a sound: emit an event (game/events.ts)
// where it happens and add a recipe below.
import { type Loop, Synth, midi } from '@/engine/audio/synth';
import type { Point3 } from '@/game/events';
import type { GameContext, System } from '@/game/types';
import { Music } from './music';

/** Major pentatonic steps; colours map onto it so every bloom is in key. */
const PENTA = [0, 2, 4, 7, 9];
const note = (degree: number, base = 72): number =>
  midi(base + PENTA[((degree % 5) + 5) % 5]! + 12 * Math.floor(degree / 5));

export class AudioSystem implements System {
  readonly id = 'audio';
  readonly synth = new Synth();
  private readonly music: Music;
  private readonly release: (() => void)[] = [];
  private brush: Loop | null = null;
  private wind: Loop | null = null;
  private rumble: Loop | null = null;
  private stepT = 0;
  private stepSide = 0;

  constructor(private readonly ctx: GameContext) {
    this.music = new Music(this.synth, ctx);
    const on = ctx.events.on.bind(ctx.events);
    const s = this.synth;
    this.release.push(
      on('brush:stroke', ({ stroking }) => this.loops().brush?.set(stroking ? 1 : 0)),
      on('paint:bloom', ({ at, color }) => this.bloom(at, color)),
      on('paint:drained', ({ at }) => {
        s.tone({ freq: 220, freqEnd: 110, dur: 0.35, gain: 0.08, type: 'triangle', pos: at });
        s.noise({ dur: 0.25, gain: 0.08, freq: 500, freqEnd: 150, pos: at });
      }),
      on('weapon:fired', ({ key }) => this.fire(key)),
      on('weapon:skill', ({ key }) => this.skill(key)),
      on('weapon:reload', () => {
        s.noise({ dur: 0.04, gain: 0.2, type: 'highpass', freq: 3000 });
        s.noise({ dur: 0.05, gain: 0.25, type: 'highpass', freq: 2200, delay: 0.25 });
      }),
      on('blast', ({ at, radius }) => {
        s.noise({ dur: 0.7, gain: 0.9, freq: 900, freqEnd: 90, pos: at });
        s.tone({ freq: 90, freqEnd: 35 * (radius > 5 ? 0.8 : 1), dur: 0.6, gain: 0.5, pos: at });
      }),
      on('shot:hit', ({ killed }) =>
        s.tone({ freq: killed ? 1400 : 2200, dur: killed ? 0.12 : 0.05, gain: 0.08, type: 'square' }),
      ),
      on('shot:impact', ({ at }) =>
        s.noise({ dur: 0.05, gain: 0.12, type: 'bandpass', freq: 2600, q: 1.4, pos: at }),
      ),
      on('monster:hit', ({ at }) =>
        s.noise({ dur: 0.09, gain: 0.35, type: 'bandpass', freq: 650, q: 3, pos: at }),
      ),
      on('monster:died', ({ at }) => {
        s.noise({ dur: 0.35, gain: 0.6, freq: 1400, freqEnd: 180, pos: at });
        s.tone({ freq: 240, freqEnd: 60, dur: 0.3, gain: 0.2, type: 'triangle', pos: at });
      }),
      on('monster:spit', ({ at }) => {
        s.tone({ freq: 520, freqEnd: 180, dur: 0.14, gain: 0.2, type: 'triangle', pos: at });
        s.noise({ dur: 0.08, gain: 0.15, type: 'bandpass', freq: 900, pos: at });
      }),
      on('monster:bite', ({ at }) =>
        s.noise({ dur: 0.07, gain: 0.45, type: 'bandpass', freq: 1800, q: 2, pos: at }),
      ),
      on('player:hurt', () => {
        s.tone({ freq: 150, freqEnd: 60, dur: 0.22, gain: 0.3, type: 'triangle' });
        s.noise({ dur: 0.12, gain: 0.25, freq: 700 });
      }),
      on('player:died', () => {
        for (let i = 0; i < 4; i++)
          s.tone({ freq: note(6 - i, 60), dur: 0.5, gain: 0.12, type: 'triangle', delay: i * 0.18 });
      }),
      on('player:jump', ({ air }) =>
        s.noise({ dur: 0.12, gain: air ? 0.12 : 0.07, type: 'highpass', freq: 1200, freqEnd: 3000 }),
      ),
      on('player:land', ({ impact }) => {
        s.noise({ dur: 0.1 + impact * 0.15, gain: 0.15 + impact * 0.35, freq: 350, freqEnd: 120 });
      }),
      on('tide:warning', ({ at }) => {
        for (const d of [0, 0.9])
          for (const f of [110, 116.5])
            s.tone({ freq: f, dur: 0.8, gain: 0.18, type: 'sawtooth', delay: d, pos: at });
      }),
      on('tide:start', () => {
        this.loops().rumble?.set(1);
        this.music.setTide(true);
      }),
      on('tide:end', ({ held }) => {
        this.loops().rumble?.set(0);
        this.music.setTide(false);
        this.arpeggio(held ? [0, 2, 4, 7] : [4, 2, 1, -1], held ? 72 : 60, 0.12);
      }),
      on('patch:applied', ({ patch }) => {
        switch (patch.kind) {
          case 'collect':
            s.tone({ freq: 300, freqEnd: 760, dur: 0.12, gain: 0.12 });
            s.noise({ dur: 0.1, gain: 0.08, freq: 600 });
            break;
          case 'refine':
          case 'collectStock':
            this.arpeggio([0, 2, 4], 79, 0.07);
            break;
          case 'harvest':
            s.noise({ dur: 0.25, gain: 0.15, type: 'bandpass', freq: 3200 });
            this.arpeggio([2, 4], 79, 0.08);
            break;
          case 'discover':
            this.arpeggio([0, 2, 4, 5, 7], 79, 0.1, 0.12);
            break;
          case 'request':
            this.arpeggio([2, 4, 7], 72, 0.12, 0.14);
            break;
          case 'upgrade':
          case 'assign':
            this.arpeggio([0, 4], 79, 0.1);
            break;
          case 'mark':
            s.tone({ freq: 180, freqEnd: 90, dur: 0.4, gain: 0.2, type: 'triangle' });
            break;
        }
      }),
      on('city:completed', () => this.arpeggio([0, 2, 4, 5, 7, 9, 10], 67, 0.14, 0.13)),
      on('growth:level', () => this.arpeggio([0, 2, 4, 7, 9], 72, 0.12, 0.1)),
      on('weapon:unlocked', () => this.arpeggio([0, 4, 7], 60, 0.16, 0.12)),
      on('scene:entered', () =>
        s.noise({ dur: 0.6, gain: 0.15, type: 'bandpass', freq: 400, freqEnd: 2400 }),
      ),
    );
  }

  /** Start audio from a user gesture (browser rule). */
  start(): void {
    this.synth.init();
    void this.synth.resume();
    this.loops();
  }

  /** Loops are created once audio exists. */
  private loops(): { brush: Loop | null; wind: Loop | null; rumble: Loop | null } {
    if (this.synth.ctx && !this.brush) {
      this.brush = this.synth.noiseLoop({ type: 'bandpass', freq: 2300, q: 0.9, gain: 0.18, bus: 'sfx' });
      this.wind = this.synth.noiseLoop({ type: 'bandpass', freq: 700, q: 0.6, gain: 0.35 });
      this.rumble = this.synth.noiseLoop({ type: 'lowpass', freq: 160, gain: 0.5 });
    }
    return { brush: this.brush, wind: this.wind, rumble: this.rumble };
  }

  private bloom(at: Point3, color: number): void {
    const s = this.synth;
    s.tone({ freq: note(color % 10, 72), dur: 0.5, gain: 0.12, pos: at });
    s.tone({ freq: note((color % 10) + 2, 72), dur: 0.4, gain: 0.06, pos: at, delay: 0.05 });
    s.noise({ dur: 0.15, gain: 0.05, type: 'highpass', freq: 6000, pos: at });
  }

  private fire(key: string): void {
    const s = this.synth;
    switch (key) {
      case 'sniper':
        s.noise({ dur: 0.35, gain: 0.8, type: 'bandpass', freq: 1500, freqEnd: 180, q: 0.6 });
        s.tone({ freq: 120, freqEnd: 50, dur: 0.25, gain: 0.35 });
        break;
      case 'staff':
        s.tone({ freq: 900, freqEnd: 300, dur: 0.18, gain: 0.15, type: 'triangle' });
        s.noise({ dur: 0.12, gain: 0.08, type: 'highpass', freq: 5000 });
        break;
      case 'launcher':
        s.noise({ dur: 0.3, gain: 0.5, freq: 400, freqEnd: 100 });
        s.tone({ freq: 140, freqEnd: 60, dur: 0.2, gain: 0.3 });
        break;
      case 'katana':
        s.noise({ dur: 0.18, gain: 0.3, type: 'highpass', freq: 1500, freqEnd: 5000 });
        break;
      default:
        s.noise({ dur: 0.16, gain: 0.55, type: 'bandpass', freq: 1200, freqEnd: 260, q: 0.7 });
    }
  }

  private skill(key: string): void {
    const s = this.synth;
    if (key === 'sniper') s.tone({ freq: 300, freqEnd: 900, dur: 0.4, gain: 0.15, type: 'triangle' });
    else if (key === 'staff') this.arpeggio([0, 3, 7], 60, 0.1, 0.06);
    else s.noise({ dur: 0.3, gain: 0.35, type: 'bandpass', freq: 500, freqEnd: 2500 });
  }

  private arpeggio(degrees: number[], base: number, gain: number, step = 0.09): void {
    degrees.forEach((d, i) =>
      this.synth.tone({ freq: note(d, base), dur: 0.45, gain, type: 'triangle', delay: i * step }),
    );
  }

  update(dt: number): void {
    if (!this.synth.ctx) return;
    const { player } = this.ctx;
    const yaw = player.yaw;
    this.synth.setListener(player.eye, { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });
    this.loops().wind?.set(player.gliding ? 1 : 0);
    // footsteps
    if (player.grounded && player.speed > 1.5 && !player.flying) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = player.speed > 8 ? 0.3 : 0.44;
        this.stepSide ^= 1;
        const city = this.ctx.scenes.active.ref.kind === 'city';
        this.synth.noise({
          dur: 0.07,
          gain: 0.09,
          type: city ? 'bandpass' : 'lowpass',
          freq: city ? 900 + this.stepSide * 120 : 420 + this.stepSide * 60,
          q: city ? 2 : 1,
        });
      }
    } else this.stepT = 0;
    this.music.update(dt);
  }

  dispose(): void {
    for (const r of this.release) r();
    this.music.dispose();
    void this.synth.dispose();
  }
}
