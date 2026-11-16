import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { calendarAt } from '@/world/climate/calendar';

const DAY = TUNING.day.length;
const YEAR = TUNING.season.days * 4;
/** Clock time at `hour` on day `day` of the year. */
const at = (day: number, hour: number): number =>
  (day - TUNING.season.startDay + (hour - TUNING.day.startHour) / 24) * DAY;

describe('calendar', () => {
  it('a new world starts on its start day and hour, in spring', () => {
    const c = calendarAt(0);
    expect(c.day).toBe(TUNING.season.startDay);
    expect(c.hour).toBeCloseTo(TUNING.day.startHour);
    expect(c.season).toBe(0);
    expect(c.seasonDay).toBe(TUNING.season.startDay + 1);
  });

  it('runs through the four seasons and wraps into the next year', () => {
    const D = TUNING.season.days;
    expect(calendarAt(at(0, 12)).season).toBe(0);
    expect(calendarAt(at(D, 12)).season).toBe(1);
    expect(calendarAt(at(2 * D, 12)).season).toBe(2);
    expect(calendarAt(at(4 * D - 1, 12)).season).toBe(3);
    expect(calendarAt(at(4 * D - 1, 12)).seasonDay).toBe(D);
    const next = calendarAt(at(YEAR + 1, 12));
    expect(next.season).toBe(0);
    expect(next.seasonDay).toBe(2);
    expect(next.day).toBe(YEAR + 1);
  });

  it('equinoxes and solstices fall mid-season: the sun is highest in the middle of summer', () => {
    const tilt = (23.44 * Math.PI) / 180;
    const mid = (season: number): number => calendarAt(at((YEAR / 4) * (season + 0.5), 0)).declination;
    expect(mid(0)).toBeCloseTo(0);
    expect(mid(1)).toBeCloseTo(tilt);
    expect(mid(2)).toBeCloseTo(0);
    expect(mid(3)).toBeCloseTo(-tilt);
    expect(calendarAt(at(0, 0)).declination).toBeLessThan(0);
  });

  it('changes smoothly through the hours and over the new year', () => {
    for (let t = 0; t < YEAR * DAY * 1.5; t += DAY / 7) {
      const a = calendarAt(t);
      const b = calendarAt(t + 1);
      expect(Math.abs(b.declination - a.declination)).toBeLessThan(1e-3);
      expect((b.hour - a.hour + 24) % 24).toBeCloseTo(24 / DAY);
    }
  });
});
