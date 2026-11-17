// The sound of the land around the player, made from the same synth as everything else: birds
// by day (a dawn chorus, quiet in winter, silent in rain), crickets on warm evenings and nights,
// cicadas in the heat of a summer afternoon, an owl now and then in the woods at night, frogs and
// running water near rivers and lakes, leaves rustling in the wind. Life comes back with colour:
// drained grey land is nearly silent, and birds return as the colour does. Everything is placed
// a few metres to tens of metres around the listener, so it pans and fades like other sounds.
import { BIOMES } from '@/content/biomes';
import { type Loop, type Synth } from '@/engine/audio/synth';
import { dayHours } from '@/engine/render/daylight';
import type { GameContext } from '@/game/types';
import { seasonBlend } from '@/world/climate/calendar';
import { smoothstep } from '@/world/math/noise';

/** What the ambience reads about the land, refreshed twice a second. */
interface Here {
  wild: boolean;
  /** 0 bare and open .. 1 deep woods. */
  trees: number;
  /** 0 far from water .. 1 on the bank. */
  water: number;
}

export class Ambience {
  private readonly here: Here = { wild: true, trees: 0, water: 0 };
  private sampleT = 0;
  private cicada: Loop | null = null;
  private stream: Loop | null = null;
  private leaves: Loop | null = null;

  constructor(
    private readonly synth: Synth,
    private readonly ctx: GameContext,
  ) {}

  private loops(): void {
    if (this.cicada || !this.synth.ctx) return;
    const s = this.synth;
    this.cicada = s.noiseLoop({ type: 'bandpass', freq: 4800, q: 6, gain: 0.12 });
    this.stream = s.noiseLoop({ type: 'bandpass', freq: 900, q: 0.7, gain: 0.22 });
    this.leaves = s.noiseLoop({ type: 'highpass', freq: 3000, gain: 0.16 });
  }

  private sample(): void {
    const { scenes, player, wilderness } = this.ctx;
    const h = this.here;
    h.wild = scenes.active.ref.kind === 'wild';
    if (!h.wild) {
      h.trees = 0.2;
      h.water = 0;
      return;
    }
    const { x, z } = player.position;
    const biome = BIOMES[wilderness.biomeAt(x, z)]!;
    h.trees = biome.key === 'forest' ? 1 : biome.key === 'water' ? 0.1 : 0.35;
    // `water` is small along rivers and lakes
    h.water = smoothstep(0.12, 0.04, wilderness.climate(x, z).water);
  }

  /** A point `near`..`far` metres away in a random direction, `up` metres above the ear. */
  private around(near: number, far: number, up: number): { x: number; y: number; z: number } {
    const e = this.ctx.player.eye;
    const a = Math.random() * Math.PI * 2;
    const d = near + Math.random() * (far - near);
    return { x: e.x + Math.cos(a) * d, y: e.y + up * Math.random(), z: e.z + Math.sin(a) * d };
  }

  update(dt: number): void {
    if (!this.synth.ctx || !this.synth.running) return;
    this.loops();
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 0.5;
      this.sample();
    }
    const a = this.ctx.renderer.atmosphere;
    const w = a.weather;
    const h = this.here;
    // the day: sunrise and sunset move with the season
    const len = dayHours(a.declination);
    const rise = 12 - len / 2;
    const set = 12 + len / 2;
    const day = smoothstep(rise - 0.5, rise + 0.7, a.hour) * (1 - smoothstep(set - 0.5, set + 0.8, a.hour));
    const dawn = Math.max(0, 1 - Math.abs(a.hour - (rise + 0.6)) / 1.2);
    // how much of each season it is
    const sb = seasonBlend(a.year);
    const season = [0, 0, 0, 0];
    season[sb.from] = 1 - sb.t;
    season[sb.to] = sb.t;
    const [spring, summer, autumn, winter] = season as [number, number, number, number];
    const wet = Math.min(1, w.rain + w.snowfall * 0.8);
    const wind = Math.hypot(w.windX, w.windZ);
    // drained land is nearly silent; life comes back with colour
    const life = 0.15 + 0.85 * a.colour;
    const roll = (perSecond: number): boolean => Math.random() < perSecond * dt;

    const birds =
      0.5 *
      day *
      (1 + 1.5 * dawn) *
      (1.2 * spring + summer + 0.6 * autumn + 0.25 * winter) *
      (1 - 0.95 * wet) *
      (1 - smoothstep(6, 12, wind)) *
      life *
      (h.wild ? 0.6 + 0.9 * h.trees : 0.4);
    if (roll(birds)) this.bird(spring);

