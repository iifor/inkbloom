import { afterEach, expect, it, vi } from 'vitest';
import { LoadingProgress, loadingFrame, type LoadingTask } from '@/game/loading';
import { StartupScreen } from '@/shell/startup';
import { waitForGpuFrame } from '@/engine/render/frame-ready';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('counts parallel work immediately and never declares readiness before every required task', () => {
  const changed = vi.fn();
  const loading = new LoadingProgress(changed);
  loading.focus('terrain');
  loading.report('textures', 5, 10);
  expect(changed.mock.lastCall?.[0]).toBeCloseTo(0.06);
  loading.report('sounds', 2, 4);
  expect(changed.mock.lastCall?.[0]).toBeCloseTo(0.1);
  for (const key of [
    'world',
    'textures',
    'sounds',
    'terrain',
    'landscape',
    'grass',
    'shaders',
    'frame',
  ] as LoadingTask[])
    loading.report(key, 1);
  expect(loading.ready).toBe(false);
  loading.report('character', 0.9);
  expect(loading.ready).toBe(false);
  loading.report('character', 1);
  expect(loading.ready).toBe(true);
  expect(changed.mock.lastCall?.[0]).toBe(1);
});

it('keeps monotonic progress, rejects invalid work and names the remaining asset', () => {
  const changed = vi.fn();
  const loading = new LoadingProgress(changed);
  loading.waitingFor(['textures', 'character', 'sounds']);
  loading.report('textures', 1);
  expect(changed.mock.lastCall?.[1]).toContain('玩家角色');
  const before = changed.mock.calls.length;
  loading.report('textures', 0);
  loading.report('sounds', NaN);
  loading.report('sounds', 1, 0);
  expect(changed).toHaveBeenCalledTimes(before);
  loading.report('character', 1);
  expect(changed.mock.lastCall?.[1]).toContain('音效');
});

function screenFixture(reduced = false) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let serial = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  const nodes: Record<string, { textContent: string; value: number }> = {};
  for (const id of ['progress', 'percent', 'status', 'message'])
    nodes['#startup-' + id] = { textContent: '', value: 0 };
  const root = {
    hidden: false,
    inert: false,
    dataset: {} as Record<string, string>,
    style: { setProperty: vi.fn() },
    classList: { add: vi.fn() },
    setAttribute: vi.fn(),
    querySelector: (key: string) => nodes[key],
  };
  const screen = new StartupScreen(root as unknown as HTMLElement);
  const frame = (ms = 16) => {
    vi.advanceTimersByTime(ms);
    const queued = [...frames.values()];
    frames.clear();
    for (const callback of queued) callback(performance.now());
  };
  return { screen, root, nodes, frame, frames };
}

it('smooths large jumps without getting ahead of completed work or reaching 100 early', () => {
  const h = screenFixture();
  h.screen.update(0.8, 'work');
  h.frame();
  expect(h.nodes['#startup-progress']!.value).toBeGreaterThan(0);
  expect(h.nodes['#startup-progress']!.value).toBeLessThan(80);
  let previous = 0;
  for (let i = 0; i < 80; i++) {
    h.frame();
    const value = h.nodes['#startup-progress']!.value;
    expect(value).toBeGreaterThanOrEqual(previous);
    expect(value).toBeLessThanOrEqual(80);
    previous = value;
  }
  expect(h.nodes['#startup-percent']!.textContent).toBe('80%');
  h.screen.update(1, 'frame still pending');
  for (let i = 0; i < 80; i++) h.frame();
  expect(h.nodes['#startup-percent']!.textContent).toBe('99%');
  expect(h.root.hidden).toBe(false);
  h.screen.hide();
});

it('shows 100 before fading and resolves only after the overlay is hidden', async () => {
  const h = screenFixture();
  h.screen.update(0.8, 'work');
  h.frame();
  let finished = false;
  const completion = h.screen.finish().then(() => {
    finished = true;
  });
  h.frame(90);
  expect(h.root.hidden).toBe(false);
  expect(h.root.classList.add).not.toHaveBeenCalled();
  h.frame(90);
  expect(h.nodes['#startup-percent']!.textContent).toBe('100%');
  expect(h.root.classList.add).toHaveBeenCalledWith('is-leaving');
  expect(finished).toBe(false);
  vi.advanceTimersByTime(180);
  await completion;
  expect(h.root.hidden).toBe(true);
  expect(h.frames.size).toBe(0);
});

it('finishes with suspended animation frames and supports reduced motion', async () => {
  const h = screenFixture();
  const completion = h.screen.finish();
  vi.advanceTimersByTime(420);
  await completion;
  expect(h.root.hidden).toBe(true);
  expect(h.frames.size).toBe(0);
  const reduced = screenFixture(true);
  reduced.screen.update(0.7, 'work');
  expect(reduced.nodes['#startup-percent']!.textContent).toBe('70%');
  expect(reduced.frames.size).toBe(0);
  await reduced.screen.finish();
  expect(reduced.root.hidden).toBe(true);
});

it('keeps displayed progress near completed work when an occluded window throttles RAF', () => {
  const h = screenFixture();
  h.screen.update(0.8, 'work');
  vi.advanceTimersByTime(1000);
  expect(h.nodes['#startup-progress']!.value).toBeGreaterThan(79);
  expect(h.nodes['#startup-progress']!.value).toBeLessThanOrEqual(80);
  expect(h.root.hidden).toBe(false);
  h.screen.hide();
  expect(h.frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('continues loading a background tab without leaking its pending frame callback', async () => {
  const h = screenFixture();
  const yielded = loadingFrame();
  expect(h.frames.size).toBe(1);
  vi.advanceTimersByTime(50);
  await yielded;
  expect(h.frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

function gpu(states: number[]) {
  return {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    ALREADY_SIGNALED: 2,
    CONDITION_SATISFIED: 3,
    WAIT_FAILED: 4,
    TIMEOUT_EXPIRED: 5,
    fenceSync: vi.fn(() => ({})),
    flush: vi.fn(),
    deleteSync: vi.fn(),
    isContextLost: () => false,
    clientWaitSync: vi.fn(() => states.shift() ?? 5),
  };
}
it('waits for the submitted GPU frame instead of treating a render call as complete', async () => {
  const gl = gpu([5, 5, 3]);
  const yieldFrame = vi.fn(async () => {});
  await waitForGpuFrame(gl as unknown as WebGL2RenderingContext, yieldFrame);
  expect(yieldFrame).toHaveBeenCalledTimes(2);
  expect(gl.deleteSync).toHaveBeenCalledOnce();
});
it('fails a broken or stuck first frame and always deletes the fence', async () => {
  const gl = gpu([4]);
  await expect(waitForGpuFrame(gl as unknown as WebGL2RenderingContext, async () => {})).rejects.toThrow(
    '显卡',
  );
  expect(gl.deleteSync).toHaveBeenCalledOnce();
  vi.useFakeTimers({ toFake: ['performance'] });
  const stuck = gpu([]);
  await expect(
    waitForGpuFrame(stuck as unknown as WebGL2RenderingContext, async () => {
      vi.advanceTimersByTime(16000);
    }),
  ).rejects.toThrow('超时');
  expect(stuck.deleteSync).toHaveBeenCalledOnce();
});
