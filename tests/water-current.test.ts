import { describe, expect, it } from 'vitest';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { RIVER_ORIGIN } from '@/world/wilderness/river-corridors';
import { currentSound, WaterCurrents } from '@/world/wilderness/water-current';

describe('water current', () => {
  const ratedChannel = (slope: number, basin = 0) =>
    new WaterCurrents({
      ...createWilderness(7),
      riverAt: () => ({ x: RIVER_ORIGIN, half: 16 }),
      rawHeightAt: (_x, z) => -z * slope,
      terrainHeightAt: () => WATER_LEVEL - 2,
      waterGuidesAt: () => ({ basin, branch: null }),
    });

  it('flows downhill along the channel and gets faster and louder as the grade increases', () => {
    const slow = ratedChannel(0.001).at(RIVER_ORIGIN, 0);
    const fast = ratedChannel(0.02).at(RIVER_ORIGIN, 0);
    const reversed = ratedChannel(-0.02).at(RIVER_ORIGIN, 0);
    expect(slow.z).toBeGreaterThan(0);
    expect(fast.z).toBeGreaterThan(slow.z);
    expect(reversed.z).toBeCloseTo(-fast.z);
    expect(currentSound(slow.z)).toBeLessThan(currentSound(fast.z));
    expect(ratedChannel(0).at(RIVER_ORIGIN, 0).z).toBe(0);
    expect(ratedChannel(0.02).at(RIVER_ORIGIN + 16, 0).z).toBeLessThan(fast.z);
  });

  it('keeps a lake centre and disconnected water out of the current', () => {
    expect(ratedChannel(0.02, 1).at(RIVER_ORIGIN, 0)).toEqual({ x: 0, z: 0 });
    expect(ratedChannel(0.02).at(RIVER_ORIGIN + 35, 0)).toEqual({ x: 0, z: 0 });
  });

  it('rejects a small puddle inside the surveyed river corridor across a dry bank', () => {
    const field = new WaterCurrents({
      ...createWilderness(7),
      riverAt: () => ({ x: RIVER_ORIGIN, half: 16 }),
      rawHeightAt: (_x, z) => -z * 0.05,
      terrainHeightAt: (x, z) => {
        const offset = x - RIVER_ORIGIN;
        if (Math.abs(offset) < 4) return WATER_LEVEL - 2;
        if (Math.hypot(offset - 10, z) < 4) return WATER_LEVEL - 0.4;
        return WATER_LEVEL + 1;
      },
      waterGuidesAt: () => ({ basin: 0, branch: null }),
    });
    expect(field.at(RIVER_ORIGIN, 0).z).toBeGreaterThan(1);
    expect(field.at(RIVER_ORIGIN + 10, 0)).toEqual({ x: 0, z: 0 });
  });

  it('follows a cross creek downhill between the main channels', () => {
    const x = RIVER_ORIGIN + 300;
    const field = new WaterCurrents({
      ...createWilderness(7),
      riverAt: () => ({ x: RIVER_ORIGIN, half: 16 }),
      rawHeightAt: (px) => px * 0.02,
      terrainHeightAt: () => WATER_LEVEL - 0.45,
      waterGuidesAt: () => ({ basin: 0, branch: { x, z: 0, dx: 1, dz: 0, distance: 0, half: 10 } }),
    });
    const v = field.at(x, 0);
    expect(v.x).toBeLessThan(0);
    expect(v.z).toBeCloseTo(0);
  });
});
