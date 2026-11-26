import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_BEDS, TRACKS } from '@/content/sounds';
import type { Stream, Synth } from '@/engine/audio/synth';
import type { GameContext } from '@/game/types';
import { Music } from '@/systems/audio/music';
import { MusicBed } from '@/systems/audio/music-bed';

vi.mock('@/world/wilderness/drain', () => ({ influenceOf: vi.fn(), saturationAt: () => 1 }));
vi.mock('@/world/wilderness/ink-wells', () => ({ cleansedNear: () => [] }));
afterEach(() => vi.restoreAllMocks());

function audio() {
  let now = 0;
  const streams: (Stream & {
    url: string;
    level: number;
    playing: boolean;
    over: boolean;
    remaining: number;
  })[] = [];
  const tone = vi.fn();
  let ready = true;
  const synth = {
    ctx: {},
    running: true,
    get now() {
      return now;
    },
    tone,
    stream: vi.fn((url: string) => {
      const stream = {
        url,
        level: 0,
        playing: ready,
        over: false,
        remaining: 120,
        set: vi.fn((level: number) => {
          stream.level = level;
        }),
        stop: vi.fn(() => {
          stream.playing = false;
          stream.over = true;
        }),
      };
      streams.push(stream);
      return stream;
    }),
  } as unknown as Synth;
  return {
    synth,
    streams,
    tone,
    advance: (dt: number) => {
      now += dt;
    },
    loading: () => {
      ready = false;
    },
  };
}

function scene() {
  const sound = audio();
  let colour = 1;
  const village = { peaceful: false, completed: false, defeated: new Uint8Array([1, 1]) };
  const villages = new Map([['c0_0', village]]);
  const atmosphere = { hour: 12, declination: 0, year: 0.125, weather: { rain: 0, snowfall: 0 } };
  const active: { ref: { kind: 'city'; id: string } | { kind: 'wild' } } = {
    ref: { kind: 'city', id: 'c0_0' },
  };
  const ctx = {
    renderer: { atmosphere },
    scenes: { active },
    cities: { progress: () => colour },
    player: { position: { x: 0, z: 0 } },
    wilderness: { entrancesNear: () => [] },
    state: { cleansed: [], cities: villages },
  } as unknown as GameContext;
  const music = new Music(sound.synth, ctx);
  const tick = (seconds = 1.1) => {
    for (let n = 0; n < Math.round(seconds * 10); n++) {
      sound.advance(0.1);
      music.update(0.1);
    }
  };
  return {
    ...sound,
    atmosphere,
    active,
    village,
    villages,
    music,
    tick,
    colour: (value: number) => {
      colour = value;
    },
  };
}

