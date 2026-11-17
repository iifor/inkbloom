import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from '@/engine/render/resolution';

/** Feed frames `ms` apart for `seconds`, starting at `t`; returns the time reached. */
function run(g: ResolutionGovernor, t: number, ms: number, seconds: number): number {
  for (const end = t + seconds * 1000; t < end; t += ms) g.frame(t);
  return t;
}

describe('automatic resolution', () => {
  it('holds full resolution while frames keep up', () => {
    const g = new ResolutionGovernor();
    run(g, 0, 1000 / 60, 20);
    expect(g.scale).toBe(1);
  });

  it('steps down while slow, but never below half', () => {
    const g = new ResolutionGovernor();
    let t = run(g, 0, 30, 2);
    expect(g.scale).toBe(0.9);
    t = run(g, t, 30, 30);
    expect(g.scale).toBe(0.5);
  });

  it('comes back up after a long spell of fast frames', () => {
    const g = new ResolutionGovernor();
    let t = run(g, 0, 30, 4);
    const low = g.scale;
    expect(low).toBeLessThan(1);
    t = run(g, t, 1000 / 60, 9);
    expect(g.scale).toBeCloseTo(low + 0.1);
  });

  it('does not flip back and forth: a level that turns slow right away is capped', () => {
    const g = new ResolutionGovernor();
    let t = run(g, 0, 30, 2); // down to 0.9
    t = run(g, t, 1000 / 60, 9); // up to 1.0
    expect(g.scale).toBe(1);
    t = run(g, t, 30, 2); // slow again at once: down, and 1.0 is now off limits
    expect(g.scale).toBe(0.9);
    t = run(g, t, 1000 / 60, 30);
    expect(g.scale).toBe(0.9);
  });

  it('ignores pauses and one-off hitches', () => {
    const g = new ResolutionGovernor();
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t = run(g, t, 1000 / 60, 0.5);
      t += 400; // a hidden tab or a city being built
    }
    expect(g.scale).toBe(1);
  });

  it('can start below full, climb to full when fast, and fall to half its start when slow', () => {
    const g = new ResolutionGovernor();
    g.reset(0.75);
    expect(g.scale).toBe(0.75);
    let t = run(g, 0, 1000 / 60, 30);
    expect(g.scale).toBe(1);
    g.reset(0.75);
    t = run(g, t, 30, 30);
    expect(g.scale).toBeCloseTo(0.375);
    // and back up from there in tenths
    run(g, t, 1000 / 60, 9);
    expect(g.scale).toBeCloseTo(0.5);
  });
});
