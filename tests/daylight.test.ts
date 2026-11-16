import { describe, expect, it } from 'vitest';
import { daylightAt } from '@/engine/render/daylight';

describe('daylight', () => {
  it('the sun rises in the east, stands high and south at noon, and sets in the west', () => {
    const morning = daylightAt(7);
    const noon = daylightAt(12);
    const evening = daylightAt(17);
    expect(morning.dir.x).toBeGreaterThan(0.5);
    expect(evening.dir.x).toBeLessThan(-0.5);
    expect(noon.dir.y).toBeGreaterThan(morning.dir.y);
    expect(noon.dir.z).toBeGreaterThan(0);
    expect(Math.abs(noon.dir.x)).toBeLessThan(0.05);
  });

  it('is day at noon and night at midnight, with light never flat on the ground', () => {
    expect(daylightAt(12).night).toBe(0);
    expect(daylightAt(0).night).toBe(1);
    for (let h = 0; h < 24; h += 0.5) {
      const d = daylightAt(h);
      expect(d.dir.y).toBeGreaterThan(0.15);
      expect(d.dir.length()).toBeCloseTo(1);
    }
  });

  it('evening light is warmer than noon light', () => {
    const noon = daylightAt(12).sun;
    const golden = daylightAt(18.3).sun;
    expect(golden.x / golden.z).toBeGreaterThan(noon.x / noon.z);
  });

  it('changes smoothly and wraps around midnight', () => {
    for (let h = 0; h < 24; h += 0.1) {
      const a = daylightAt(h).zenith.clone();
      const b = daylightAt(h + 0.1).zenith;
      expect(a.distanceTo(b)).toBeLessThan(0.08);
    }
    expect(daylightAt(24.5).zenith.toArray()).toEqual(daylightAt(0.5).zenith.toArray());
  });
});
