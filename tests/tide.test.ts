import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { InkTide } from '@/systems/city/ink-tide';
import { blockBounds, blockStates } from '@/world/city/blocks';
import { generateCity, type CityLayout } from '@/world/city/layout';
import { DRAINED, ORIGINAL, coloredRatio } from '@/world/paint/surfaces';
import { cityStates } from '@/world/state';
import { headless, type Headless } from './support/headless';

const T = TUNING.tide;

/** A 2×2 city with block 0 drained and the rest restored, so a tide can only strike its neighbours. */
function setup(): {
  h: Headless;
  layout: CityLayout;
  states: Uint8Array;
  tide: InkTide;
  spawned: number[];
  knock: (() => void)[];
  cleared: () => number;
} {
  const layout = generateCity('tide', 11, 2);
  const h = headless({ cities: { [layout.id]: layout } });
  const saved = cityStates(h.ctx.state, layout.id, layout);
  const states = saved.states;
  layout.surfaces.forEach((s, i) => (states[i] = s.chunk === 0 ? DRAINED : ORIGINAL));
  const per = layout.size / layout.chunks;
  const spawned: number[] = [];
  const knock: (() => void)[] = [];
  let clears = 0;
  const tide = new InkTide(
    h.ctx,
    layout,
    states,
    {
      blocks: () => blockStates(states, layout.surfaces, layout.chunks),
      spawnTideMonsters: (chunk, _from, onDefeat) => {
        spawned.push(chunk);
        knock.push(onDefeat);
      },
      clearTideMonsters: () => clears++,
      progress: (c) => coloredRatio(states, layout.surfaces, c),
      chunkAt: (p) => {
        const cx = Math.min(1, Math.max(0, Math.floor(p.x / per)));
        const cz = Math.min(1, Math.max(0, Math.floor(p.z / per)));
        return cz * layout.chunks + cx;
      },
    },
    saved.tide,
    new THREE.Group(),
  );
  // stand in block 1 (east of the drained block 0)
  h.place(per * 1.5, 0, per * 0.5);
  return { h, layout, states, tide, spawned, knock, cleared: () => clears };
}

/** Stand a few metres ahead of the moving curtain, facing it. */
function faceCurtain(h: Headless, layout: CityLayout, tide: InkTide): void {
  const s = tide.status();
  if (s?.phase !== 'active') return;
  const b = blockBounds(s.chunk, layout);
  const front = s.front * (layout.size / layout.chunks);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  // the wave travels away from its entry side: 0 east, 1 south, 2 west, 3 north
  const [px, pz, lx, lz] =
    s.from === 0
      ? [b.x1 - front - 4, cz, 1, 0]
      : s.from === 1
        ? [cx, b.z1 - front - 4, 0, 1]
        : s.from === 2
          ? [b.x0 + front + 4, cz, -1, 0]
          : [cx, b.z0 + front + 4, 0, -1];
  h.place(px, 0, pz, new THREE.Vector3(lx, 0, lz));
}

