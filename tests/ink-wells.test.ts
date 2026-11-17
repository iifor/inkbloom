import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { applyPatch } from '@/world/patch';
import { layoutCache, worldPatchContext } from '@/world/net/patch-context';
import { placeOf, validPatch } from '@/world/net/validate';
import { applyFix } from '@/world/net/fix';
import { createWorldState, deserializeWorld, serializeWorld } from '@/world/state';
import { saturationAt } from '@/world/wilderness/drain';
import { createWilderness } from '@/world/wilderness/generator';
import {
  inkWellById,
  inkWellInChunk,
  inkWellsNear,
  wellGuards,
  wellOfGuard,
} from '@/world/wilderness/ink-wells';
import { chunkSaturation, wildMonsterById, wildMonstersInChunk } from '@/world/wilderness/wild-monsters';

const w = createWilderness(4242);
const wells = inkWellsNear(w, 0, 0, 2500);
const grey = (): number => 0;
const ctx = worldPatchContext(w, layoutCache(w), grey);
const well = wells.find((x) => chunkSaturation(w, x.cx, x.cz, grey) < TUNING.combat.wild.greyBelow)!;

describe('ink wells', () => {
  it('seep in the grey ring round towns, the same for everyone', () => {
    expect(wells.length).toBeGreaterThan(3);
    for (const x of wells) {
      expect(w.townAt(x.x, x.z, 25)).toBeNull();
      expect(inkWellById(w, x.id)).toEqual(x);
    }
    expect(inkWellInChunk(createWilderness(4242), well.cx, well.cz)).toEqual(well);
    expect(inkWellById(w, 'w9999_9999')).toBeNull();
  });

  it('are guarded while they seep, and the guards are the chunk’s own monsters', () => {
    const guards = wellGuards(w, well, 0);
    expect(guards.length).toBeGreaterThanOrEqual(2);
    const chunk = wildMonstersInChunk(w, well.cx, well.cz, 0);
    for (const g of guards) {
      expect(chunk).toContainEqual(g);
      expect(wellOfGuard(g.id)).toBe(well.id);
      expect(wildMonsterById(w, g.id, 0)).toEqual(g);
      expect(Math.hypot(g.x - well.x, g.z - well.z)).toBeLessThan(10);
    }
    // a cleansed well, or one in coloured land, has none
    expect(wellGuards(w, well, 0, true)).toEqual([]);
    expect(wellGuards(w, well, 1)).toEqual([]);
    expect(wildMonstersInChunk(w, well.cx, well.cz, 0, true).some((m) => wellOfGuard(m.id))).toBe(false);
  });
});

describe('cleansing a well', () => {
  it('waits for its guards, then pays once and stops them coming back', () => {
    const state = createWorldState('t', w.seed);
    const blocked = applyPatch(state, { kind: 'cleanse', well: well.id }, ctx);
    expect(blocked.ok).toBe(false);
    const guards = wellGuards(w, well, chunkSaturation(w, well.cx, well.cz, grey));
    for (const g of guards) expect(applyPatch(state, { kind: 'hunt', monster: g.id }, ctx).ok).toBe(true);
    const ink = state.inventory.ink;
    const xp = state.growth.xp;
    expect(applyPatch(state, { kind: 'cleanse', well: well.id }, ctx)).toEqual({ ok: true });
    expect(state.inventory.ink).toBe(ink + TUNING.combat.wells.ink);
    expect(state.growth.xp).toBeGreaterThan(xp);
    expect(state.cleansed.has(well.id)).toBe(true);
    expect(applyPatch(state, { kind: 'cleanse', well: well.id }, ctx).ok).toBe(false);
    // long after, the guards would be back: not at a cleansed well
    state.clock += TUNING.combat.wildRespawnSeconds + 1;
    expect(applyPatch(state, { kind: 'hunt', monster: guards[0]!.id }, ctx).ok).toBe(false);
  });

  it('cannot happen to a well that has dried up, or one that is not there', () => {
    const restored = worldPatchContext(w, layoutCache(w), () => 1);
    const state = createWorldState('t', w.seed);
    expect(applyPatch(state, { kind: 'cleanse', well: well.id }, restored).ok).toBe(false);
    expect(applyPatch(state, { kind: 'cleanse', well: 'w9999_9999' }, ctx).ok).toBe(false);
  });

  it('is checked from the network and placed at its chunk', () => {
    expect(validPatch({ kind: 'cleanse', well: well.id })).toEqual({ kind: 'cleanse', well: well.id });
    expect(validPatch({ kind: 'cleanse', well: 'constructor' })).toBeNull();
    expect(validPatch({ kind: 'cleanse', well: 7 })).toBeNull();
    const at = placeOf({ kind: 'cleanse', well: well.id })!;
    expect(Math.hypot(at.x - well.x, at.z - well.z)).toBeLessThan(TUNING.world.chunkSize);
  });

  it('is kept in the save and set by the server’s fix', () => {
    const state = createWorldState('t', w.seed);
    state.cleansed.set(well.id, 123);
    expect(deserializeWorld(serializeWorld(state)).cleansed.get(well.id)).toBe(123);
    const other = createWorldState('t', w.seed);
    applyFix(other, { cleansed: [[well.id, 456]] });
    expect(other.cleansed.get(well.id)).toBe(456);
    // the server refused it: put back (and so with a refused kill)
    applyFix(other, { cleansed: [[well.id, null]] });
    expect(other.cleansed.has(well.id)).toBe(false);
    other.hunted.set('1,2:50', 9);
    applyFix(other, { hunted: [['1,2:50', null]] });
    expect(other.hunted.has('1,2:50')).toBe(false);
  });

  it('brings the colour back round the well', () => {
    const town = [{ x: well.x, z: well.z, half: 10, progress: 0 }];
    const r = TUNING.combat.wells.bloom;
    expect(saturationAt(well.x, well.z, town)).toBe(0);
    expect(saturationAt(well.x + 3, well.z, town, [{ x: well.x, z: well.z, r }])).toBe(1);
    expect(saturationAt(well.x + r + 1, well.z, town, [{ x: well.x, z: well.z, r }])).toBe(0);
  });
});