    const warmNights = summer + 0.5 * spring + 0.6 * autumn;
    const crickets = 1.6 * (1 - 0.85 * day) * warmNights * (1 - wet) * life * (h.wild ? 1 : 0.3);
    if (roll(crickets)) this.cricket();

    const afternoon = smoothstep(10, 13, a.hour) * (1 - smoothstep(17, 19, a.hour));
    this.cicada?.set(summer * afternoon * (1 - wet) * life * (h.wild ? 0.4 + 0.6 * h.trees : 0));

    const night = 1 - day;
    if (h.wild && roll((night * (0.3 + 0.7 * h.trees) * (1 - wet) * life) / 35)) this.owl();
    if (h.wild && roll(0.8 * night * h.water * (spring + summer) * (1 - 0.5 * wet) * life)) this.frog();

    // still water in a freeze makes no sound
    this.stream?.set(h.water * (1 - 0.8 * winter * smoothstep(0, -3, a.seaTemp)));
    // bare winter branches hardly rustle
    this.leaves?.set(h.wild ? h.trees * smoothstep(1.5, 9, wind) * (1 - 0.7 * winter) : 0);
  }

  /** One bird's phrase: a whistle, a trill, or (in spring) a two-note call. */
  private bird(spring: number): void {
    const s = this.synth;
    const pos = this.around(8, 35, 8);
    const kind = Math.random();
    let t = s.now + 0.02;
    if (spring > 0.5 && kind < 0.12) {
      // a cuckoo-like call: high, then a third lower
      s.tone({ freq: 720, dur: 0.28, gain: 0.07, at: t, attack: 0.03, pos, bus: 'ambience' });
      s.tone({ freq: 590, dur: 0.38, gain: 0.07, at: t + 0.33, attack: 0.03, pos, bus: 'ambience' });
    } else if (kind < 0.45) {
      // a quick trill
      const f = 3600 + Math.random() * 1400;
      for (let i = 0, n = 6 + Math.floor(Math.random() * 6); i < n; i++, t += 0.045)
        s.tone({ freq: f, freqEnd: f * 0.85, dur: 0.03, gain: 0.035, at: t, pos, bus: 'ambience' });
    } else {
      // a short whistled phrase, each note sliding up or down
      const base = 2000 + Math.random() * 1600;
      for (let i = 0, n = 2 + Math.floor(Math.random() * 4); i < n; i++) {
        const f = base * (0.85 + Math.random() * 0.35);
        const dur = 0.07 + Math.random() * 0.08;
        s.tone({
          freq: f,
          freqEnd: f * (Math.random() < 0.5 ? 1.25 : 0.8),
          dur,
          gain: 0.05,
          at: t,
          pos,
          bus: 'ambience',
        });
        t += dur + 0.03 + Math.random() * 0.08;
      }
    }
  }

  /** A cricket's chirp: three tiny pulses. */
  private cricket(): void {
    const s = this.synth;
    const pos = this.around(4, 20, 0.3);
    const f = 4300 + Math.random() * 600;
    for (let i = 0; i < 3; i++)
      s.tone({ freq: f, dur: 0.018, gain: 0.03, at: s.now + 0.02 + i * 0.04, pos, bus: 'ambience' });
  }

  /** An owl in the woods: a short hoot, then a long one. */
  private owl(): void {
    const s = this.synth;
    const pos = this.around(25, 60, 10);
    const t = s.now + 0.02;
    s.tone({ freq: 400, freqEnd: 380, dur: 0.3, gain: 0.07, at: t, attack: 0.05, pos, bus: 'ambience' });
    s.tone({
      freq: 400,
      freqEnd: 360,
      dur: 0.75,
      gain: 0.07,
      at: t + 0.55,
      attack: 0.08,
      pos,
      bus: 'ambience',
    });
  }

  /** A frog croaking two or three times by the water. */
  private frog(): void {
    const s = this.synth;
    const pos = this.around(5, 25, 0);
    const f = 130 + Math.random() * 60;
    for (let i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++)
      s.tone({
        freq: f,
        freqEnd: f * 0.85,
        dur: 0.11,
        gain: 0.04,
        type: 'sawtooth',
        at: s.now + 0.02 + i * 0.2,
        pos,
        bus: 'ambience',
      });
  }

  dispose(): void {
    for (const l of [this.cicada, this.stream, this.leaves]) l?.stop();
  }
}
