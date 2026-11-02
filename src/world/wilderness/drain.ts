// How colourful the wilderness is at a point. Not saved anywhere: it is derived from the
// progress of nearby cities. The ink shader evaluates the same formula per vertex.
import { TUNING } from '@/content/tuning';
import { smoothstep } from '../math/noise';

export interface CityInfluence {
  readonly x: number;
  readonly z: number;
  /** 0 = fully drained city, 1 = fully restored. */
  readonly progress: number;
}

export function falloff(distance: number): number {
  return 1 - smoothstep(TUNING.drain.innerRadius, TUNING.drain.outerRadius, distance);
}

/** 1 = full colour, 0 = black and white. */
export function saturationAt(x: number, z: number, cities: readonly CityInfluence[]): number {
  let drain = 0;
  for (const c of cities) drain = Math.max(drain, (1 - c.progress) * falloff(Math.hypot(x - c.x, z - c.z)));
  return 1 - drain;
}
