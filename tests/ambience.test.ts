import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Synth, ToneOptions } from '@/engine/audio/synth';
import type { GameContext } from '@/game/types';
import { Ambience } from '@/systems/audio/ambience';
import { AmbienceSites, ambienceGain } from '@/systems/audio/ambience-sites';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';

interface Scene {
  hour: number;
  /** Year phase: 0.125 mid-spring, 0.375 midsummer, 0.875 midwinter. */
  year: number;
  colour?: number;
  rain?: number;
  city?: boolean;
  /** Whether the recorded beds have loaded (else the synth plays the whole chorus). */
  beds?: boolean;
}

/** Counts what an Ambience plays over a minute in a given scene, with a synth that only listens.
 * The ambience rolls dice for each call; they are seeded here so every run hears the same minute. */
function listen(scene: Scene): { birds: number; crickets: number; owls: number; frogs: number } {
  let seed = 0x2545f491;
  const dice = vi
    .spyOn(Math, 'random')
    .mockImplementation(() => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const tones: ToneOptions[] = [];
  const loop = { set: () => {}, stop: () => {} };
  const synth = {
    ctx: {},
    running: true,
    now: 0,
    tone: (o: ToneOptions) => void tones.push(o),
    noise: () => {},
    noiseLoop: () => loop,
    stream: () => ({ ...loop, playing: !!scene.beds, over: !scene.beds }),
  } as unknown as Synth;
  const declination = ((23.44 * Math.PI) / 180) * Math.sin(2 * Math.PI * (scene.year - 0.125));
  const ctx = {
    renderer: {
      atmosphere: {
        hour: scene.hour,
        declination,
        year: scene.year,
        seaTemp: 12,
        colour: scene.colour ?? 1,
        weather: { rain: scene.rain ?? 0, snowfall: 0, windX: 1, windZ: 1 },
      },
    },
    scenes: { active: { ref: scene.city ? { kind: 'city', id: 'c0_0' } : { kind: 'wild' } } },
    player: { position: new THREE.Vector3(64, 0, 64), eye: new THREE.Vector3(64, 1.6, 64), yaw: 0 },
    wilderness: createWilderness(7),
  } as unknown as GameContext;
  const a = new Ambience(synth, ctx);
  for (let i = 0; i < 60 * 30; i++) a.update(1 / 30);
  dice.mockRestore();
  // every sound is a run of tones; count each one by its first tone
  const counts = { birds: 0, crickets: 0, owls: 0, frogs: 0 };
  let last: ToneOptions | null = null;
  for (const t of tones) {
    const newSound = !last || t.pos !== last.pos;
    last = t;
    if (!newSound) continue;
    if ((t.freq ?? 0) < 250) counts.frogs++;
    else if (t.freq === 400) counts.owls++;
    else if (t.dur === 0.018) counts.crickets++;
    else counts.birds++;
  }
  return counts;
}

describe('ambience', () => {
  it('anchors water and habitat sounds to the world across listener moves', () => {
    const world = createWilderness(7);
    const a = new AmbienceSites(world);
    const b = new AmbienceSites(world);
    const near = a.near(96, 64);
    const moved = a.near(125, 64);
    expect(near).toEqual(b.near(96, 64));
    expect(near.some((s) => (s.kind === 'forest' || s.kind === 'meadow') && moved.includes(s))).toBe(true);
    const banks = near.filter((s) => s.kind === 'water');
    expect(banks.length).toBeGreaterThan(0);
    for (const { pos } of banks) {
      expect(world.terrainHeightAt(pos.x, pos.z)).toBeLessThan(WATER_LEVEL);
      expect(pos.y).toBeGreaterThan(WATER_LEVEL);
    }
    expect(ambienceGain(8, 8, 62)).toBe(1);
    expect(ambienceGain(16, 8, 62)).toBe(0.5);
    expect(ambienceGain(60, 8, 62)).toBeLessThan(0.025);
    expect(ambienceGain(62, 8, 62)).toBe(0);
  });

  it('pans a running-water recording and fades it out when the listener leaves', () => {
    const world = createWilderness(7);
    const sites = new AmbienceSites(world);
    const source = sites.near(126, 430).find((s) => s.kind === 'current' && s.strength > 0.6);
    expect(source).toBeDefined();
    const position = new THREE.Vector3(source!.pos.x - 8, source!.pos.y + 1.4, source!.pos.z);
    const player = { position, eye: position, yaw: 0 };
    const audio = { level: 0, pan: 0 };
    const silent = { set: () => {}, stop: () => {} };
    const synth = {
      ctx: {},
      running: true,
      now: 0,
      tone: () => {},
      noiseLoop: () => silent,
      stream: (url: string) => ({
        ...silent,
        playing: true,
        over: false,
        set: (level: number, _seconds: number, pan: number) => {
          if (url.endsWith('river.ogg')) Object.assign(audio, { level, pan });
        },
      }),
    } as unknown as Synth;
    const ctx = {
      wilderness: world,
      player,
      scenes: { active: { ref: { kind: 'wild' } } },
      renderer: {
        atmosphere: {
          declination: 0,
          hour: 11,
          year: 0.125,
          seaTemp: 12,
          colour: 1,
          weather: { rain: 0, snowfall: 0, windX: 0, windZ: 0 },
        },
      },
    } as unknown as GameContext;
    const ambience = new Ambience(synth, ctx);
    ambience.update(0.1);
    expect(audio.level).toBeGreaterThan(0.6);
    expect(Math.abs(audio.pan)).toBeGreaterThan(0.1);
    const right = audio.pan;
    player.yaw = Math.PI;
    ambience.update(0.1);
    expect(audio.pan).toBeCloseTo(-right, 7);
    position.set(154, WATER_LEVEL + 1.6, -102);
    ambience.update(0.6);
    expect(world.terrainHeightAt(position.x, position.z)).toBeLessThan(WATER_LEVEL);
    expect(audio.level).toBe(0);
    position.set(36, WATER_LEVEL + 1.6, 89);
    ambience.update(0.6);
    expect(world.terrainHeightAt(position.x, position.z)).toBeLessThan(WATER_LEVEL);
    expect(audio.level).toBe(0);
    position.y += 120;
    ambience.update(0.1);
    expect(audio.level).toBe(0);
    ambience.dispose();
  });

  it('birds sing on a spring morning, loudest at dawn; crickets on a summer night', () => {
    const morning = listen({ hour: 9, year: 0.125 });
    const night = listen({ hour: 1, year: 0.375 });
    expect(morning.birds).toBeGreaterThan(10);
    expect(night.birds).toBe(0);
    expect(night.crickets).toBeGreaterThan(30);
    expect(morning.crickets).toBeLessThan(night.crickets / 3);
  });

  it('winter is quiet, rain silences the birds, and drained grey land is nearly silent', () => {
    const spring = listen({ hour: 10, year: 0.125 }).birds;
    expect(listen({ hour: 10, year: 0.875 }).birds).toBeLessThan(spring / 2);
    expect(listen({ hour: 10, year: 0.125, rain: 1 }).birds).toBeLessThan(spring / 5);
    expect(listen({ hour: 10, year: 0.125, colour: 0 }).birds).toBeLessThan(spring / 3);
  });

  it('a city has a few birds but no owls or frogs', () => {
    const city = listen({ hour: 10, year: 0.125, city: true });
    const night = listen({ hour: 1, year: 0.375, city: true });
    expect(city.birds).toBeGreaterThan(0);
    expect(night.owls + night.frogs).toBe(0);
  });

  it('with the recorded birdsong playing, the synthesised calls are only accents', () => {
    const alone = listen({ hour: 9, year: 0.125 }).birds;
    const over = listen({ hour: 9, year: 0.125, beds: true }).birds;
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(alone / 2);
  });
});
