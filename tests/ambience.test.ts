import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Synth, ToneOptions } from '@/engine/audio/synth';
import type { GameContext } from '@/game/types';
import { Ambience } from '@/systems/audio/ambience';
import { createWilderness } from '@/world/wilderness/generator';

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

/** Counts what an Ambience plays over a minute in a given scene, with a synth that only listens. */
function listen(scene: Scene): { birds: number; crickets: number; owls: number; frogs: number } {
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
    player: { position: new THREE.Vector3(64, 0, 64), eye: new THREE.Vector3(64, 1.6, 64) },
    wilderness: createWilderness(7),
  } as unknown as GameContext;
  const a = new Ambience(synth, ctx);
  for (let i = 0; i < 60 * 30; i++) a.update(1 / 30);
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
