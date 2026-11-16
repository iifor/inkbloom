import { describe, expect, it } from 'vitest';
import { color } from '@/content/palette';
import { XP } from '@/content/progression';
import { TUNING } from '@/content/tuning';
import type { CitySkeleton } from '@/world/city/features';
import { applyPatch, type PatchContext } from '@/world/patch';
import { releaseAround } from '@/world/paint/release';
import { DRAINED, ORIGINAL, graffiti, type SurfaceInfo } from '@/world/paint/surfaces';
import { createWorldState } from '@/world/state';

/** A row of walls along x, one per metre-step `gap`, all in block 0. */
function row(n: number, gap: number): SurfaceInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'wall' as const,
    chunk: 0,
    color: color('red'),
    area: 10,
    x: i * gap,
    z: 0,
  }));
}

const walls = { px: 0, nx: 1, pz: 2, nz: 3 };

function skeleton(surfaces: SurfaceInfo[]): CitySkeleton {
  return {
    chunks: 1,
    surfaces,
    stains: [],
    studios: [{ building: 0, chunk: 0, door: { x: 0, z: 0 } }],
    homeStudio: 0,
    monsters: [
      { type: 0, x: 0, z: 0, chunk: 0 },
      { type: 0, x: 500, z: 0, chunk: 0 },
    ],
    requests: [
      {
        building: 9,
        chunk: 0,
        kind: 'fetch',
        color: color('blue'),
        count: 2,
        resident: '阿梅',
        line: '',
        door: { x: 0, z: 0 },
        walls,
      },
    ],
  };
}

const ctxFor = (skel: CitySkeleton): PatchContext => ({
  cityOf: (id) => (id === 'c' ? skel : null),
  sourceOf: () => null,
  wildMonsterOf: () => null,
  ruinOf: () => null,
});

describe('releaseAround', () => {
  it('picks the nearest drained surfaces within the radius, up to the cap', () => {
    const surfaces = row(10, 2);
    const states = new Uint8Array(10);
    states[1] = ORIGINAL;
    expect(releaseAround(surfaces, states, 0, 0, { radius: 7, max: 10 })).toEqual([0, 2, 3]);
    expect(releaseAround(surfaces, states, 0, 0, { radius: 100, max: 2 })).toEqual([0, 2]);
    expect(releaseAround(surfaces, states, 100, 0, { radius: 5, max: 5 })).toEqual([]);
  });
});

describe('colour freed by fighting and wishes', () => {
  const rule = TUNING.release.monster;

  it('a defeated stronghold monster gives back the colour around its post', () => {
    const skel = skeleton(row(rule.max + 6, 1));
    const ctx = ctxFor(skel);
    const s = createWorldState('w', 1);
    const xp = s.growth.xp;
    expect(applyPatch(s, { kind: 'defeat', city: 'c', monster: 0 }, ctx).ok).toBe(true);
    const states = s.cities.get('c')!.states;
    const freed = [...states].filter((v) => v === ORIGINAL).length;
    expect(freed).toBe(Math.min(rule.max, Math.floor(rule.radius) + 1));
    // nearest first: the walls next to the post, not the far end of the street
    expect(states[0]).toBe(ORIGINAL);
    expect(states[skel.surfaces.length - 1]).toBe(DRAINED);
    expect(s.growth.xp - xp).toBeGreaterThanOrEqual(XP.monster + freed * XP.surface);
  });

  it('leaves graffiti alone and frees nothing for a monster far from any wall', () => {
    const skel = skeleton(row(4, 1));
    const ctx = ctxFor(skel);
    const s = createWorldState('w', 1);
    s.inventory.colored[color('blue')] = 50;
    s.unlocked.push(color('blue'));
    expect(applyPatch(s, { kind: 'defeat', city: 'c', monster: 1 }, ctx).ok).toBe(true);
    expect([...s.cities.get('c')!.states]).toEqual([0, 0, 0, 0]);
    // block 0 still has a stronghold monster standing, so set the graffiti by hand
    s.cities.get('c')!.states[0] = graffiti(color('blue'));
    applyPatch(s, { kind: 'defeat', city: 'c', monster: 0 }, ctx);
    expect(s.cities.get('c')!.states[0]).toBe(graffiti(color('blue')));
    expect(s.cities.get('c')!.states[1]).toBe(ORIGINAL);
  });

  it('a granted wish brightens the street around the resident’s door', () => {
    const skel = skeleton(row(40, 1));
    const ctx = ctxFor(skel);
    const s = createWorldState('w', 1);
    s.inventory.colored[color('blue')] = 2;
    expect(applyPatch(s, { kind: 'request', city: 'c', request: 0 }, ctx).ok).toBe(true);
    const freed = [...s.cities.get('c')!.states].filter((v) => v === ORIGINAL).length;
    const r = TUNING.release.request;
    expect(freed).toBe(Math.min(r.max, Math.floor(r.radius) + 1));
  });
});
