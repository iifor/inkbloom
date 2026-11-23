// Web Audio for the game. Most sounds are synthesised from noise and oscillators; some are
// short recordings (`load` / `sample`), which always have a synthesised fallback in the recipes.
// Three buses (sfx, music, ambience) feed a master gain, a soft top-end rolloff and a gentle
// compressor, and send some of themselves to a hall reverb (an impulse made of decaying noise,
// so still no assets): the mix is meant to be calm and soft. Sounds can be placed
// in the world: they fade with distance and pan by the listener's right vector.
// Ported in spirit from doodle-game's audio.js; the recipes live in systems/audio.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface NoiseOptions {
  dur?: number;
  gain?: number;
  type?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  attack?: number;
  delay?: number;
  pos?: Vec3 | null;
  bus?: 'sfx' | 'music' | 'ambience';
}

export interface ToneOptions {
  freq?: number;
  freqEnd?: number;
  dur?: number;
  gain?: number;
  type?: OscillatorType;
  attack?: number;
  delay?: number;
  /** Absolute start time (AudioContext clock); overrides delay. */
  at?: number;
  pos?: Vec3 | null;
  bus?: 'sfx' | 'music' | 'ambience';
}

export interface SampleOptions {
  gain?: number;
  /** Playback speed (and pitch), 1 = as recorded. */
  rate?: number;
  /** Random +/- spread on the rate, so repeats do not sound identical. */
  vary?: number;
  delay?: number;
  pos?: Vec3 | null;
  bus?: 'sfx' | 'music' | 'ambience';
}

/** A long recording streamed from a file (a looping ambience bed, or a music track). */
export interface Stream {
  /** Fade to `level` over `seconds`; spatial streams can also pan left (-1) or right (1). */
  set(level: number, seconds?: number, pan?: number): void;
  /** Fade out and stop for good. */
  stop(seconds?: number): void;
  /** Whether it is actually sounding: false while loading, after an error, or once ended. */
  readonly playing: boolean;
  /** True once it can never play: it failed to load, finished (not looping) or was stopped. */
  readonly over: boolean;
}

export interface Loop {
  /** 0..1, smoothed. */
  set(level: number, pan?: number): void;
  stop(): void;
}

/** How much of each bus goes into the hall reverb. */
const HALL_SEND: Record<string, number> = { sfx: 0.12, music: 0.35, ambience: 0.3 };

