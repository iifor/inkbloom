// Procedural Web Audio: every sound is synthesised from noise and oscillators, no assets.
// Three buses (sfx, music, ambience) feed a master gain and a compressor. Sounds can be placed
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

export interface Loop {
  /** 0..1, smoothed. */
  set(level: number): void;
  stop(): void;
}

export class Synth {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<string, GainNode>();
  private noiseBuf: AudioBuffer | null = null;
  private readonly listener = { pos: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 } };
  private volumes = { master: 0.8, sfx: 1, music: 0.6 };

  /** Must run from a user gesture (browsers block audio until then). Safe to call again. */
  init(): void {
    if (this.ctx) return;
    const AC = window.AudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    for (const name of ['sfx', 'music', 'ambience']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses.set(name, g);
    }
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
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
    this.buses.get('sfx')!.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.buses.get('ambience')!.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
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
    g.connect(this.buses.get(o.bus ?? 'ambience')!);
    src.start();
    return {
      set: (level) => g.gain.setTargetAtTime(Math.max(0, level) * o.gain, ctx.currentTime, 0.08),
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        src.stop(ctx.currentTime + 0.3);
      },
    };
  }

  async dispose(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) await ctx.close();
  }
}

export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
