import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PassTimer } from '@/engine/render/pass-timer';

function setup() {
  let ready = false;
  let disjoint = false;
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }),
    createQuery: vi.fn((): WebGLQuery | null => ({})),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    deleteQuery: vi.fn(),
    getParameter: vi.fn(() => disjoint),
    getQueryParameter: vi.fn((_q: WebGLQuery, key: number) => (key === 1 ? ready : 2e6)),
  };
  const renderer = { getContext: () => gl } as unknown as THREE.WebGLRenderer;
  const timer = new PassTimer();
  timer.times = new Map();
  const frame = () => {
    timer.pass(renderer, 'scene');
    timer.pass(renderer, 'post');
    timer.pass(renderer, null);
  };
  return { timer, gl, renderer, frame, ready: () => (ready = true), disjoint: () => (disjoint = true) };
}

describe('GPU pass profiling', () => {
  it('bounds outstanding queries while the GPU is busy and resumes when results arrive', () => {
    const s = setup();
    for (let i = 0; i < 100; i++) s.frame();
    expect(s.gl.createQuery).toHaveBeenCalledTimes(8);
    expect(s.timer.frames).toBe(0);
    s.ready();
    s.frame();
    expect(s.timer.frames).toBe(4);
    expect(Object.fromEntries(s.timer.times!)).toEqual({ scene: 8, post: 8 });
    expect(s.gl.createQuery).toHaveBeenCalledTimes(10);
  });

  it('collects complete frames once, then releases queries when profiling stops', () => {
    const s = setup();
    s.frame();
    s.ready();
    const totals = s.timer.times!;
    s.timer.times = null;
    expect(s.timer.frames).toBe(1);
    expect(Object.fromEntries(totals)).toEqual({ scene: 2, post: 2 });
    expect(s.gl.getParameter).toHaveBeenCalledTimes(1);
    expect(s.gl.deleteQuery).toHaveBeenCalledTimes(2);
    s.frame();
    expect(s.gl.createQuery).toHaveBeenCalledTimes(2);
  });

  it('does not add a previous session or interrupted frame to a new session', () => {
    const s = setup();
    s.frame();
    s.timer.pass(s.renderer, 'scene');
    const previous = s.timer.times!;
    s.timer.times = new Map();
    expect(s.gl.deleteQuery).toHaveBeenCalledTimes(3);
    s.ready();
    s.frame();
    s.timer.times = null;
    expect(previous.size).toBe(0);
    expect(s.timer.frames).toBe(1);
    expect(s.gl.deleteQuery).toHaveBeenCalledTimes(5);
  });

  it('discards invalid disjoint results without contributing to the average', () => {
    const s = setup();
    s.frame();
    s.ready();
    s.disjoint();
    s.frame();
    expect(s.timer.frames).toBe(0);
    expect(s.timer.times!.size).toBe(0);
    expect(s.gl.getQueryParameter).not.toHaveBeenCalled();
    s.timer.dispose();
    expect(s.gl.deleteQuery).toHaveBeenCalledTimes(4);
  });

  it('drops an incomplete sample when query allocation fails', () => {
    const s = setup();
    s.gl.createQuery.mockReturnValueOnce({}).mockReturnValueOnce(null);
    s.frame();
    s.ready();
    s.frame();
    s.timer.times = null;
    expect(s.timer.frames).toBe(1);
    expect(s.gl.deleteQuery).toHaveBeenCalledTimes(3);
  });
});
