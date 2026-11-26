import { describe, expect, it, vi } from 'vitest';
import { BEDS } from '@/content/sounds';
import type { GameContext } from '@/game/types';
import { AudioSystem } from '@/systems/audio/audio-system';

vi.mock('@/systems/audio/music', () => ({
  Music: class {
    update() {}
    setTide() {}
    dispose() {}
  },
}));
vi.mock('@/systems/audio/ambience', () => ({
  Ambience: class {
    update() {}
    dispose() {}
  },
}));
vi.mock('@/systems/audio/npc-voices', () => ({
  NpcVoices: class {
    update() {}
    dispose() {}
  },
}));

interface Voice {
  level: number;
  playing: boolean;
  set: (level: number) => void;
}
vi.mock('@/engine/audio/synth', () => ({
  midi: (n: number) => n,
  Synth: class {
    ctx: object | null = null;
    streams = new Map<string, Voice>();
    loops = new Map<number, Voice>();
    init() {
      this.ctx ??= {};
    }
    async resume() {}
    async load() {}
    setListener() {}
    tone() {}
    noise() {}
    sample() {
      return false;
    }
    stream(url: string) {
      const v = this.voice();
      this.streams.set(url, v);
      return v;
    }
    noiseLoop(o: { freq: number }) {
      const v = this.voice();
      this.loops.set(o.freq, v);
      return v;
    }
    voice(): Voice {
      const v = {
        level: 0,
        playing: false,
        set: (level: number) => {
          v.level = level;
        },
      };
      return v;
    }
    async dispose() {
      for (const v of this.streams.values()) v.set(0);
    }
  },
}));

function scene() {
  const handlers = new Map<string, (event: any) => void>();
  const player = { eye: { x: 0, y: 1.6, z: 0 }, yaw: 0, gliding: false, speed: 0, grounded: false };
  let roof = false;
  const ctx = {
    events: {
      on: (name: string, callback: (event: any) => void) => {
        handlers.set(name, callback);
        return () => {
          handlers.delete(name);
        };
      },
    },
    player,
    renderer: { atmosphere: { weather: { windX: 12, windZ: 0, rain: 0 } } },
    scenes: { active: { physics: { raycast: () => (roof ? {} : null) } } },
  } as unknown as GameContext;
  const audio = new AudioSystem(ctx);
  const fake = audio.synth as unknown as { streams: Map<string, Voice>; loops: Map<number, Voice> };
  const bed = (path: string) => [...fake.streams.entries()].find(([url]) => url.endsWith(path))![1];
  return {
    audio,
    player,
    fake,
    bed,
    cover: () => {
      roof = true;
    },
    emit: (name: string, data = {}) => handlers.get(name)!(data),
  };
}

describe('recorded weather ambience', () => {
  it('uses wind recording when ready, falls back on failure, and attenuates under shelter', () => {
    const h = scene();
    h.audio.start();
    h.audio.start();
    expect(h.fake.streams.size).toBe(4);
    h.audio.update(0.3);
    const noise = h.fake.loops.get(700)!;
    expect(noise.level).toBeCloseTo(0.8);
    h.bed(BEDS.wind).playing = true;
    h.audio.update(0.3);
    expect(noise.level).toBe(0);
    expect(h.bed(BEDS.wind).level).toBeCloseTo(0.8);
    h.cover();
    h.audio.update(0.3);
    expect(h.bed(BEDS.wind).level).toBeCloseTo(0.2);
    h.bed(BEDS.wind).playing = false;
    h.audio.update(0.3);
    expect(noise.level).toBeCloseTo(0.2);
    h.audio.dispose();
  });

  it('fades glide wind out on landing and keeps its fallback while only ordinary wind is ready', () => {
    const h = scene();
    h.audio.start();
    h.player.gliding = true;
    h.bed(BEDS.wind).playing = true;
    h.audio.update(0.3);
    expect(h.fake.loops.get(700)!.level).toBe(1);
    h.bed(BEDS.glideWind).playing = true;
    h.audio.update(0.3);
    expect(h.fake.loops.get(700)!.level).toBe(0);
    expect(h.bed(BEDS.glideWind).level).toBe(1);
    h.player.gliding = false;
    h.audio.update(0.3);
    expect(h.bed(BEDS.glideWind).level).toBe(0);
    expect(h.bed(BEDS.wind).level).toBeCloseTo(0.8);
    h.audio.dispose();
  });

  it('remembers a tide started before audio unlock and stops both versions at tide end', () => {
    const h = scene();
    h.emit('tide:start');
    h.audio.start();
    h.audio.update(0.3);
    expect(h.fake.loops.get(160)!.level).toBe(1);
    h.bed(BEDS.inkRumble).playing = true;
    h.audio.update(0.3);
    expect(h.fake.loops.get(160)!.level).toBe(0);
    expect(h.bed(BEDS.inkRumble).level).toBe(1);
    h.emit('tide:end', { held: true });
    expect(h.bed(BEDS.inkRumble).level).toBe(0);
    h.bed(BEDS.inkRumble).playing = false;
    h.audio.update(0.3);
    expect(h.fake.loops.get(160)!.level).toBe(0);
    h.audio.dispose();
  });
});
