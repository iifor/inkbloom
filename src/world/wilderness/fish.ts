import { FISH_SPECIES, type FishHabitat, type FishSpecies } from '@/content/fish';
import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL, RIVER_X, RIVER_LANE } from './generator';

/** Depth first, then the actual meandering river channel; open water favours lake fish. */
export function fishHabitat(w: Wilderness, x: number, z: number): FishHabitat {
  if (WATER_LEVEL - w.heightAt(x, z) < 1.6) return 'shallows';
  const lane = Math.round((x - TUNING.world.chunkSize / 2 - RIVER_X) / RIVER_LANE);
  const river = w.riverAt(lane, z);
  return Math.abs(x - river.x) < river.half ? 'river' : 'lake';
}

export function fishSpeciesAt(w: Wilderness, x: number, z: number): FishSpecies {
  const habitat = fishHabitat(w, x, z);
  let pick =
    unit(hashAt(w.seed, 'fish-species', x, z)) * FISH_SPECIES.reduce((sum, s) => sum + s.weights[habitat], 0);
  for (const s of FISH_SPECIES) {
    pick -= s.weights[habitat];
    if (pick < 0) return s;
  }
  return FISH_SPECIES[0]!;
}
