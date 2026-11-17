import { describe, expect, it } from 'vitest';
import { type Ground, stepLayers } from '@/systems/audio/footsteps';

const dry = (footing: Ground['footing']): Ground => ({ footing, snow: 0, wet: 0, leaves: 0 });

describe('footsteps', () => {
  it('each kind of ground sounds different', () => {
    const sounds = (['grass', 'stone', 'sand', 'rock', 'shallows'] as const).map((f) =>
      JSON.stringify(stepLayers(dry(f), 0)),
    );
    expect(new Set(sounds).size).toBe(5);
    for (const f of ['grass', 'stone', 'sand', 'rock', 'shallows'] as const)
      expect(stepLayers(dry(f), 0)).toHaveLength(1);
  });

  it('left and right feet differ a little', () => {
    expect(stepLayers(dry('grass'), 0)[0]!.freq).not.toBe(stepLayers(dry('grass'), 1)[0]!.freq);
  });

  it('deep snow crunches and muffles the ground under it', () => {
    const snowy = stepLayers({ footing: 'grass', snow: 1, wet: 0, leaves: 0 }, 0);
    expect(snowy.some((l) => l.type === 'bandpass' && (l.freq ?? 0) >= 2400)).toBe(true);
    // the grass thud is gone under deep snow
    expect(snowy.some((l) => l.type === 'lowpass' && l.freq === 420)).toBe(false);
  });

  it('wet ground slaps and autumn leaves rustle, but not under snow', () => {
    const wet = stepLayers({ footing: 'stone', snow: 0, wet: 1, leaves: 0 }, 0);
    const leafy = stepLayers({ footing: 'grass', snow: 0, wet: 0, leaves: 1 }, 0);
    expect(wet).toHaveLength(2);
    expect(leafy.some((l) => l.type === 'highpass')).toBe(true);
    const buried = stepLayers({ footing: 'grass', snow: 1, wet: 1, leaves: 1 }, 0);
    expect(buried.some((l) => l.type === 'highpass')).toBe(false);
  });

  it('wading is just the splash', () => {
    expect(stepLayers({ footing: 'shallows', snow: 0, wet: 1, leaves: 1 }, 0)).toHaveLength(1);
  });
});