describe('ink tide', () => {
  it('warns, then an undefended wave drains the front of the block and the block is lost', () => {
    const { h, layout, states, tide, spawned, cleared } = setup();
    expect(tide.trigger()).toBe(true);
    const s = tide.status();
    expect(s?.phase).toBe('warning');
    const chunk = s!.chunk;
    expect(chunk).not.toBe(0);
    expect(h.count('tide:warning')).toBe(1);

    h.run(T.warning - 1, (dt) => tide.update(dt));
    expect(spawned).toEqual([]);
    expect(coloredRatio(states, layout.surfaces, chunk)).toBe(1);

    h.run(T.duration + 2, (dt) => tide.update(dt));
    expect(spawned).toEqual([chunk]);
    expect(cleared()).toBe(1);
    expect(tide.status()).toBeNull();
    const left = coloredRatio(states, layout.surfaces, chunk);
    // the wave reaches `reach` of the way in; surfaces deeper than that keep their colour
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(T.holdRatio);
    const end = h.log.find((e) => e.type === 'tide:end');
    expect(end?.payload).toEqual({ held: false });
  });

  it('schedules the next wave within the configured interval', () => {
    const { h, tide } = setup();
    const saved = h.ctx.state.cities.get('tide')!.tide;
    tide.trigger();
    h.run(T.warning + T.duration + 1, (dt) => tide.update(dt));
    expect(saved.wave).toBeNull();
    expect(saved.nextIn).toBeGreaterThanOrEqual(T.intervalMin - 2);
    expect(saved.nextIn).toBeLessThanOrEqual(T.intervalMax);
  });

  it('pushing with generic pigment repels the wave and pays the reward', () => {
    const { h, layout, tide } = setup();
    h.ctx.state.inventory.generic = 100;
    tide.trigger();
    h.run(T.warning + 1, (dt) => tide.update(dt));
    h.held.add('use');
    h.run(T.duration, (dt) => {
      faceCurtain(h, layout, tide);
      tide.update(dt);
    });
    expect(tide.status()).toBeNull();
    expect(h.log.find((e) => e.type === 'tide:end')?.payload).toEqual({ held: true });
    const spent = 100 - h.ctx.state.inventory.generic + T.reward.generic;
    expect(spent).toBeGreaterThan(0);
    expect(h.ctx.state.inventory.ink).toBeGreaterThanOrEqual(T.reward.ink);
  });

  it('cannot push without pigment and says why', () => {
    const { h, layout, tide } = setup();
    h.ctx.state.inventory.generic = 0;
    tide.trigger();
    h.run(T.warning + 20, (dt) => tide.update(dt));
    h.held.add('use');
    let blocked: string | null = null;
    h.run(3, (dt) => {
      faceCurtain(h, layout, tide);
      tide.update(dt);
      const s = tide.status();
      if (s?.phase === 'active' && s.blocked) blocked = s.blocked;
    });
    expect(blocked).toContain('颜料不足');
  });

  it('defeating the wave’s monsters knocks it back and can repel it without pigment', () => {
    const { h, tide, knock } = setup();
    h.ctx.state.inventory.generic = 0;
    tide.trigger();
    h.run(T.warning + 20, (dt) => tide.update(dt));
    const before = tide.status();
    expect(before?.phase).toBe('active');
    knock[0]!();
    const after = tide.status();
    if (before?.phase === 'active' && after?.phase === 'active')
      expect(after.front).toBeLessThan(before.front);
    // enough monsters down and the curtain is back at its edge: held
    for (let i = 0; i < 20; i++) knock[0]!();
    h.run(1, (dt) => tide.update(dt));
    expect(tide.status()).toBeNull();
    expect(h.log.find((e) => e.type === 'tide:end')?.payload).toEqual({ held: true });
  });

  it('resumes a saved wave where it stopped', () => {
    const { h, layout, states, tide } = setup();
    tide.trigger();
    h.run(T.warning + 30, (dt) => tide.update(dt));
    const before = tide.status();
    expect(before?.phase).toBe('active');
    const saved = h.ctx.state.cities.get(layout.id)!.tide;
    const again = new InkTide(
      h.ctx,
      layout,
      states,
      {
        blocks: () => blockStates(states, layout.surfaces, layout.chunks),
        spawnTideMonsters: () => {},
        clearTideMonsters: () => {},
        progress: (c) => coloredRatio(states, layout.surfaces, c),
        chunkAt: () => 1,
      },
      saved,
      new THREE.Group(),
    );
    const after = again.status();
    expect(after?.phase).toBe('active');
    if (before?.phase === 'active' && after?.phase === 'active') {
      expect(after.chunk).toBe(before.chunk);
      expect(after.front).toBeCloseTo(before.front, 5);
      expect(after.seconds).toBeCloseTo(before.seconds, 5);
    }
  });
});
