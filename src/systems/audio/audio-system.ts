// All the game's sound. Listens to game events and plays procedural recipes; the rest of the
// game never calls audio directly. To give something a sound: emit an event (game/events.ts)
// where it happens and add a recipe below.
import { type Loop, type SampleOptions, type Stream, Synth, midi } from '@/engine/audio/synth';
import type { Point3 } from '@/game/events';
import type { GameContext, System } from '@/game/types';
import { BEDS, SOUNDS, type SoundKey } from '@/content/sounds';
import { WEAPONS } from '@/content/weapons';
import { Ambience } from './ambience';
import { groundUnder, stepLayers, stepRecording } from './footsteps';
import { Music } from './music';
import { NpcVoices } from './npc-voices';

/** Major pentatonic steps; colours map onto it so every bloom is in key. */
const PENTA = [0, 2, 4, 7, 9];
const WEAPON_KEYS = new Set<string>(WEAPONS.map((w) => w.key));
const note = (degree: number, base = 72): number =>
  midi(base + PENTA[((degree % 5) + 5) % 5]! + 12 * Math.floor(degree / 5));

export class AudioSystem implements System {
  readonly id = 'audio';
  readonly synth = new Synth();
  private readonly music: Music;
  private readonly ambience: Ambience;
  private readonly release: (() => void)[] = [];
  private brush: Loop | null = null;
  private wind: Loop | null = null;
  private rumble: Loop | null = null;
  private rain: Loop | null = null;
  private rainBed: Stream | null = null;
  private stepT = 0;
  private coverT = 0;
  private weatherExposure = 1;
  private stepSide = 0;
  /** The weapon last fired or taken in hand (blade hits and switching sound by it). */
  private weapon = 'rifle';
  private dabAt = -1;
  private dripAt = -1;
  private rejectAt = -1;
  private voices?: NpcVoices;
  private growlAt = -10;

