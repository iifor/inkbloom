import { describe, expect, it } from 'vitest';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { RIVER_ORIGIN } from '@/world/wilderness/river-corridors';
import { createDrainage, riverPool } from '@/world/wilderness/drainage';
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

  it('shows a current through broad slow reaches while protecting quiet water off the channel', () => {
    const flat = ratedChannel(0);
    const pool = ratedChannel(0.001, 1);
    const rapid = ratedChannel(0.04);
    expect(flat.at(RIVER_ORIGIN, 0).z).toBe(0);
    expect(flat.surfaceAt(RIVER_ORIGIN, 0).z).toBeGreaterThan(0.4);
    expect(pool.surfaceAt(RIVER_ORIGIN, 0).z).toBeGreaterThan(0.3);
    expect(pool.surfaceAt(RIVER_ORIGIN, 0).z).toBeLessThan(rapid.surfaceAt(RIVER_ORIGIN, 0).z);
    expect(pool.surfaceAt(RIVER_ORIGIN + 35, 0)).toEqual({ x: 0, z: 0 });
  });

  it('keeps the flow parallel to an angled reach, even on the shallow side', () => {
    const field = new WaterCurrents({
      ...createWilderness(7),
      riverAt: (_lane, z) => ({ x: RIVER_ORIGIN + z * 0.45, half: 16 }),
      rawHeightAt: (_x, z) => z * 0.0002,
      terrainHeightAt: () => WATER_LEVEL - 0.16,
      waterGuidesAt: () => ({ basin: 0, branch: null }),
    });
    const shore = field.surfaceAt(RIVER_ORIGIN + 12, 0);
    expect(shore.z).toBeLessThan(-0.05);
    expect(shore.x / shore.z).toBeCloseTo(0.45);
  });

  it('varies river width and bed depth together and keeps pools quieter than riffles', () => {
    const shaped = createDrainage(7, () => 8, true, true);
    const old = createDrainage(7, () => 8, true);
    const course = () => ({ x: RIVER_ORIGIN, half: 16 });
    const pool = 50, riffle = -50;
    expect(riverPool(0, pool)).toBeGreaterThan(0.8);
    expect(riverPool(0, riffle)).toBeLessThan(0.2);
    const height = (x: number, z: number) => shaped.riverGround(8, RIVER_ORIGIN + x, z, course);
    expect(height(0, pool)).toBeLessThan(height(0, riffle) - 2);
    expect(height(15, pool)).toBeLessThan(WATER_LEVEL);
    expect(height(15, riffle)).toBeGreaterThanOrEqual(WATER_LEVEL);
    expect(old.riverGround(8, RIVER_ORIGIN, pool, course)).toBe(old.riverGround(8, RIVER_ORIGIN, riffle, course));
    const field = ratedChannel(0.02);
    const quiet = field.at(RIVER_ORIGIN, pool).z;
    const fast = field.at(RIVER_ORIGIN, riffle).z;
    expect(fast).toBeGreaterThan(quiet * 1.6);
    expect(currentSound(quiet)).toBeLessThan(currentSound(fast) * 0.4);
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
    expect(field.surfaceAt(RIVER_ORIGIN + 10, 0)).toEqual({ x: 0, z: 0 });
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
