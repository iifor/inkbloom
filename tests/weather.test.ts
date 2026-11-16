import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { calendarAt } from '@/world/climate/calendar';
import { boltsAt, createWeather } from '@/world/climate/weather';
import { createWilderness } from '@/world/wilderness/generator';

const land = createWilderness(4242);
const weatherAt = createWeather(land);
const YEAR = 4 * TUNING.season.days * TUNING.day.length;

/** Per season (0 spring .. 3 winter): share of samples raining, snowing, thundering. */
function yearStats(): { rain: number; snowing: number; thunder: number }[] {
  const s = [0, 1, 2, 3].map(() => ({ n: 0, rain: 0, snowing: 0, thunder: 0 }));
  for (let p = 0; p < 12; p++) {
    const x = (p % 4) * 2700 - 4000;
    const z = Math.floor(p / 4) * 3300 - 3000;
    for (let t = 0; t < YEAR; t += 151) {
      const w = weatherAt(t, x, z);
      const st = s[calendarAt(t).season]!;
      st.n++;
      if (w.precip > 0.1) {
        if (w.snow > 0.5) st.snowing++;
        else st.rain++;
      }
      if (w.thunder > 0.1) st.thunder++;
    }
  }
  return s.map(({ n, rain, snowing, thunder }) => ({
    rain: rain / n,
    snowing: snowing / n,
    thunder: thunder / n,
  }));
}
const stats = yearStats();

describe('weather', () => {
  it('is the same sky for everyone with the same seed', () => {
    const again = createWeather(createWilderness(4242));
    const other = createWeather(createWilderness(4243));
    let differs = false;
    for (let i = 0; i < 50; i++) {
      const t = i * 977;
      const x = i * 131 - 3000;
      const z = 2000 - i * 89;
      expect(again(t, x, z)).toEqual(weatherAt(t, x, z));
      if (other(t, x, z).precip !== weatherAt(t, x, z).precip) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('changes smoothly over a second and across a metre, also years into a world', () => {
    for (const base of [0, YEAR - 300, YEAR * 7.3]) {
      for (let i = 0; i < 200; i++) {
        const t = base + i * 3.7;
        const a = weatherAt(t, 400, -900);
        const later = weatherAt(t + 1, 400, -900);
        const beside = weatherAt(t, 401, -900);
        for (const k of ['cloud', 'precip', 'fog', 'thunder'] as const) {
          expect(Math.abs(later[k] - a[k]), k).toBeLessThan(0.1);
          expect(Math.abs(beside[k] - a[k]), k).toBeLessThan(0.1);
        }
        expect(Math.abs(later.temp - a.temp)).toBeLessThan(0.1);
      }
    }
  });

  it('rain falls in places: somewhere is wet while elsewhere is dry', () => {
    let wet = 0;
    let dry = 0;
    for (let i = 0; i < 400; i++) {
      const w = weatherAt(5000, (i % 20) * 400, Math.floor(i / 20) * 400);
      if (w.precip > 0.5) wet++;
      if (w.precip === 0) dry++;
    }
    expect(wet).toBeGreaterThan(0);
    expect(dry).toBeGreaterThan(0);
  });

  it('rains or snows about a quarter of the time over a year', () => {
    const share = stats.reduce((a, s) => a + s.rain + s.snowing, 0) / 4;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.35);
  });

  it('snows in winter, never in summer; autumn is the driest season', () => {
    expect(stats[3]!.snowing).toBeGreaterThan(0.05);
    expect(stats[1]!.snowing).toBe(0);
    const precip = stats.map((s) => s.rain + s.snowing);
    expect(precip[2]).toBeLessThan(Math.min(precip[0]!, precip[1]!, precip[3]!));
  });

  it('thunderstorms are a summer thing (a few linger into the warm start of autumn)', () => {
    expect(stats[1]!.thunder).toBeGreaterThan(0.01);
    expect(stats[1]!.thunder).toBeGreaterThan(stats[0]!.thunder * 2);
    expect(stats[1]!.thunder).toBeGreaterThan(stats[2]!.thunder * 2);
    expect(stats[3]!.thunder).toBe(0);
  });

  it('the ground stays wet for a while after the rain stops', () => {
    let checked = 0;
    for (let t = 1000; t < YEAR && checked < 5; t += 10) {
      if (weatherAt(t, 0, 0).precip > 0.6 && weatherAt(t + 10, 0, 0).precip < 0.6) {
        // find where it stops, then look a minute later
        let end = t + 10;
        while (weatherAt(end, 0, 0).precip > 0 && end < t + 3000) end += 10;
        const after = weatherAt(end + 60, 0, 0);
        const later = weatherAt(end + 600, 0, 0);
        let dry = after.snowCover <= 0.1;
        for (let s = end; s <= end + 600 && dry; s += 10) if (weatherAt(s, 0, 0).precip > 0) dry = false;
        if (!dry) continue;
        expect(after.wetness).toBeGreaterThan(0.1);
        expect(later.wetness).toBeLessThan(after.wetness);
        checked++;
        t = end + 600;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the wind blows from the north-west in autumn and the north in winter', () => {
    const autumn = weatherAt(YEAR * 0.625, 0, 0).wind;
    const winter = weatherAt(YEAR * 0.875, 0, 0).wind;
    expect(autumn[0]).toBeGreaterThan(0);
    expect(autumn[1]).toBeGreaterThan(0);
    expect(winter[1]).toBeGreaterThan(Math.abs(winter[0]));
  });
});

describe('lightning', () => {
  it('strikes in summer storms, the same bolts for everyone, never in winter', () => {
    const again = createWeather(createWilderness(4242));
    let summer = 0;
    let winter = 0;
    for (let s = Math.floor(YEAR * 0.3); s < YEAR * 0.45; s += 7) {
      const bolts = boltsAt(weatherAt, 4242, s, 0, 0, 900);
      expect(boltsAt(again, 4242, s, 0, 0, 900)).toEqual(bolts);
      for (const b of bolts) expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(900);
      summer += bolts.length;
    }
    for (let s = Math.floor(YEAR * 0.8); s < YEAR * 0.95; s += 7)
      winter += boltsAt(weatherAt, 4242, s, 0, 0, 900).length;
    expect(summer).toBeGreaterThan(0);
    expect(winter).toBe(0);
  });
});
