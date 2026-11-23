import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from '@/engine/input/input';

function start() {
  const browser = new EventTarget();
  const canvas = new EventTarget();
  let focused = true;
  const page = Object.assign(new EventTarget(), {
    pointerLockElement: canvas as EventTarget | null,
    hidden: false,
    hasFocus: () => focused,
    exitPointerLock: () => unlock(),
  });

  function unlock() {
    page.pointerLockElement = null;
    page.dispatchEvent(new Event('pointerlockchange'));
  }

  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', page);
  vi.stubGlobal('Element', class {});
  vi.useFakeTimers();
  const input = new Input(canvas as HTMLCanvasElement, new AbortController().signal);
  input.onPause = vi.fn();
  page.dispatchEvent(new Event('pointerlockchange'));
  const key = (code: string) => browser.dispatchEvent(Object.assign(new Event('keydown'), { code }));
  const blur = () => {
    focused = false;
    browser.dispatchEvent(new Event('blur'));
  };
  return { input, key, unlock, blur };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pause and mouse release', () => {
  it('opens the pause menu on Escape', () => {
    const { input, key } = start();
    key('Escape');
    expect(input.onPause).toHaveBeenCalledOnce();
  });

  it('opens the menu when the browser consumes Escape and sends only the unlock event', () => {
    const { input, unlock } = start();
    unlock();
    vi.runAllTimers();
    expect(input.onPause).toHaveBeenCalledOnce();
  });

  it('releases the mouse silently with U and clears held actions', () => {
    const { input, key } = start();
    input.setHeld('forward', true);
    input.update();
    key('KeyU');
    vi.runAllTimers();
    expect(input.pointerLocked).toBe(false);
    expect(input.held('forward')).toBe(false);
    expect(input.onPause).not.toHaveBeenCalled();
  });

  it('does not open a menu when a native unlock is followed by loss of focus', () => {
    const { input, unlock, blur } = start();
    unlock();
    blur();
    vi.runAllTimers();
    expect(input.onPause).not.toHaveBeenCalled();
  });
});
