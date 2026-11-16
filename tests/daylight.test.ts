import { describe, expect, it } from 'vitest';
import { dayHours, daylightAt, noonElevation } from '@/engine/render/daylight';

const SUMMER = (23.44 * Math.PI) / 180;
const WINTER = -SUMMER;
const deg = (r: number): number => (r * 180) / Math.PI;
/** Degrees above the horizon. */
const height = (hour: number, dec: number): number => deg(Math.asin(daylightAt(hour, dec).dir.y));

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

describe('daylight through the year', () => {
  it('days are 12 hours at the equinox, long in summer and short in winter', () => {
    expect(dayHours(0)).toBeCloseTo(12);
    expect(dayHours(SUMMER)).toBeGreaterThan(14);
    expect(dayHours(WINTER)).toBeLessThan(10);
    expect(dayHours(SUMMER) + dayHours(WINTER)).toBeCloseTo(24);
  });

  it('the noon sun stands high in summer and low in winter', () => {
    expect(deg(noonElevation(SUMMER))).toBeGreaterThan(75);
    expect(deg(noonElevation(WINTER))).toBeLessThan(35);
    expect(height(12, SUMMER)).toBeCloseTo(deg(noonElevation(SUMMER)), 0);
    expect(height(12, WINTER)).toBeCloseTo(deg(noonElevation(WINTER)), 0);
    expect(height(12, SUMMER)).toBeGreaterThan(height(12, 0) + 15);
    expect(height(12, WINTER)).toBeLessThan(height(12, 0) - 15);
  });

  it('summer evenings stay light later; winter nights come early', () => {
    expect(daylightAt(20, SUMMER).night).toBeLessThan(daylightAt(20, 0).night);
    expect(daylightAt(18.5, WINTER).night).toBeGreaterThan(daylightAt(18.5, 0).night);
    const goldenSummer = daylightAt(19.5, SUMMER).sun;
    const goldenEquinox = daylightAt(18.3, 0).sun;
    expect(goldenSummer.distanceTo(goldenEquinox)).toBeLessThan(0.15);
  });

  it('keeps noon at noon and stays smooth and above the horizon in every season', () => {
    for (const dec of [SUMMER, WINTER]) {
      expect(Math.abs(daylightAt(12, dec).dir.x)).toBeLessThan(0.05);
      for (let h = 0; h < 24; h += 0.1) {
        const d = daylightAt(h, dec);
        expect(d.dir.y).toBeGreaterThan(0.15);
        expect(d.zenith.distanceTo(daylightAt(h + 0.1, dec).zenith)).toBeLessThan(0.1);
      }
    }
  });
});
