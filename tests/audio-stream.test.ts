import { afterEach, expect, it, vi } from 'vitest';
import { Synth } from '@/engine/audio/synth';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const elements: FakeAudio[] = [];
  class FakeAudio extends EventTarget {
    duration = 120;
    currentTime = 0;
    loop = false;
    preload = '';
    play = vi.fn(async () => {});
    pause = vi.fn();
    load = vi.fn();
    removeAttribute = vi.fn();
    constructor(public src: string) {
      super();
      elements.push(this);
    }
  }
  vi.stubGlobal('Audio', FakeAudio);
  const gain = {
    gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    currentTime: 0,
    createGain: () => gain,
    createMediaElementSource: () => source,
    close: vi.fn(async () => {}),
  };
  const synth = new Synth();
  synth.ctx = ctx as unknown as AudioContext;
  const stream = synth.stream('test.mp3', { loop: false, gain: 0.55, bus: 'music' });
  return { synth, stream, el: elements[0]!, gain, source, ctx };
}

it('reports buffering and remaining duration, and releases a finished stream', () => {
  const h = fixture();
  expect(h.stream.playing).toBe(false);
  h.el.dispatchEvent(new Event('playing'));
  expect(h.stream.playing).toBe(true);
  h.el.currentTime = 117;
  expect(h.stream.remaining).toBe(3);
  h.el.dispatchEvent(new Event('waiting'));
  expect(h.stream.playing).toBe(false);
  h.el.dispatchEvent(new Event('playing'));
  expect(h.stream.playing).toBe(true);
  h.el.currentTime = 120;
  h.el.dispatchEvent(new Event('ended'));
  expect(h.stream.over).toBe(true);
  expect(h.stream.remaining).toBe(0);
  expect(h.el.removeAttribute).toHaveBeenCalledWith('src');
  expect(h.source.disconnect).toHaveBeenCalledOnce();
});

it('fades before release, but game disposal also stops fading streams immediately', async () => {
  const h = fixture();
  h.el.dispatchEvent(new Event('playing'));
  h.stream.stop(4);
  expect(h.stream.over).toBe(true);
  expect(h.el.pause).not.toHaveBeenCalled();
  const calls = h.gain.gain.setTargetAtTime.mock.calls.length;
  h.stream.set(1);
  expect(h.gain.gain.setTargetAtTime).toHaveBeenCalledTimes(calls);
  vi.advanceTimersByTime(1000);
  await h.synth.dispose();
  expect(h.el.pause).toHaveBeenCalledOnce();
  expect(h.ctx.close).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(5000);
  expect(h.el.pause).toHaveBeenCalledOnce();
});

it('cleans up decode failures and never reports them as playing again', () => {
  const h = fixture();
  h.el.duration = NaN;
  h.el.dispatchEvent(new Event('error'));
  expect(h.stream.over).toBe(true);
  expect(h.stream.remaining).toBe(Infinity);
  h.el.dispatchEvent(new Event('playing'));
  expect(h.stream.playing).toBe(false);
  h.stream.stop(0);
  expect(h.el.pause).toHaveBeenCalledOnce();
});
