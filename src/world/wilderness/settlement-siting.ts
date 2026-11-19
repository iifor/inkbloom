import { TUNING } from '@/content/tuning';
import { hashAt, unit } from '../math/hash';
import { createNoise2D, smoothstep } from '../math/noise';
import { WATER_LEVEL } from './water-level';

/** Cells remain a spatial index, not a row of mandatory settlement sites. */
export function createSettlementSiting(seed: number, ground: (x: number, z: number) => number) {
  const density = createNoise2D(hashAt(seed, 'settlement-density'));
  const span = TUNING.structures.cityGrid * TUNING.world.chunkSize;
  const middle = TUNING.world.chunkSize / 2;
  const grid = TUNING.world.cellSize;
  return (gx: number, gz: number, size: number): { ox: number; oz: number } | null => {
    const cx = gx * span + middle,
      cz = gz * span + middle;
    // Broad inhabited regions alternate with quieter countryside, without removing spawn.
    const chance = 0.58 + 0.36 * smoothstep(-0.45, 0.45, density(cx / 2400, cz / 2400));
    if (unit(hashAt(seed, 'settlement-presence', gx, gz)) > chance) return null;
    // Leave two skirts between adjacent footprints, including after terrain-grid snapping.
    const travel = (span - size) / 2 - TUNING.structures.townSkirt - grid;
    let best: { ox: number; oz: number } | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 12; i++) {
      const ox =
        Math.round((cx - size / 2 + (unit(hashAt(seed, 'site-x', gx, gz, i)) * 2 - 1) * travel) / grid) *
        grid;
      const oz =
        Math.round((cz - size / 2 + (unit(hashAt(seed, 'site-z', gx, gz, i)) * 2 - 1) * travel) / grid) *
        grid;
      // The hand-placed introductory village is off-centre; protect its outskirts too.
      const [sx, sz] = TUNING.structures.firstTownOrigin;
      const starterSize = TUNING.city.firstCityChunks * TUNING.world.chunkSize;
      const starterGap = Math.hypot(
        Math.max(sx - ox - size, ox - sx - starterSize, 0),
        Math.max(sz - oz - size, oz - sz - starterSize, 0),
      );
      if (starterGap < TUNING.structures.townSkirt * 2) continue;
      let low = Infinity,
        high = -Infinity,
        sum = 0,
        wet = 0;
      for (const u of [0.1, 0.5, 0.9])
        for (const v of [0.1, 0.5, 0.9]) {
          const h = ground(ox + size * u, oz + size * v);
          low = Math.min(low, h);
          high = Math.max(high, h);
          sum += h;
          if (h < WATER_LEVEL + 0.75) wet++;
        }
      // Do not turn a lake or steep mountainside into a giant village platform.
      if (wet > 1 || high - low > 32 || sum / 9 <= WATER_LEVEL + 1) continue;
      // Favor gentle, low valleys. Water alongside the footprint is welcome, underneath isn't.
      let bank = Infinity;
      for (const [u, v] of [
        [-0.15, 0.5],
        [1.15, 0.5],
        [0.5, -0.15],
        [0.5, 1.15],
      ])
        bank = Math.min(bank, Math.abs(ground(ox + size * u!, oz + size * v!) - WATER_LEVEL));
      const score = (high - low) * 1.4 + (sum / 9) * 0.12 + wet * 20 + Math.min(bank, 12) * 0.22;
      if (score < bestScore) {
        bestScore = score;
        best = { ox, oz };
      }
    }
    return best;
  };
}
