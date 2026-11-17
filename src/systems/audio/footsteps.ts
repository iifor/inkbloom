// Footsteps that tell you what you are walking on: soft grass, hard paving, hissing sand, clicky
// rock, splashing shallows, and on top of that the season and weather underfoot: a squeaky
// crunch in snow, a wet slap after rain, a rustle through autumn leaves. `groundUnder` reads the
// world where the player stands; `stepLayers` turns that into the noise bursts of one step
// (pure, so it can be tested).
import { BIOMES } from '@/content/biomes';
import { TUNING } from '@/content/tuning';
import type { NoiseOptions } from '@/engine/audio/synth';
import type { GameContext } from '@/game/types';
import { seasonBlend } from '@/world/climate/calendar';
import { snowCover } from '@/world/climate/temperature';

export type Footing = 'grass' | 'stone' | 'sand' | 'rock' | 'shallows';

export interface Ground {
  readonly footing: Footing;
  /** Snow lying underfoot, 0..1. */
  readonly snow: number;
  /** Wet ground after rain, 0..1. */
  readonly wet: number;
  /** Fallen leaves underfoot (autumn, under trees), 0..1. */
  readonly leaves: number;
}

/** Ground steeper than this (rise over run) is bare rock underfoot. */
const ROCKY = 0.75;

export function groundUnder(ctx: GameContext): Ground {
  const { player, scenes, wilderness, renderer } = ctx;
  const a = renderer.atmosphere;
  const w = a.weather;
  const { x, y, z } = player.position;
  const wild = scenes.active.ref.kind === 'wild';
  // the same snow line the renderer paints: colder higher up, plus any fresh fall
  const snow = Math.max(snowCover(a.seaTemp - TUNING.season.lapse * y), w.freshSnow);
  if (player.waterMode === 'wading') return { footing: 'shallows', snow: 0, wet: 0, leaves: 0 };
  if (!wild) return { footing: 'stone', snow, wet: w.wet, leaves: 0 };
  const biome = BIOMES[wilderness.biomeAt(x, z)]!;
  const slope =
    Math.hypot(
      wilderness.heightAt(x + 1, z) - wilderness.heightAt(x - 1, z),
      wilderness.heightAt(x, z + 1) - wilderness.heightAt(x, z - 1),
    ) / 2;
  const footing: Footing = slope > ROCKY ? 'rock' : biome.key === 'water' ? 'sand' : 'grass';
  const sb = seasonBlend(a.year);
  const autumn = (sb.from === 2 ? 1 - sb.t : 0) + (sb.to === 2 ? sb.t : 0);
  const trees = biome.key === 'forest' ? 1 : biome.key === 'grassland' ? 0.25 : 0.4;
  return { footing, snow, wet: w.wet, leaves: footing === 'grass' ? autumn * trees : 0 };
}

/** The noise bursts of one step. `side` alternates 0/1 so left and right feet differ a little. */
export function stepLayers(g: Ground, side: number): NoiseOptions[] {
  const out: NoiseOptions[] = [];
  // snow muffles whatever is under it
  const under = 1 - Math.min(1, g.snow * 1.2);
  const base: Record<Footing, NoiseOptions> = {
    grass: { dur: 0.07, gain: 0.09, type: 'lowpass', freq: 420 + side * 60 },
    stone: { dur: 0.07, gain: 0.09, type: 'bandpass', freq: 900 + side * 120, q: 2 },
    sand: { dur: 0.12, gain: 0.07, type: 'bandpass', freq: 1600 + side * 150, q: 0.7 },
    rock: { dur: 0.05, gain: 0.1, type: 'bandpass', freq: 1200 + side * 160, q: 3 },
    shallows: { dur: 0.21, gain: 0.09, type: 'bandpass', freq: 2200, freqEnd: 520, q: 1 },
  };
  const b = base[g.footing];
  if (under > 0.05) out.push({ ...b, gain: b.gain! * under });
  if (g.footing === 'shallows') return out;
  if (g.snow > 0.15) {
    // a squeaky crunch on top, a soft thud beneath
    out.push({
      dur: 0.16,
      gain: 0.1 * g.snow,
      type: 'bandpass',
      freq: 2400 + side * 200,
      freqEnd: 800,
      q: 1.5,
    });
    out.push({ dur: 0.08, gain: 0.06 * g.snow, type: 'lowpass', freq: 300 });
  } else {
    if (g.wet > 0.2)
      out.push({ dur: 0.08, gain: 0.06 * g.wet, type: 'bandpass', freq: 1100, freqEnd: 500, q: 2 });
    if (g.leaves > 0.2)
      out.push({ dur: 0.13, gain: 0.05 * g.leaves, type: 'highpass', freq: 2500 + side * 300 });
  }
  return out;
}
