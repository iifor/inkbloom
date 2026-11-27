import { afterEach, expect, it, vi } from 'vitest';
import { StartupMusic } from '@/shell/startup-music';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(options: { volume?: number; music?: number; blocked?: boolean; pending?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  const window = new EventTarget();
  vi.stubGlobal('window', window);
  const elements: FakeAudio[] = [];
  let resolvePlay: () => void = () => {};
  let blocked = options.blocked ?? false;
  class FakeAudio {
    volume = 1;
    paused = true;
    loop = false;
    preload = '';
    onerror: (() => void) | null = null;
    pause = vi.fn(() => {
      this.paused = true;
    });
    load = vi.fn();
    removeAttribute = vi.fn();
    play = vi.fn(async () => {
      if (blocked) throw new Error('NotAllowedError');
      if (options.pending)
        await new Promise<void>((resolve) => {
          resolvePlay = resolve;
        });
      this.paused = false;
    });
    constructor(public src: string) {
      elements.push(this);
    }
  }
  vi.stubGlobal('Audio', FakeAudio);
  const button = {
    hidden: true,
    textContent: '',
    onclick: null as (() => void) | null,
    setAttribute: vi.fn(),
  };
  const music = new StartupMusic(button as unknown as HTMLButtonElement, {
    volume: options.volume ?? 0.8,
    music: options.music ?? 0.6,
  });
  return {
    music,
    button,
    elements,
    window,
    allow: () => {
      blocked = false;
    },
    resolve: () => resolvePlay(),
  };
}

it('loops the supplied loading track using saved master and music volume', async () => {
  const h = fixture();
  await Promise.resolve();
  const audio = h.elements[0]!;
  expect(audio.src).toMatch(/sounds\/music\/inkbloom-loading\.mp3$/);
  expect(audio.loop).toBe(true);
  expect(audio.volume).toBeCloseTo(0.312);
  expect(audio.paused).toBe(false);
  h.button.onclick!();
  expect(audio.paused).toBe(true);
  expect(h.button.textContent).toBe('开启音乐');
  h.music.stop();
});

it('offers a click retry when autoplay is rejected without failing startup', async () => {
  const h = fixture({ blocked: true });
  await Promise.resolve();
  expect(h.button.textContent).toBe('开启音乐');
  h.allow();
  h.button.onclick!();
  await Promise.resolve();
  expect(h.elements[0]!.paused).toBe(false);
  expect(h.button.textContent).toBe('关闭音乐');
  h.music.stop();
});

it.each([{ volume: 0 }, { music: 0 }])('respects saved mute settings: %j', (settings) => {
  const h = fixture(settings);
  expect(h.elements).toHaveLength(0);
  expect(h.button.hidden).toBe(true);
  h.music.stop();
});

it('fades on completion and releases the media even without animation frames', async () => {
  const h = fixture();
  await Promise.resolve();
  const audio = h.elements[0]!;
  h.music.stop(320);
  expect(h.button.hidden).toBe(true);
  vi.advanceTimersByTime(160);
  expect(audio.volume).toBeCloseTo(0.156);
  expect(audio.paused).toBe(false);
  vi.advanceTimersByTime(160);
  expect(audio.paused).toBe(true);
  expect(audio.removeAttribute).toHaveBeenCalledWith('src');
  expect(vi.getTimerCount()).toBe(0);
});

it('cannot resume a pending play request after the loading screen is gone', async () => {
  const h = fixture({ pending: true });
  h.music.stop();
  h.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.elements[0]!.paused).toBe(true);
  expect(h.button.hidden).toBe(true);
  expect(h.button.onclick).toBeNull();
});

it('immediately cancels a fade when navigating away', async () => {
  const h = fixture();
  await Promise.resolve();
  h.music.stop(320);
  h.window.dispatchEvent(new Event('pagehide'));
  expect(h.elements[0]!.paused).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('releases a failed media source without affecting the loading screen', () => {
  const h = fixture();
  h.elements[0]!.onerror!();
  expect(h.elements[0]!.paused).toBe(true);
  expect(h.button.hidden).toBe(true);
});