describe('music recordings', () => {
  it.each([
    { hour: 12, year: 0.125 },
    { hour: 0, year: 0.125 },
    { hour: 12, year: 0.875 },
    { hour: 0, year: 0.875 },
  ])(
    'keeps an occupied village tense at $hour hours in season $year, even with colour restored',
    ({ hour, year }) => {
      const h = scene();
      Object.assign(h.atmosphere, { hour, year });
      h.village.defeated[1] = 0;
      h.tick(12);
      expect(h.streams).toHaveLength(1);
      expect(h.streams[0]!.url).toContain(MUSIC_BEDS.tide);
      h.music.setTide(true);
      h.tick(0.1);
      h.music.setTide(false);
      h.tick(0.1);
      expect(h.streams).toHaveLength(1);
      expect(h.streams[0]!.playing).toBe(true);
    },
  );

  it('interrupts a calm wilderness piece immediately on entering an occupied village and recovers on leaving', () => {
    const h = scene();
    h.village.defeated[0] = 0;
    h.active.ref = { kind: 'wild' };
    h.tick(62);
    const featured = h.streams.find((s) => s.url.endsWith(TRACKS[0]!))!;
    expect(featured.playing).toBe(true);
    h.active.ref = { kind: 'city', id: 'c0_0' };
    h.tick(0.1);
    expect(featured.stop).toHaveBeenCalledWith(4);
    expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.tide);
    const tense = h.streams.at(-1)!;
    h.active.ref = { kind: 'wild' };
    h.tick(0.1);
    expect(tense.stop).toHaveBeenCalledWith(4);
    expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.colour);
  });

  it('stays tense after street guards fall and returns to normal only after liberation', () => {
    const h = scene();
    h.colour(0);
    h.village.defeated[0] = 0;
    h.tick(8);
    expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.tide);
    h.village.defeated[0] = 1;
    h.tick(1.2);
    expect(h.village.completed).toBe(false);
    expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.tide);
    h.village.completed = true;
    h.tick(1.2);
    expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.grey);
  });

  it.each(['peaceful', 'completed'] as const)(
    'keeps a %s village calm and ignores monsters saved in another village',
    (status) => {
      const h = scene();
      h.village[status] = true;
      h.village.defeated.fill(0);
      h.villages.set('c1_1', { peaceful: false, completed: false, defeated: new Uint8Array([0]) });
      h.tick(5);
      expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.colour);
      h.active.ref = { kind: 'city', id: 'c1_1' };
      h.tick(0.1);
      expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.tide);
    },
  );

  it('uses tense procedural pulses in an occupied village if M07 cannot load', () => {
    const h = scene();
    h.loading();
    h.village.defeated[0] = 0;
    h.tick(20);
    expect(h.streams).toHaveLength(1);
    expect(h.streams[0]!.over).toBe(true);
    expect(h.tone.mock.calls.some(([note]) => note.freq === 1800 && note.bus === 'music')).toBe(true);
  });

  it('selects all five moods with tide, night and winter priority', () => {
    const h = scene();
    h.village.peaceful = true;
    const last = () => h.streams.at(-1)!.url;
    h.tick();
    expect(last()).toContain(MUSIC_BEDS.colour);
    h.colour(0);
    h.tick(5);
    expect(last()).toContain(MUSIC_BEDS.grey);
    h.atmosphere.year = 0.875;
    h.tick();
    expect(last()).toContain(MUSIC_BEDS.winter);
    h.atmosphere.hour = 0;
    h.tick();
    expect(last()).toContain(MUSIC_BEDS.night);
    h.music.setTide(true);
    h.tick(0.1);
    expect(last()).toContain(MUSIC_BEDS.tide);
    h.music.setTide(false);
    h.tick(0.1);
    expect(last()).toContain(MUSIC_BEDS.night);
    h.music.dispose();
    expect(h.streams.every((s) => s.over)).toBe(true);
  });

  it('keeps colour-boundary fluctuations from repeatedly restarting music', () => {
    const h = scene();
    h.village.peaceful = true;
    h.tick(10);
    for (let i = 0; i < 20; i++) {
      h.colour(i % 2 ? 0.49 : 0.51);
      h.tick();
    }
    expect(h.streams).toHaveLength(1);
    h.colour(0);
    h.tick(8);
    expect(h.streams).toHaveLength(2);
    expect(h.streams[1]!.url).toContain(MUSIC_BEDS.grey);
  });

  it('plays M01 then M02 on calm days, yields the bed and interrupts for a tide', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const h = scene();
    h.active.ref = { kind: 'wild' };
    h.tick(62);
    const first = h.streams.find((s) => s.url.endsWith(TRACKS[0]!))!;
    expect(first?.playing).toBe(true);
    expect(h.streams[0]!.level).toBe(0);
    first.playing = false;
    first.over = true;
    first.remaining = 0;
    h.tick(2);
    expect(h.streams[0]!.level).toBeGreaterThan(0);
    h.tick(152);
    const second = h.streams.find((s) => s.url.endsWith(TRACKS[1]!))!;
    expect(second?.playing).toBe(true);
    h.music.setTide(true);
    h.tick(0.1);
    expect(second.stop).toHaveBeenCalledWith(4);
    expect(h.streams.at(-1)!.url).toContain(MUSIC_BEDS.tide);
  });

  it('rain reduces music and stops a featured piece; the scene bed continues', () => {
    const h = scene();
    h.active.ref = { kind: 'wild' };
    h.tick(62);
    const first = h.streams.find((s) => s.url.endsWith(TRACKS[0]!))!;
    h.atmosphere.weather.rain = 1;
    h.tick(10);
    expect(first.over).toBe(true);
    expect(h.streams[0]!.level).toBeLessThan(0.6);
    expect(h.streams[0]!.level).toBeGreaterThan(0.4);
  });

  it('silences procedural tide pulses once M07 plays and restores them if it fails', () => {
    const h = scene();
    h.music.setTide(true);
    h.tick(12);
    h.tone.mockClear();
    h.tick(2);
    expect(h.tone).not.toHaveBeenCalled();
    const tide = h.streams.at(-1)!;
    tide.playing = false;
    tide.over = true;
    tide.remaining = 40;
    h.tick(10);
    expect(h.tone).toHaveBeenCalled();
    expect(h.streams).toHaveLength(1);
  });
});

describe('music bed transitions', () => {
  it('waits for the replacement to play before fading the old voice', () => {
    const h = audio();
    const bed = new MusicBed(h.synth);
    expect(bed.update('grey.mp3', 1)).toBe(true);
    h.loading();
    bed.update('night.mp3', 0.65);
    expect(h.streams[0]!.stop).not.toHaveBeenCalled();
    expect(h.streams[1]!.level).toBe(0);
    h.streams[1]!.playing = true;
    bed.update('night.mp3', 0.65);
    expect(h.streams[0]!.stop).toHaveBeenCalledWith(4);
    expect(h.streams[1]!.level).toBe(0.65);
  });

  it('overlaps another copy before the file ends without starting one every frame', () => {
    const h = audio();
    const bed = new MusicBed(h.synth);
    bed.update('grey.mp3', 1);
    h.streams[0]!.remaining = 4.9;
    bed.update('grey.mp3', 1);
    expect(h.streams).toHaveLength(2);
    expect(h.streams[0]!.stop).toHaveBeenCalledWith(4);
    for (let i = 0; i < 60; i++) bed.update('grey.mp3', 1);
    expect(h.streams).toHaveLength(2);
  });

  it('times out a missing replacement, releases the old mood and backs off retries', () => {
    const h = audio();
    const bed = new MusicBed(h.synth);
    bed.update('grey.mp3', 1);
    h.loading();
    bed.update('night.mp3', 1);
    h.advance(16);
    expect(bed.update('night.mp3', 1)).toBe(false);
    expect(h.streams[0]!.over).toBe(true);
    expect(h.streams[1]!.over).toBe(true);
    for (let i = 0; i < 59; i++) {
      h.advance(1);
      bed.update('night.mp3', 1);
    }
    expect(h.streams).toHaveLength(2);
    h.advance(2);
    bed.update('night.mp3', 1);
    expect(h.streams).toHaveLength(3);
    bed.dispose();
    expect(h.streams.every((s) => s.over)).toBe(true);
  });

  it('cancels obsolete downloads when the world changes again', () => {
    const h = audio();
    const bed = new MusicBed(h.synth);
    h.loading();
    bed.update('night.mp3', 1);
    bed.update('tide.mp3', 1);
    expect(h.streams[0]!.stop).toHaveBeenCalledWith(0);
    expect(h.streams[1]!.url).toContain('tide.mp3');
  });
});