export class Synth {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<string, GainNode>();
  private noiseBuf: AudioBuffer | null = null;
  private readonly listener = { pos: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 } };
  private volumes = { master: 0.8, sfx: 1, music: 0.6 };
  /** Decoded recordings by name, each a few takes. */
  private readonly samples = new Map<string, AudioBuffer[]>();

  /** Must run from a user gesture (browsers block audio until then). Safe to call again. */
  init(): void {
    if (this.ctx) return;
    const AC = window.AudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    // a gentle mix: a soft, wide-kneed compressor, and the top end rolled off so nothing hisses
    // or clicks sharply
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 7000;
    soften.Q.value = 0.5;
    soften.connect(comp);
    this.master = ctx.createGain();
    this.master.connect(soften);
    // a soft hall everything sits in, more for music and ambience than for effects
    const hall = ctx.createConvolver();
    hall.buffer = this.hallImpulse(ctx, 2.6);
    const hallTone = ctx.createBiquadFilter();
    hallTone.type = 'lowpass';
    hallTone.frequency.value = 4000;
    const hallOut = ctx.createGain();
    hallOut.gain.value = 0.7;
    hall.connect(hallTone);
    hallTone.connect(hallOut);
    hallOut.connect(this.master);
    for (const name of ['sfx', 'music', 'ambience']) {
      const g = ctx.createGain();
      g.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = HALL_SEND[name]!;
      g.connect(send);
      send.connect(hall);
      this.buses.set(name, g);
    }
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  /** A reverb tail: stereo noise fading out over `seconds`, no recording needed. */
  private hallImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolumes(v: { master: number; sfx: number; music: number }): void {
    this.volumes = v;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    // effects and ambience sit a little back, so the whole game sounds calm
    this.buses.get('sfx')!.gain.setTargetAtTime(this.volumes.sfx * 0.75, t, 0.05);
    this.buses.get('ambience')!.gain.setTargetAtTime(this.volumes.sfx * 0.8, t, 0.05);
    this.buses.get('music')!.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.05);
  }

  setListener(pos: Vec3, right: Vec3): void {
    this.listener.pos = { x: pos.x, y: pos.y, z: pos.z };
    this.listener.right = { x: right.x, y: right.y, z: right.z };
  }

  /** Output node for a sound: distance falloff and stereo pan when it has a position. */
  private out(pos: Vec3 | null | undefined, bus: string): AudioNode {
    const ctx = this.ctx!;
    const dest = this.buses.get(bus)!;
    if (!pos) return dest;
    const l = this.listener;
    const dx = pos.x - l.pos.x;
    const dy = pos.y - l.pos.y;
    const dz = pos.z - l.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    const g = ctx.createGain();
    g.gain.value = 1 / (1 + dist * 0.08);
    const p = ctx.createStereoPanner();
    p.pan.value = dist > 0.5 ? Math.max(-1, Math.min(1, (dx * l.right.x + dz * l.right.z) / dist)) * 0.75 : 0;
    g.connect(p);
    p.connect(dest);
    return g;
  }

  /**
   * Stream a long recording from `url` through `bus` (an audio element, so a minutes-long file
   * is never decoded into memory). It starts silent: fade it in with `set`. A file that fails
   * to load never reports `playing`, so callers keep their synthesised version.
   */
  stream(
    url: string,
    o: { loop: boolean; gain: number; bus: 'music' | 'ambience'; spatial?: boolean },
  ): Stream {
    const ctx = this.ctx;
    const state = { playing: false, over: false };
    if (!ctx) return { set: () => {}, stop: () => {}, playing: false, over: true };
    const el = new Audio(url);
    el.loop = o.loop;
    el.preload = 'auto';
    const g = ctx.createGain();
    g.gain.value = 0;
    ctx.createMediaElementSource(el).connect(g);
    const pan = this.connectBed(g, o.bus, o.spatial);
    el.addEventListener('playing', () => (state.playing = !state.over));
    const end = (): void => {
      state.playing = false;
      state.over = true;
    };
    el.addEventListener('error', end);
    el.addEventListener('ended', end);
    el.play().catch(end);
    return {
      set: (level, seconds = 1, stereo = 0) => {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setTargetAtTime(Math.max(0, level) * o.gain, ctx.currentTime, Math.max(0.01, seconds / 3));
        pan?.pan.setTargetAtTime(stereo, ctx.currentTime, 0.12);
      },
      stop: (seconds = 1) => {
        g.gain.setTargetAtTime(0, ctx.currentTime, Math.max(0.01, seconds / 3));
        window.setTimeout(() => el.pause(), seconds * 1000 + 200);
        end();
      },
      get playing() {
        return state.playing;
      },
      get over() {
        return state.over;
      },
    };
  }

  /** Fetch and decode the takes of a recorded sound. Takes that fail are skipped quietly: the
   * caller's synthesised fallback plays instead. An offline decoder can prepare sounds
   * before the player unlocks live audio. */
  async load(name: string, urls: readonly string[], ctx: BaseAudioContext | null = this.ctx): Promise<void> {
    if (!ctx) return;
    const takes = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      }),
    );
    const ok = takes.filter((t): t is AudioBuffer => t !== null);
    if (ok.length) this.samples.set(name, ok);
  }

  /** Play one take of a loaded recording, at random. False when it is not loaded (yet), so the
   * caller plays its synthesised version instead. */
  sample(name: string, o: SampleOptions = {}): boolean {
    const ctx = this.ctx;
    const takes = this.samples.get(name);
    if (!ctx || !takes) return false;
    const src = ctx.createBufferSource();
    src.buffer = takes[Math.floor(Math.random() * takes.length)]!;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.vary ?? 0.06));
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 0.5;
    src.connect(g);
    g.connect(this.out(o.pos, o.bus ?? 'sfx'));
    src.start(ctx.currentTime + (o.delay ?? 0));
    return true;
  }

  noise(o: NoiseOptions): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const dur = o.dur ?? 0.1;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur);
    f.Q.value = o.q ?? 1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(o.gain ?? 0.4, t0 + (o.attack ?? 0.003));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(env);
    env.connect(this.out(o.pos, o.bus ?? 'sfx'));
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  tone(o: ToneOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dur = o.dur ?? 0.2;
    const t0 = o.at ?? ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq ?? 440, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(o.gain ?? 0.2, t0 + (o.attack ?? 0.006));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(this.out(o.pos, o.bus ?? 'sfx'));
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** A continuous filtered-noise bed (wind, brush scratch, ink rumble) with a level knob. */
  noiseLoop(o: {
    type: BiquadFilterType;
    freq: number;
    q?: number;
    gain: number;
    bus?: 'sfx' | 'ambience';
    spatial?: boolean;
  }): Loop {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return { set: () => {}, stop: () => {} };
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.value = o.freq;
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    const pan = this.connectBed(g, o.bus ?? 'ambience', o.spatial);
    src.start();
    return {
      set: (level, stereo = 0) => {
        g.gain.setTargetAtTime(Math.max(0, level) * o.gain, ctx.currentTime, 0.12);
        pan?.pan.setTargetAtTime(stereo, ctx.currentTime, 0.12);
      },
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        src.stop(ctx.currentTime + 0.3);
      },
    };
  }

  private connectBed(gain: GainNode, bus: string, spatial?: boolean): StereoPannerNode | undefined {
    const dest = this.buses.get(bus)!;
    if (!spatial) {
      gain.connect(dest);
      return;
    }
    const pan = this.ctx!.createStereoPanner();
    gain.connect(pan);
    pan.connect(dest);
    return pan;
  }

  async dispose(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) await ctx.close();
  }
}

export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
