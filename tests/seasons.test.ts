import { describe, expect, it } from 'vitest';
import { PALETTE } from '@/content/palette';
import { SEASONS } from '@/content/seasons';
import { seasonBlend } from '@/world/climate/calendar';
import { meanTemperature, snowCover } from '@/world/climate/temperature';

/** Middle of season `s` (0 spring .. 3 winter) as a year phase. */
const mid = (s: number): number => (s + 0.5) / 4;
/** Snow on ground `height` metres up in the middle of season `s`. */
const snowAt = (s: number, height: number): number => snowCover(meanTemperature(mid(s), height));

describe('season looks', () => {
  it('hold each look in the middle of its season and blend across the turn', () => {
    for (let s = 0; s < 4; s++) {
      const b = seasonBlend(mid(s));
      expect(b.from).toBe(s);
      expect(b.t).toBeCloseTo(0);
    }
    // the first day of summer is halfway from the spring look to the summer one
    const turn = seasonBlend(0.25);
    expect([turn.from, turn.to]).toEqual([0, 1]);
    expect(turn.t).toBeCloseTo(0.5);
    // and winter blends back into spring over the new year
    expect(seasonBlend(0.99).from).toBe(3);
    expect(seasonBlend(0.99).to).toBe(0);
  });

  it('change smoothly through the whole year', () => {
    const look = (p: number): number => {
      const b = seasonBlend(p);
      return SEASONS[b.from]!.flowers * (1 - b.t) + SEASONS[b.to]!.flowers * b.t;
    };
    for (let p = 0; p < 1; p += 0.001) expect(Math.abs(look(p + 0.001) - look(p))).toBeLessThan(0.01);
  });

  it('are in calendar order, and summer is the palette as painted', () => {
    expect(SEASONS.map((s) => s.key)).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(SEASONS[1]!.meadow.amount).toBe(0);
    expect(SEASONS[1]!.leaf.amount).toBe(0);
  });

  it('only natural colours change with the seasons, so walls and graffiti stay put', () => {
    const seasonal = PALETTE.filter((c) => 'season' in c);
    expect(seasonal.length).toBeGreaterThan(0);
    for (const c of seasonal) expect(c.paintable).toBe(false);
  });
});

describe('temperature and snow', () => {
  it('is warmest in midsummer and coldest in midwinter, and colder up the hills', () => {
    expect(meanTemperature(mid(1))).toBeGreaterThan(20);
    expect(meanTemperature(mid(3))).toBeLessThan(1);
    expect(meanTemperature(mid(0))).toBeCloseTo(meanTemperature(mid(2)));
    expect(meanTemperature(mid(1), 30)).toBeLessThan(meanTemperature(mid(1)) - 10);
  });

  it('snow: none in summer, peaks white through spring and autumn, plains only in midwinter', () => {
    expect(snowAt(1, 0)).toBe(0);
    expect(snowAt(1, 36)).toBe(0);
    for (const s of [0, 2]) {
      expect(snowAt(s, 0)).toBe(0);
      expect(snowAt(s, 36)).toBeGreaterThan(0.7);
    }
    expect(snowAt(3, 0)).toBeGreaterThan(0.2);
    expect(snowAt(3, 20)).toBe(1);
  });
});
