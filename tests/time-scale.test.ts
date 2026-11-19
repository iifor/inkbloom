import { describe, expect, it } from 'vitest';
import { ClockSystem } from '@/systems/clock/clock';
import { calendarAt, calendarClock, yearDuration } from '@/world/climate/calendar';
import { DEFAULT_SETTINGS, TIME_SCALES, loadSettings, saveSettings } from '@/world/settings';
import { createWorldState, deserializeWorld, serializeWorld } from '@/world/state';
import type { KeyValue } from '@/world/store';
import { headless } from './support/headless';

describe('environment time scale', () => {
  it('visits all four seasons in 56 seconds without accelerating gameplay time', () => {
    const { ctx } = headless();
    const clock = new ClockSystem(ctx);
    clock.timeScale = 720;
    const start = calendarAt(calendarClock(ctx.state));
    const seasons = new Set<number>();
    for (let i = 0; i < 4; i++) {
      seasons.add(calendarAt(calendarClock(ctx.state)).season);
      clock.update(14);
    }
    expect([...seasons]).toEqual([0, 1, 2, 3]);
    expect(ctx.state.clock).toBe(56);
    expect(calendarAt(calendarClock(ctx.state)).yearPhase).toBeCloseTo(start.yearPhase);
    expect(yearDuration(720)).toBe('一年约 56 秒');
  });

  it('changes rate without jumping dates, and resumes the same date after saving', () => {
    const { ctx } = headless();
    const clock = new ClockSystem(ctx);
    clock.timeScale = 240;
    clock.update(20);
    const before = calendarClock(ctx.state);
    clock.timeScale = 1;
    expect(calendarClock(ctx.state)).toBe(before);
    clock.update(2);
    expect(calendarClock(ctx.state)).toBe(before + 2);
    const restored = deserializeWorld(serializeWorld(ctx.state));
    expect(calendarClock(restored)).toBe(before + 2);
    expect(restored.clock).toBe(22);
  });

  it('keeps the shared server date online and retains the offline date offset', () => {
    const { ctx } = headless();
    const clock = new ClockSystem(ctx);
    clock.timeScale = 720;
    clock.update(1);
    Object.assign(ctx, { net: {} });
    clock.update(3);
    expect(ctx.state.calendarOffset).toBe(719);
    expect(calendarClock(ctx.state, true)).toBe(4);
    expect(calendarClock(ctx.state)).toBe(723);
  });

  it.each([1, 2, 3, 4])('loads version %i with the original calendar', (version) => {
    const json = JSON.parse(serializeWorld(createWorldState('old', 42)));
    json.version = version;
    json.clock = 123;
    delete json.calendarOffset;
    expect(calendarClock(deserializeWorld(JSON.stringify(json)))).toBe(123);
  });

  it.each([-1, null, '100', 'bad'])('rejects invalid saved offsets: %s', (calendarOffset) => {
    const json = JSON.parse(serializeWorld(createWorldState('bad', 42)));
    json.calendarOffset = calendarOffset;
    expect(deserializeWorld(JSON.stringify(json)).calendarOffset).toBe(0);
  });
});

describe('time preference', () => {
  const kv = (): KeyValue => {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      get length() {
        return map.size;
      },
      key: (i) => [...map.keys()][i] ?? null,
    };
  };

  it('remembers every supported rate and resets to normal', () => {
    const store = kv();
    expect(loadSettings(store).timeScale).toBe(1);
    for (const timeScale of TIME_SCALES) {
      saveSettings(store, { ...DEFAULT_SETTINGS, timeScale });
      expect(loadSettings(store).timeScale).toBe(timeScale);
    }
    saveSettings(store, DEFAULT_SETTINGS);
    expect(loadSettings(store).timeScale).toBe(1);
  });

  it.each(['null', '{}', '{"timeScale":0}', '{"timeScale":-10}', '{"timeScale":100}', '{"timeScale":"720"}'])(
    'safely defaults malformed or older settings: %s',
    (raw) => {
      const store = kv();
      store.setItem('inkbloom:settings', raw);
      expect(loadSettings(store).timeScale).toBe(1);
    },
  );
});
