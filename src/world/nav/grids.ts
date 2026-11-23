// Walkability for the two worlds, as NavGrids for findPath.
import { TUNING } from '@/content/tuning';
import { ROAD_NONE, type CityLayout } from '../city/layout';
import { WATER_LEVEL } from '../wilderness/generator';
import type { NavGrid } from './path';
import { boundarySpans } from '../city/boundary';

/** City: roads and courtyards inside the wall; buildings and the wall ring are blocked. */
export function cityNav(l: CityLayout): NavGrid {
  const blocked = new Set<number>();
  for (const span of boundarySpans(l)) {
    const steps = Math.max(1, Math.ceil(span.length / (l.cell * 0.25)));
    for (let k = 0; k <= steps; k++) {
      const d = span.length * (k / steps - 0.5);
      const ix = Math.floor((span.x + span.tx * d - l.ox) / l.cell),
        iz = Math.floor((span.z + span.tz * d - l.oz) / l.cell);
      if (ix >= 0 && iz >= 0 && ix < l.n && iz < l.n) blocked.add(iz * l.n + ix);
    }
  }
  return {
    cell: l.cell,
    ox: l.ox,
    oz: l.oz,
    walkable: (ix, iz) => {
      if (ix < 0 || iz < 0 || ix >= l.n || iz >= l.n) return false;
      const i = iz * l.n + ix;
      if (blocked.has(i)) return false;
      if (l.roads[i] !== ROAD_NONE) return true; // river crossings on roads have bridge decks
      if (l.water[i] || l.buildingOf[i] !== 0) return false;
      return ix === 0 || iz === 0 || ix === l.n - 1 || iz === l.n - 1 || l.blockOf[i] !== 0;
    },
  };
}

/**
 * Wilderness: dry ground cells (heights sampled at cell centres). A monster can step or jump up to `combat.monsterJump` and drop
 * down up to `combat.monsterDrop`, so a path may go down a cliff it cannot come back up.
 * `blocked` marks trees and towers.
 */
export function terrainNav(
  height: (ix: number, iz: number) => number,
  blocked: (ix: number, iz: number) => boolean,
): NavGrid {
  const { monsterJump, monsterDrop } = TUNING.combat;
  return {
    cell: TUNING.world.cellSize,
    walkable: (ix, iz) => !blocked(ix, iz) && height(ix, iz) > WATER_LEVEL,
    passable: (ax, az, bx, bz) => {
      const rise = height(bx, bz) - height(ax, az);
      return rise <= monsterJump && -rise <= monsterDrop;
    },
  };
}
