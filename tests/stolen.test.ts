import { describe, expect, it } from 'vitest';
import { color } from '@/content/palette';
import { chroma, stolenColors } from '@/world/paint/stolen';

describe('stolen colours', () => {
  it('prefers vivid colours over dull ones, most common first', () => {
    const block = [
      ...Array(20).fill(color('cream')),
      ...Array(6).fill(color('red')),
      ...Array(9).fill(color('blue')),
      ...Array(2).fill(color('yellow')),
    ];
    expect(stolenColors(block)).toEqual([color('blue'), color('red')]);
  });

  it('falls back to dull colours when that is all there is, and to red with nothing', () => {
    // among dull colours the more colourful still counts for more, but numbers win in the end
    expect(stolenColors([color('stone'), color('stone'), color('cream')], 1)).toEqual([color('cream')]);
    expect(stolenColors([...Array(5).fill(color('stone')), color('cream')], 1)).toEqual([color('stone')]);
    expect(stolenColors([])).toEqual([color('red')]);
  });

  it('rates greys as dull and paints as vivid', () => {
    expect(chroma(color('charcoal'))).toBeLessThan(0.25);
    expect(chroma(color('cream'))).toBeLessThan(0.25);
    expect(chroma(color('red'))).toBeGreaterThan(0.5);
  });
});
