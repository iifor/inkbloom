// How colourful the wilderness is at a point. Not saved anywhere: it is derived from the
// progress of nearby cities. The ink shader evaluates the same formula per vertex.
import { TUNING } from '@/content/tuning';
import { smoothstep } from '../math/noise';
import type { Entrance } from './generator';

export interface CityInfluence {
  /** The town's centre and half its side: the drain is measured from its wall. */
  readonly x: number;
  readonly z: number;
  readonly half: number;
  /** 0 = fully drained city, 1 = fully restored. */
  readonly progress: number;
}

export function falloff(distance: number): number {
  return 1 - smoothstep(TUNING.drain.innerRadius, TUNING.drain.outerRadius, distance);
}

/** 1 = full colour, 0 = black and white. */
export function saturationAt(x: number, z: number, cities: readonly CityInfluence[]): number {
  let drain = 0;
  for (const c of cities) {
    const d = Math.hypot(Math.max(Math.abs(x - c.x) - c.half, 0), Math.max(Math.abs(z - c.z) - c.half, 0));
    drain = Math.max(drain, (1 - c.progress) * falloff(d));
  }
  return 1 - drain;
}

/** A town's pull on the colour around it. */
export function influenceOf(e: Entrance, progress: number): CityInfluence {
  return { x: e.x, z: e.z, half: e.size / 2, progress };
}
