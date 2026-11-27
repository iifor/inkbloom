import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InkRenderer } from '@/engine/render/renderer';
import { Loop } from '@/game/loop';
import { profileLoop } from '@/shell/profile-loop';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { hidden: true });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(draw = vi.fn()) {
  const updates: number[] = [];
  const loop = new Loop([{ id: 'test', update: (dt) => updates.push(dt) }], () => {}, draw, vi.fn());
  const renderer = { passTimes: null, renderer: { info: { render: { calls: 3, triangles: 100 } } } };
  return { loop, updates, renderer: renderer as unknown as InkRenderer };
}

it('paces hidden simulation near 60 Hz, cancels the RAF probe, and leaves a stopped loop stopped', async () => {
  const s = setup();
  const result = profileLoop(s.loop, s.renderer, 1);
  await vi.runAllTimersAsync();
  const stats = await result;
  expect(stats.manual).toBe(true);
  expect(stats.frames).toBeGreaterThanOrEqual(58);
  expect(stats.frames).toBeLessThanOrEqual(60);
  expect(s.updates.every((dt) => dt >= 1 / 60 && dt <= 0.018)).toBe(true);
  expect(stats.calls).toBe(stats.frames * 3);
  expect(stats.elapsedMs).toBeGreaterThanOrEqual(1000);
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  expect(s.loop.isRunning).toBe(false);
  expect(s.loop.profile).toBeNull();
  expect(s.renderer.passTimes).toBeNull();
});

it('does not burst extra frames after an expensive draw', async () => {
  const starts: number[] = [];
  const s = setup(
    vi.fn(() => {
      starts.push(performance.now());
      if (starts.length === 2) vi.setSystemTime(Date.now() + 80);
    }),
  );
  const result = profileLoop(s.loop, s.renderer, 0.3);
  await vi.runAllTimersAsync();
  await result;
  expect(starts.slice(1).every((t, i) => t - starts[i]! >= 1000 / 60)).toBe(true);
  expect(s.updates.every((dt) => dt <= 0.05)).toBe(true);
});

it('restores an active loop and releases profiling state when drawing throws', async () => {
  const s = setup(
    vi.fn(() => {
      throw new Error('draw failed');
    }),
  );
  s.loop.start();
  const result = profileLoop(s.loop, s.renderer, 1);
  const rejected = expect(result).rejects.toThrow('draw failed');
  await vi.runAllTimersAsync();
  await rejected;
  expect(s.loop.isRunning).toBe(true);
  expect(s.loop.profile).toBeNull();
  expect(s.renderer.passTimes).toBeNull();
  s.loop.stop();
});

it('observes a visible running loop without stepping it a second time', async () => {
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 17),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const s = setup();
  s.loop.start();
  const step = vi.spyOn(s.loop, 'step');
  const result = profileLoop(s.loop, s.renderer, 0.1);
  await vi.advanceTimersByTimeAsync(150);
  const stats = await result;
  expect(stats.manual).toBe(false);
  expect(step.mock.calls.every((args) => args.length === 0)).toBe(true);
  expect(s.loop.isRunning).toBe(true);
  s.loop.stop();
});
