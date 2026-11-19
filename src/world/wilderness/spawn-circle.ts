import { TUNING } from '@/content/tuning';

export const SPAWN_CENTER = TUNING.world.chunkSize / 2;
export const SPAWN_STONE_RADIUS = 4.4;

export function spawnStoneDistance(x: number, z: number): number {
  return Math.hypot(x - SPAWN_CENTER, z - SPAWN_CENTER) - SPAWN_STONE_RADIUS;
}
