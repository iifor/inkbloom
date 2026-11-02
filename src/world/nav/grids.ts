// Walkability for the two worlds, as NavGrids for findPath.
import { TUNING } from '@/content/tuning';
import { ROAD_NONE, type CityLayout } from '../city/layout';
import { WATER_LEVEL } from '../wilderness/generator';
import type { NavGrid } from './path';

/** City: roads and courtyards inside the wall; buildings and the wall ring are blocked. */
export function cityNav(l: CityLayout): NavGrid {
  return {
    cell: l.cell,
    walkable: (ix, iz) => {
      if (ix < 1 || iz < 1 || ix >= l.n - 1 || iz >= l.n - 1) return false;
      const i = iz * l.n + ix;
      return l.roads[i] !== ROAD_NONE || (l.blockOf[i] !== 0 && l.buildingOf[i] === 0);
    },
  };
}

/**
 * Wilderness: dry terrace cells, stepping only between cells whose heights differ by no more
 * than a body can step up (monsters cannot jump). `blocked` marks trees and towers.
 */
export function terrainNav(
  height: (ix: number, iz: number) => number,
  blocked: (ix: number, iz: number) => boolean,
): NavGrid {
  const step = TUNING.player.stepHeight;
  return {
    cell: TUNING.world.cellSize,
    walkable: (ix, iz) => !blocked(ix, iz) && height(ix, iz) > WATER_LEVEL,
    passable: (ax, az, bx, bz) => Math.abs(height(ax, az) - height(bx, bz)) <= step,
  };
}
