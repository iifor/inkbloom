// The sound of the land around the player, made from the same synth as everything else: birds
// by day (a dawn chorus, quiet in winter, silent in rain), crickets on warm evenings and nights,
// cicadas in the heat of a summer afternoon, an owl now and then in the woods at night, frogs and
// running water in channels, leaves rustling in the wind. Life comes back with colour:
// drained grey land is nearly silent, and birds return as the colour does. Habitat emitters
// stay at the same world coordinates as the listener moves.
// Under it all lie recorded beds (CC0 field recordings, see content/sounds.ts): birdsong in the
// woods and in open country, and running water; the synthesised calls then become occasional
// accents. Until a bed has loaded, or if it cannot, the synthesised version plays alone.
import { BEDS } from '@/content/sounds';
import { type Loop, type Stream, type Synth, type Vec3 } from '@/engine/audio/synth';
import { dayHours } from '@/engine/render/daylight';
import type { GameContext } from '@/game/types';
import { seasonBlend } from '@/world/climate/calendar';
import { smoothstep } from '@/world/math/noise';
import { bankWavePhase } from '@/world/wilderness/water-waves';
import { AmbienceSites, ambienceGain, type AmbienceSite } from './ambience-sites';

interface Mix {
  level: number;
  pan: number;
  weight: number;
  source: Vec3 | null;
}
const mix = (): Mix => ({ level: 0, pan: 0, weight: 0, source: null });

export class Ambience {
  private readonly survey: AmbienceSites;
  private sites: AmbienceSite[] = [];
  private sampleT = 0;
  private cicada: Loop | null = null;
  private stream: Loop | null = null;
  private leaves: Loop | null = null;
  private beds: { forest: Stream; birds: Stream; river: Stream } | null = null;

  constructor(
    private readonly synth: Synth,
    private readonly ctx: GameContext,
  ) {
    this.survey = new AmbienceSites(ctx.wilderness);
  }

  private loops(): void {
    if (this.cicada || !this.synth.ctx) return;
    const s = this.synth;
    this.cicada = s.noiseLoop({ type: 'bandpass', freq: 4200, q: 3, gain: 0.05, spatial: true });
    this.stream = s.noiseLoop({ type: 'lowpass', freq: 750, q: 0, gain: 0.10, spatial: true });
    this.leaves = s.noiseLoop({ type: 'highpass', freq: 2400, gain: 0.12, spatial: true });
    const bed = (url: string, gain: number): Stream =>
      s.stream(import.meta.env.BASE_URL + url, { loop: true, gain, bus: 'ambience', spatial: true });
    const river = s.stream(import.meta.env.BASE_URL + BEDS.river, {
      loop: true, gain: 0.27, bus: 'ambience', spatial: true, lowPass: 750,
    });
    this.beds = { forest: bed(BEDS.forest, 0.55), birds: bed(BEDS.birds, 0.45), river };
  }

  private sample(): void {
    const { player } = this.ctx;
    const { x, z } = player.position;
    this.sites = this.survey.near(x, z);
  }