  constructor(private readonly ctx: GameContext) {
    this.music = new Music(this.synth, ctx);
    this.ambience = new Ambience(this.synth, ctx);
    const on = ctx.events.on.bind(ctx.events);
    const s = this.synth;
    this.release.push(
      on('brush:stroke', ({ stroking }) => this.loops().brush?.set(stroking ? 1 : 0)),
      on('paint:bloom', ({ at, color }) => this.bloom(at, color)),
      on('paint:drained', ({ at }) => {
        s.tone({ freq: 220, freqEnd: 110, dur: 0.35, gain: 0.08, type: 'triangle', pos: at });
        s.noise({ dur: 0.25, gain: 0.08, freq: 500, freqEnd: 150, pos: at });
      }),
      on('weapon:fired', ({ key }) => {
        this.weapon = key;
        this.fire(key);
      }),
      on('weapon:skill', ({ key }) => this.skill(key)),
      on('weapon:reload', () => {
        this.play('gunLatch', { gain: 0.35 }, () =>
          s.noise({ dur: 0.04, gain: 0.2, type: 'highpass', freq: 3000 }),
        );
        this.play('gunClick', { gain: 0.35, delay: 0.25 }, () =>
          s.noise({ dur: 0.05, gain: 0.25, type: 'highpass', freq: 2200, delay: 0.25 }),
        );
      }),
      // pulling the trigger mid-reload: a dry click
      on('weapon:dry', () =>
        this.play('gunClick', { gain: 0.25, rate: 1.4 }, () =>
          s.noise({ dur: 0.02, gain: 0.12, type: 'bandpass', freq: 3000, q: 4 }),
        ),
      ),
      on('equip', ({ key }) => this.equip(key)),
      on('blast', ({ at, radius }) => {
        s.noise({ dur: 0.7, gain: 0.7, freq: 700, freqEnd: 90, pos: at });
        s.tone({ freq: 90, freqEnd: 35 * (radius > 5 ? 0.8 : 1), dur: 0.6, gain: 0.5, pos: at });
      }),
      on('shot:hit', ({ killed, heavy }) => {
        s.tone({ freq: killed ? 1100 : 1600, dur: killed ? 0.14 : 0.06, gain: 0.07, type: 'triangle' });
        // a kill lands with a low thump; a heavy blow with a dull knock
        if (killed) s.tone({ freq: 110, freqEnd: 45, dur: 0.22, gain: 0.35, type: 'sine' });
        else if (heavy) s.noise({ dur: 0.06, gain: 0.3, type: 'lowpass', freq: 500 });
        // the blade biting in: a thick thwack, not a gun's tick
        if (heavy && this.weapon === 'katana') {
          this.play('bladeSlice', { gain: 0.45 }, () => {
            s.noise({ dur: 0.12, gain: 0.3, type: 'bandpass', freq: 900, freqEnd: 400, q: 1 });
            s.tone({ freq: 220, freqEnd: 140, dur: 0.1, gain: 0.12, type: 'triangle' });
          });
        }
      }),
      // a fleck off the brush: a soft wet pat (a brush throws many; a few are heard)
      on('paint:dab', ({ at }) => {
        if (performance.now() / 1000 - this.dabAt < 0.15) return;
        this.dabAt = performance.now() / 1000;
        s.noise({ dur: 0.05, gain: 0.04, type: 'bandpass', freq: 1400, q: 1, pos: at });
      }),
      // a drop of ink off the tide curtain: a small plip
      on('tide:drip', ({ at }) => {
        if (performance.now() / 1000 - this.dripAt < 0.1) return;
        this.dripAt = performance.now() / 1000;
        s.tone({ freq: 1200, freqEnd: 1800, dur: 0.06, gain: 0.04, delay: Math.random() * 0.05, pos: at });
      }),
      // something could not be done (not enough paint, nothing there): a soft "uh-uh"
      on('patch:rejected', () => {
        if (performance.now() / 1000 - this.rejectAt < 0.4) return;
        this.rejectAt = performance.now() / 1000;
        this.play('refused', { gain: 0.18, vary: 0 }, () => {
          s.tone({ freq: 330, dur: 0.14, gain: 0.06, type: 'triangle' });
          s.tone({ freq: 262, dur: 0.18, gain: 0.06, type: 'triangle', delay: 0.15 });
        });
      }),
      on('monster:interrupted', ({ at }) => {
        // a sharp crack: the attack breaks
        s.noise({ dur: 0.05, gain: 0.3, type: 'bandpass', freq: 1800, pos: at });
        s.tone({ freq: 880, freqEnd: 330, dur: 0.15, gain: 0.18, type: 'triangle', pos: at });
      }),
      on('shot:impact', ({ at }) =>
        this.play('hitWall', { gain: 0.3, pos: at }, () =>
          s.noise({ dur: 0.05, gain: 0.12, type: 'bandpass', freq: 2600, q: 1.4, pos: at }),
        ),
      ),
      on('monster:hit', ({ at }) =>
        this.play('hitSoft', { gain: 0.5, pos: at }, () =>
          s.noise({ dur: 0.09, gain: 0.35, type: 'bandpass', freq: 650, q: 3, pos: at }),
        ),
      ),
      on('monster:died', ({ at }) => {
        this.play('thudHeavy', { gain: 0.55, rate: 0.85, pos: at }, () =>
          s.noise({ dur: 0.35, gain: 0.45, freq: 1200, freqEnd: 180, pos: at }),
        );
        s.tone({ freq: 240, freqEnd: 60, dur: 0.3, gain: 0.2, type: 'triangle', pos: at });
      }),
      on('monster:spit', ({ at }) => {
        s.tone({ freq: 520, freqEnd: 180, dur: 0.14, gain: 0.2, type: 'triangle', pos: at });
        s.noise({ dur: 0.08, gain: 0.15, type: 'bandpass', freq: 900, pos: at });
      }),
      on('monster:bite', ({ at }) =>
        s.noise({ dur: 0.07, gain: 0.45, type: 'bandpass', freq: 1800, q: 2, pos: at }),
      ),
      on('monster:bite', ({ at }) => this.growl(at)),
      on('monster:spit', ({ at }) => this.growl(at)),
      on('player:hurt', ({ fall }) => {
        if (fall) return;
        s.tone({ freq: 150, freqEnd: 60, dur: 0.22, gain: 0.3, type: 'triangle' });
        this.play('punch', { gain: 0.4 }, () => s.noise({ dur: 0.12, gain: 0.25, freq: 700 }));
      }),
      on('player:died', () => {
        for (let i = 0; i < 4; i++)
          s.tone({ freq: note(6 - i, 60), dur: 0.5, gain: 0.12, type: 'triangle', delay: i * 0.18 });
      }),
      on('player:jump', ({ air }) =>
        s.noise({ dur: 0.12, gain: air ? 0.12 : 0.07, type: 'highpass', freq: 1200, freqEnd: 3000 }),
      ),
      on('player:land', ({ impact, water }) => {
        if (water) {
          s.noise({
            dur: 0.24 + impact * 0.22,
            gain: 0.15 + impact * 0.35,
            type: 'bandpass',
            freq: 2400,
            freqEnd: 380,
          });
          return;
        }
        this.play('thudHeavy', { gain: 0.15 + impact * 0.4, rate: 1.1 - impact * 0.2 }, () =>
          s.noise({ dur: 0.1 + impact * 0.15, gain: 0.15 + impact * 0.35, freq: 350, freqEnd: 120 }),
        );
      }),
      on('player:stroke', ({ power }) => {
        // the hands part the water, then the kick swirls it behind
        s.noise({ dur: 0.26, gain: 0.05 + 0.05 * power, type: 'bandpass', freq: 2400, freqEnd: 700, q: 1.2 });
        s.noise({
          dur: 0.34,
          gain: 0.04 + 0.04 * power,
          type: 'lowpass',
          freq: 600,
          freqEnd: 180,
          delay: 0.12,
        });
      }),
      on('tide:warning', ({ at }) => {
        for (const d of [0, 0.9])
          for (const f of [110, 116.5])
            s.tone({ freq: f, dur: 0.8, gain: 0.16, type: 'triangle', delay: d, pos: at });
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
      on('patch:applied', ({ patch, remote }) => {
        // another player's pickup is not this player's to hear
        if (remote) return;
        switch (patch.kind) {
          case 'collect':
            this.play('pickUp', { gain: 0.3 }, () => {
              s.tone({ freq: 300, freqEnd: 760, dur: 0.12, gain: 0.12 });
              s.noise({ dur: 0.1, gain: 0.08, freq: 600 });
            });
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
          case 'cleanse':
            // the ink drains away with a rush of water, and the well rings clear
            s.noise({ dur: 1.2, gain: 0.16, type: 'bandpass', freq: 500, freqEnd: 2600 });
            this.arpeggio([0, 4, 7, 9, 12], 72, 0.14, 0.12);
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
      on('weather:bolt', ({ distance }) => this.thunder(distance)),
    );
  }

  /** Thunder reaches the ear at the speed of sound: a sharp crack when close, a long low roll. */
  private thunder(distance: number): void {
    const s = this.synth;
    const delay = distance / 343;
    const near = 1 - Math.min(1, distance / 900);
    const crack = Math.max(0, 1 - distance / 350);
    if (crack > 0)
      s.noise({
        dur: 0.34,
        gain: 0.28 * crack,
        type: 'bandpass',
        freq: 2200,
        freqEnd: 520,
        q: 0.55,
        attack: 0.012,
        delay,
      });
    s.noise({
      dur: 4.8,
      gain: 0.2 + 0.48 * near,
      type: 'lowpass',
      freq: 190 + 450 * near,
      freqEnd: 110,
      q: 0,
      attack: 0.75 - 0.58 * near,
      delay,
    });
    // A broad, overlapping swell gives the roll a second rise without a pitched beat.
    s.noise({
      dur: 3.6,
      gain: 0.15 + 0.26 * near,
      type: 'lowpass',
      freq: 240 + 100 * near,
      freqEnd: 85,
      q: 0,
      attack: 0.9,
      delay: delay + 0.25 + Math.random() * 0.5,
    });
  }

  /** Decode the short effects without starting live audio. Music and ambience stream later. */
  async preloadEffects(): Promise<void> {
    const Decoder = window.OfflineAudioContext;
    if (!Decoder) return;
    await this.loadEffects(new Decoder(1, 1, 44100));
  }

  private effectsLoading: Promise<void> | null = null;

  private loadEffects(decoder: BaseAudioContext): Promise<void> {
    return (this.effectsLoading ??= Promise.all(
      Object.entries(SOUNDS).map(([key, urls]) =>
        this.synth.load(
          key,
          urls.map((url) => import.meta.env.BASE_URL + url),
          decoder,
        ),
      ),
    ).then(() => undefined));
  }

  /** Start audio from a user gesture (browser rule). */
  start(): void {
    const first = !this.synth.ctx;
    this.synth.init();
    this.voices ??= new NpcVoices(this.ctx, this.synth);
    void this.synth.resume();
    this.loops();
    if (first)
      this.rainBed = this.synth.stream(import.meta.env.BASE_URL + BEDS.rain, {
        loop: true,
        gain: 0.6,
        bus: 'ambience',
      });
    if (first && this.synth.ctx) void this.loadEffects(this.synth.ctx);
  }

  /** A recording if it is loaded, else its synthesised stand-in. */
  private play(key: SoundKey, o: SampleOptions, fallback: () => void): void {
    if (!this.synth.sample(key, o)) fallback();
  }

  /** Loops are created once audio exists. */
  private loops(): { brush: Loop | null; wind: Loop | null; rumble: Loop | null; rain: Loop | null } {
    if (this.synth.ctx && !this.brush) {
      this.brush = this.synth.noiseLoop({ type: 'bandpass', freq: 2300, q: 0.9, gain: 0.18, bus: 'sfx' });
      this.wind = this.synth.noiseLoop({ type: 'bandpass', freq: 700, q: 0.6, gain: 0.35, spatial: true });
      this.rumble = this.synth.noiseLoop({ type: 'lowpass', freq: 160, gain: 0.5 });
      // a soft hiss of rain on leaves and ground
      this.rain = this.synth.noiseLoop({ type: 'bandpass', freq: 2200, q: 0.4, gain: 0.24 });
    }
    return { brush: this.brush, wind: this.wind, rumble: this.rumble, rain: this.rain };
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
        s.noise({ dur: 0.35, gain: 0.6, type: 'bandpass', freq: 1200, freqEnd: 180, q: 0.6 });
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
        s.noise({ dur: 0.16, gain: 0.45, type: 'bandpass', freq: 1000, freqEnd: 260, q: 0.7 });
    }
  }

  private skill(key: string): void {
    const s = this.synth;
    switch (key) {
      case 'sniper':
        s.tone({ freq: 300, freqEnd: 900, dur: 0.4, gain: 0.15, type: 'triangle' });
        break;
      case 'staff':
        this.arpeggio([0, 3, 7], 60, 0.1, 0.06);
        break;
      case 'rifle':
        // a quick sidestep, and the shield shimmering up
        s.noise({ dur: 0.22, gain: 0.25, type: 'bandpass', freq: 600, freqEnd: 2400 });
        s.tone({ freq: 660, freqEnd: 990, dur: 0.3, gain: 0.05, type: 'triangle', delay: 0.05 });
        break;
      case 'katana':
        // a rushing dash, and the blade ringing
        s.noise({ dur: 0.3, gain: 0.3, type: 'highpass', freq: 800, freqEnd: 4000 });
        s.tone({ freq: 1320, dur: 0.5, gain: 0.05, type: 'triangle', delay: 0.1 });
        s.tone({ freq: 1980, dur: 0.4, gain: 0.03, delay: 0.1 });
        break;
      case 'launcher':
        // the big shell going: a deep swell under a heavy whump
        s.tone({ freq: 70, freqEnd: 140, dur: 0.35, gain: 0.2 });
        s.noise({ dur: 0.4, gain: 0.4, type: 'lowpass', freq: 300 });
        break;
      default:
        s.noise({ dur: 0.3, gain: 0.35, type: 'bandpass', freq: 500, freqEnd: 2500 });
    }
  }

  /** Taking something in hand: a gun's click-clack, a blade's ring, a staff's hum, a brush's rustle. */
  private equip(key: string): void {
    const s = this.synth;
    const weapon = key === 'weapons' ? this.weapon : key;
    if (key === 'weapons' || WEAPON_KEYS.has(key)) this.weapon = weapon;
    if (weapon === 'katana' && (key === 'weapons' || key === 'katana')) {
      this.play('bladeDraw', { gain: 0.35 }, () => {
        s.noise({ dur: 0.25, gain: 0.12, type: 'highpass', freq: 3000, freqEnd: 6000 });
        s.tone({ freq: 2400, dur: 0.35, gain: 0.025 });
      });
    } else if (weapon === 'staff' && (key === 'weapons' || key === 'staff')) {
      s.tone({ freq: 520, freqEnd: 780, dur: 0.25, gain: 0.05, type: 'triangle' });
    } else if (key === 'weapons' || WEAPON_KEYS.has(key)) {
      this.play('gunLatch', { gain: 0.3 }, () => {
        s.noise({ dur: 0.03, gain: 0.15, type: 'bandpass', freq: 2000, q: 3 });
        s.noise({ dur: 0.04, gain: 0.13, type: 'bandpass', freq: 1400, q: 3, delay: 0.08 });
      });
    } else {
      this.play('cloth', { gain: 0.3 }, () => s.noise({ dur: 0.1, gain: 0.08, type: 'lowpass', freq: 900 }));
    }
  }

  private arpeggio(degrees: number[], base: number, gain: number, step = 0.09): void {
    degrees.forEach((d, i) =>
      this.synth.tone({ freq: note(d, base), dur: 0.45, gain, type: 'triangle', delay: i * step }),
    );
  }

  update(dt: number): void {
    if (!this.synth.ctx) return;
    this.voices?.update(dt);
    const { player } = this.ctx;
    const yaw = player.yaw;
    this.synth.setListener(player.eye, { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });
    this.coverT -= dt;
    if (this.coverT <= 0) {
      this.coverT = 0.25;
      const roof = this.ctx.scenes.active.physics.raycast(player.eye, { x: 0, y: 1, z: 0 }, 12);
      this.weatherExposure = roof ? 0.25 : 1;
    }
    // wind from the weather (a breeze is barely there, a storm roars), louder still when gliding
    const w = this.ctx.renderer.atmosphere.weather;
    const speed = Math.hypot(w.windX, w.windZ);
    const blow = Math.max(0, speed - 3) / 9;
    const upwind = (0.35 * (w.windZ * Math.sin(yaw) - w.windX * Math.cos(yaw))) / Math.max(1, speed);
    const loops = this.loops();
    loops.wind?.set(Math.max(player.gliding ? 1 : 0, Math.min(0.8, blow)) * this.weatherExposure, upwind);
    // the recorded rain once it has loaded, the synthesised hiss until then (or if it cannot)
    const rain = w.rain * this.weatherExposure;
    this.rainBed?.set(rain, 1);
    loops.rain?.set(this.rainBed?.playing ? 0 : rain);
    // footsteps (a swimmer's strokes sound on 'player:stroke' instead)
    const water = player.waterMode === 'wading';
    const swimming = player.waterMode === 'swimming';
    if ((player.grounded || water) && !swimming && player.speed > 1.5 && !player.flying) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = water ? 0.63 : player.speed > 8 ? 0.3 : 0.44;
        this.stepSide ^= 1;
        // what is underfoot: grass, paving, sand, rock or shallows, with snow, rain or leaves
        const ground = groundUnder(this.ctx);
        const rec = stepRecording(ground, this.stepSide);
        if (rec && this.synth.sample(rec.key, { gain: rec.gain, rate: rec.rate, vary: 0.04 }))
          for (const layer of rec.extra) this.synth.noise(layer);
        else for (const layer of stepLayers(ground, this.stepSide)) this.synth.noise(layer);
      }
    } else this.stepT = 0;
    this.music.update(dt);
    this.ambience.update(dt);
  }

  dispose(): void {
    this.voices?.dispose();
    for (const r of this.release) r();
    this.music.dispose();
    this.ambience.dispose();
    void this.synth.dispose();
  }

  private growl(at: Point3): void {
    const s = this.synth;
    if (s.now - this.growlAt < 2.5 || this.ctx.player.position.distanceToSquared(at) > 18 ** 2) return;
    this.growlAt = s.now;
    const pitch = 90 + Math.random() * 45;
    s.tone({ freq: pitch, freqEnd: pitch * 0.6, dur: 0.48, gain: 0.13, type: 'sawtooth', pos: at });
    s.noise({ freq: 420, freqEnd: 180, dur: 0.5, gain: 0.15, type: 'bandpass', q: 2, pos: at, attack: 0.06 });
  }
}