  /** Mix emitters using the strongest level and a distance-weighted stereo image.
   * A single looping recording per habitat avoids several copies of the same chorus. */
  private add(m: Mix, pos: Vec3, near: number, far: number, height = 0, strength = 1): void {
    const { eye, yaw } = this.ctx.player;
    const x = pos.x - eye.x,
      z = pos.z - eye.z;
    const distance = Math.hypot(x, pos.y + height - eye.y, z);
    const level = strength * ambienceGain(distance, near, far);
    if (level <= 0) return;
    if (level > m.level) {
      m.level = level;
      m.source = pos;
    }
    const weight = level * level;
    m.weight += weight;
    m.pan += (weight * 0.82 * (x * Math.cos(yaw) - z * Math.sin(yaw))) / Math.max(1, distance);
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
    const wild = this.ctx.scenes.active.ref.kind === 'wild';
    const forest = mix(),
      meadow = mix(),
      shore = mix(),
      current = mix();
    for (const site of this.sites) {
      if (site.kind === 'forest') this.add(forest, site.pos, 12, 88, 4.8);
      if (site.kind === 'meadow') this.add(meadow, site.pos, 12, 76, 2.2);
      if (site.kind === 'water' && wild) this.add(shore, site.pos, 8, 62);
      if (site.kind === 'current' && wild)
        this.add(current, site.pos, 7, 17 + 22 * site.strength, 0, site.strength);
    }
    const pan = (m: Mix) => (m.weight ? m.pan / m.weight : 0);
    const land = forest.level >= meadow.level ? forest : meadow;
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

    // how much birdsong there is: by day, most at dawn, in spring; none in rain or a gale
    const song =
      day *
      (1 + 0.3 * dawn) *
      (1.2 * spring + summer + 0.6 * autumn + 0.2 * winter) *
      (1 - 0.95 * wet) *
      (1 - smoothstep(6, 12, wind)) *
      life;
    const beds = this.beds;
    // the recorded chorus: woodland birds under trees, open-country birds elsewhere
    beds?.forest.set(song * forest.level * (wild ? 1 : 0.22), 0.65, pan(forest));
    beds?.birds.set(song * meadow.level * (wild ? 0.8 : 0.35), 0.65, pan(meadow));
    const recorded = land === forest ? beds?.forest.playing : beds?.birds.playing;
    // single synthesised calls: the whole chorus without the beds, a few accents with them
    const nearbyLife = Math.min(1, land.level * 2.5);
    const birds = 0.8 * song * (1 + 1.2 * dawn) * nearbyLife * (wild ? 1 : 0.4) * (recorded ? 0.3 : 1);
    if (land.source && roll(birds))
      this.bird(spring, { ...land.source, y: land.source.y + (land === forest ? 4.8 : 2.2) });

    const warmNights = summer + 0.5 * spring + 0.6 * autumn;
    const crickets = 1.6 * (1 - 0.85 * day) * warmNights * (1 - wet) * life * nearbyLife * (wild ? 1 : 0.3);
    if (land.source && roll(crickets)) this.cricket({ ...land.source, y: land.source.y + 0.12 });

    const afternoon = smoothstep(10, 13, a.hour) * (1 - smoothstep(17, 19, a.hour));
    this.cicada?.set(summer * afternoon * (1 - wet) * life * (wild ? forest.level : 0), pan(forest));

    const night = 1 - day;
    if (wild && forest.source && roll((night * forest.level * (1 - wet) * life) / 20))
      this.owl({ ...forest.source, y: forest.source.y + 5.5 });
    if (shore.source && roll(1.1 * night * shore.level * (spring + summer) * (1 - 0.5 * wet) * life))
      this.frog({ ...shore.source });

    const source = shore.source ?? current.source;
    const phase = source ? bankWavePhase(source.x, source.z, performance.now() / 1000) : 0;
    const lap = smoothstep(0.35, 0.70, phase) * (1 - smoothstep(0.70, 1, phase));
    const wash = current.level * lap;
    const water = current.level * (0.88 + wash * 0.19) * (1 - 0.8 * winter * smoothstep(0, -3, a.seaTemp));
    const cutoff = 660 + 2450 * current.level + 550 * wash;
    beds?.river.set(water, 0.42, pan(current), cutoff);
    this.stream?.set(beds?.river.playing ? 0 : water, pan(current), cutoff);
    // bare winter branches hardly rustle
    this.leaves?.set(wild ? forest.level * smoothstep(1.5, 9, wind) * (1 - 0.7 * winter) : 0, pan(forest));
  }

  /** One bird's phrase: a whistle, a trill, or (in spring) a two-note call. */
  private bird(spring: number, pos: Vec3): void {
    const s = this.synth;
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
        s.tone({ freq: f, freqEnd: f * 0.85, dur: 0.03, gain: 0.025, at: t, pos, bus: 'ambience' });
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
  private cricket(pos: Vec3): void {
    const s = this.synth;
    const f = 4300 + Math.random() * 600;
    for (let i = 0; i < 3; i++)
      s.tone({ freq: f, dur: 0.018, gain: 0.02, at: s.now + 0.02 + i * 0.04, pos, bus: 'ambience' });
  }

  /** An owl in the woods: a short hoot, then a long one. */
  private owl(pos: Vec3): void {
    const s = this.synth;
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
  private frog(pos: Vec3): void {
    const s = this.synth;
    const f = 130 + Math.random() * 60;
    for (let i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++)
      s.tone({
        freq: f,
        freqEnd: f * 0.85,
        dur: 0.11,
        gain: 0.04,
        type: 'triangle',
        at: s.now + 0.02 + i * 0.2,
        pos,
        bus: 'ambience',
      });
  }

  dispose(): void {
    for (const l of [this.cicada, this.stream, this.leaves]) l?.stop();
    if (this.beds) for (const bed of Object.values(this.beds)) bed.stop(0.2);
  }
}
