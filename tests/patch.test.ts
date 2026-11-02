import { describe, expect, it } from 'vitest';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { applyPatch, unlockWeapons, type PatchContext } from '@/world/patch';
import { DRAINED, ORIGINAL, coloredRatio, graffiti, type SurfaceInfo } from '@/world/paint/surfaces';
import {
  SaveError,
  cityStates,
  createWorldState,
  deserializeWorld,
  savedProgress,
  serializeWorld,
} from '@/world/state';
import { BRUSH_TIERS } from '@/content/brush-tiers';
import { ENEMIES } from '@/content/enemies';
import { LEVEL_XP, MILESTONES, XP } from '@/content/progression';
import { afterArmor, levelOf, stats } from '@/world/progression';
import { KeyValueStore, MemoryKeyValue } from '@/world/store';
import type { CitySkeleton } from '@/world/city/features';
import type { PigmentSource } from '@/world/wilderness/sources';
import type { WildMonster } from '@/world/wilderness/wild-monsters';
import type { Ruin } from '@/world/wilderness/ruins';

const SURFACES: SurfaceInfo[] = [
  { kind: 'wall', chunk: 0, color: color('cream'), area: 40, x: 10, z: 10 },
  { kind: 'roof', chunk: 0, color: color('red'), area: 400, x: 20, z: 20 },
  { kind: 'door', chunk: 1, color: color('blue'), area: 4, x: 140, z: 10 },
];
const SKEL: CitySkeleton = {
  chunks: 2,
  surfaces: SURFACES,
  stains: [
    { x: 10, z: 10, chunk: 0, size: 1 },
    { x: 20, z: 12, chunk: 1, size: 1 },
  ],
  studios: [
    { building: 0, chunk: 0, door: { x: 5, z: 5 } },
    { building: 1, chunk: 1, door: { x: 30, z: 5 } },
  ],
  homeStudio: 0,
  monsters: [],
  requests: [],
};
const SOURCE: PigmentSource = {
  id: '1,2:0',
  kind: 0,
  x: 0,
  y: 1,
  z: 0,
  color: color('orange'),
  amount: 3,
  ink: 2,
};
const WILD: WildMonster = { id: '3,4:1', type: 0, x: 400, y: 2, z: 520 };
const RUIN: Ruin = { id: 'r1_1', template: 0, x: 600, y: 3, z: 600, color: color('purple'), seed: 1 };
const OLD_RUIN: Ruin = { ...RUIN, id: 'r2_2', color: color('red') };
const ctx: PatchContext = {
  cityOf: (id) => (id === 'c' ? SKEL : null),
  sourceOf: (id) => (id === SOURCE.id ? SOURCE : null),
  wildMonsterOf: (id) => (id === WILD.id ? WILD : null),
  ruinOf: (id) => (id === RUIN.id ? RUIN : id === OLD_RUIN.id ? OLD_RUIN : null),
};
const withSurfaces = (surfaces: SurfaceInfo[]): CitySkeleton => ({ ...SKEL, surfaces });

describe('patches', () => {
  it('restores a drained surface for one generic pigment', () => {
    const s = createWorldState('w', 1);
    const before = s.inventory.generic;
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx)).toEqual({ ok: true });
    expect(cityStates(s, 'c', SKEL).states[0]).toBe(ORIGINAL);
    expect(s.inventory.generic).toBe(before - 1);
  });

  it('charges double for large surfaces and refuses a second restore', () => {
    const s = createWorldState('w', 1);
    const before = s.inventory.generic;
    applyPatch(s, { kind: 'restore', city: 'c', surface: 1 }, ctx);
    expect(s.inventory.generic).toBe(before - 2);
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 1 }, ctx).ok).toBe(false);
    expect(s.inventory.generic).toBe(before - 2);
  });

  it('paints only with unlocked colours the player has pigment for', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'paint', city: 'c', surface: 0, color: color('purple') }, ctx).ok).toBe(
      false,
    );
    expect(applyPatch(s, { kind: 'paint', city: 'c', surface: 0, color: color('grass') }, ctx).ok).toBe(
      false,
    );
    const red = color('red');
    expect(applyPatch(s, { kind: 'paint', city: 'c', surface: 0, color: red }, ctx).ok).toBe(true);
    expect(cityStates(s, 'c', SKEL).states[0]).toBe(graffiti(red));
    expect(s.inventory.colored[red]).toBe(TUNING.brush.startingColored - 1);
  });

  it('fails without spending when pigment runs out', () => {
    const s = createWorldState('w', 1);
    s.inventory.generic = 0;
    const r = applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    expect(r.ok).toBe(false);
    expect(cityStates(s, 'c', SKEL).states[0]).toBe(DRAINED);
  });

  it('drains for free and counts coloured ratio per chunk', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, ctx);
    const states = cityStates(s, 'c', SKEL).states;
    expect(coloredRatio(states, SURFACES)).toBeCloseTo(2 / 3);
    expect(coloredRatio(states, SURFACES, 1)).toBe(1);
    applyPatch(s, { kind: 'drain', city: 'c', surface: 2 }, ctx);
    expect(coloredRatio(states, SURFACES, 1)).toBe(0);
  });

  it('rejects unknown cities and surfaces', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'restore', city: 'nope', surface: 0 }, ctx).ok).toBe(false);
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 99 }, ctx).ok).toBe(false);
  });
});

describe('saves', () => {
  it('round-trips through a store', async () => {
    const store = new KeyValueStore(new MemoryKeyValue());
    const s = createWorldState('w1', 123, '测试');
    applyPatch(s, { kind: 'restore', city: 'c', surface: 1 }, ctx);
    s.player = { scene: { kind: 'city', id: 'c' }, x: 1, y: 2, z: 3, yaw: 0.5 };
    await store.save(s);
    const back = await store.load('w1');
    expect(back).not.toBeNull();
    expect(back!.seed).toBe(123);
    expect([...back!.cities.get('c')!.states]).toEqual([0, ORIGINAL, 0]);
    expect(back!.player).toEqual(s.player);
    expect(back!.inventory).toEqual(s.inventory);
  });

  it('tells a missing save from a corrupt one', async () => {
    const kv = new MemoryKeyValue();
    const store = new KeyValueStore(kv);
    expect(await store.load('none')).toBeNull();
    kv.setItem('inkbloom:world:bad', '{not json');
    await expect(store.load('bad')).rejects.toThrow();
    expect(() =>
      deserializeWorld(serializeWorld(createWorldState('a', 1)).replace('"version":2', '"version":9')),
    ).toThrow();
  });
});

describe('skeleton fingerprints', () => {
  const OTHER: SurfaceInfo[] = [
    ...SURFACES,
    { kind: 'wall', chunk: 2, color: color('cream'), area: 30, x: 300, z: 10 },
  ];
  const REORDERED: SurfaceInfo[] = [SURFACES[1]!, SURFACES[0]!, SURFACES[2]!];

  it('keeps states for the same skeleton', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    const again = cityStates(s, 'c', SKEL);
    expect(again.reset).toBe(false);
    expect(again.states[0]).toBe(ORIGINAL);
  });

  it.each([
    ['a different surface count', OTHER],
    ['the same count in a different order', REORDERED],
  ])('resets instead of throwing for %s', (_, changed) => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    const r = cityStates(s, 'c', withSurfaces(changed));
    expect(r.reset).toBe(true);
    expect([...r.states].every((v) => v === DRAINED)).toBe(true);
    expect(r.states.length).toBe(changed.length);
  });

  it('ignores original colour changes so palette tweaks keep progress', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    const recoloured = SURFACES.map((x) => ({ ...x, color: color('purple') }));
    expect(cityStates(s, 'c', withSurfaces(recoloured)).reset).toBe(false);
  });

  it('migrates v1 saves by adopting a matching surface count', () => {
    const v1 = JSON.stringify({
      version: 1,
      id: 'old',
      seed: 5,
      name: '旧',
      inventory: { generic: 3, colored: [] },
      unlocked: [],
      cities: { c: btoa(String.fromCharCode(0, 1, 0)), d: btoa(String.fromCharCode(1)) },
      player: null,
    });
    const s = deserializeWorld(v1);
    const kept = cityStates(s, 'c', SKEL);
    expect(kept.reset).toBe(false);
    expect([...kept.states]).toEqual([0, ORIGINAL, 0]);
    expect(cityStates(s, 'd', SKEL).reset).toBe(true);
    // re-saved as v2 with the adopted fingerprint
    const back = deserializeWorld(serializeWorld(s));
    expect(back.cities.get('c')!.fingerprint).not.toBeNull();
  });
});

describe('save recovery', () => {
  it('moves a corrupt save aside so a fresh world can be created', async () => {
    const kv = new MemoryKeyValue();
    const store = new KeyValueStore(kv);
    kv.setItem('inkbloom:world:w', '{broken');
    await expect(store.load('w')).rejects.toBeInstanceOf(SaveError);
    const backup = await store.quarantine('w');
    expect(backup).toMatch(/^inkbloom:world:w:corrupt-\d+$/);
    expect(kv.getItem(backup!)).toBe('{broken');
    expect(await store.load('w')).toBeNull();
    expect(await store.quarantine('w')).toBeNull();
  });
});

describe('pigment economy', () => {
  it('soaks up each ink stain once', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'collect', city: 'c', stain: 1 }, ctx).ok).toBe(true);
    expect(s.inventory.ink).toBe(TUNING.economy.inkPerStain);
    expect(applyPatch(s, { kind: 'collect', city: 'c', stain: 1 }, ctx).ok).toBe(false);
    expect(applyPatch(s, { kind: 'collect', city: 'c', stain: 9 }, ctx).ok).toBe(false);
    expect(s.inventory.ink).toBe(TUNING.economy.inkPerStain);
  });

  it('refines ink into generic pigment at an open studio, keeping the remainder', () => {
    const s = createWorldState('w', 1);
    const before = s.inventory.generic;
    s.inventory.ink = 2 * TUNING.economy.inkPerGeneric + 1;
    expect(applyPatch(s, { kind: 'refine', city: 'c', studio: 0 }, ctx).ok).toBe(true);
    expect(s.inventory.generic).toBe(before + 2);
    expect(s.inventory.ink).toBe(1);
    expect(applyPatch(s, { kind: 'refine', city: 'c', studio: 0 }, ctx).ok).toBe(false);
  });

  it('keeps other studios closed until their chunk has colour', () => {
    const s = createWorldState('w', 1);
    s.inventory.ink = 10;
    expect(applyPatch(s, { kind: 'refine', city: 'c', studio: 1 }, ctx)).toEqual({
      ok: false,
      reason: '画室还没开门',
    });
    applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, ctx); // the only chunk-1 surface
    expect(applyPatch(s, { kind: 'refine', city: 'c', studio: 1 }, ctx).ok).toBe(true);
  });

  it('harvests a source, unlocks its colour and waits for regrowth', () => {
    const s = createWorldState('w', 1);
    const orange = color('orange');
    expect(s.unlocked).not.toContain(orange);
    expect(applyPatch(s, { kind: 'harvest', source: SOURCE.id }, ctx).ok).toBe(true);
    expect(s.inventory.colored[orange]).toBe(3);
    expect(s.inventory.ink).toBe(2);
    expect(s.unlocked).toContain(orange);
    expect(applyPatch(s, { kind: 'harvest', source: SOURCE.id }, ctx).ok).toBe(false);
    s.clock += TUNING.economy.regrowSeconds;
    expect(applyPatch(s, { kind: 'harvest', source: SOURCE.id }, ctx).ok).toBe(true);
    expect(applyPatch(s, { kind: 'harvest', source: 'nowhere' }, ctx).ok).toBe(false);
  });

  it('resets stain flags without touching painting progress when stains move', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, ctx);
    applyPatch(s, { kind: 'collect', city: 'c', stain: 0 }, ctx);
    const moved = { ...SKEL, stains: [{ x: 99, z: 99, chunk: 0, size: 1 }] };
    const r = cityStates(s, 'c', moved);
    expect(r.reset).toBe(false);
    expect(r.states[0]).toBe(ORIGINAL);
    expect([...r.stains]).toEqual([0]);
  });

  it('saves ink, clock, cooldowns and stain flags', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'collect', city: 'c', stain: 1 }, ctx);
    applyPatch(s, { kind: 'harvest', source: SOURCE.id }, ctx);
    s.clock = 42;
    const back = deserializeWorld(serializeWorld(s));
    expect(back.inventory.ink).toBe(s.inventory.ink);
    expect(back.clock).toBe(42);
    expect(back.harvested.get(SOURCE.id)).toBe(0);
    expect([...cityStates(back, 'c', SKEL).stains]).toEqual([0, 1]);
  });

  it('drops grown-back cooldowns from the save', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'harvest', source: SOURCE.id }, ctx);
    s.clock = TUNING.economy.regrowSeconds + 1;
    expect(deserializeWorld(serializeWorld(s)).harvested.size).toBe(0);
  });
});

describe('spend', () => {
  it('pays pigment and ink, and refuses when short', () => {
    const s = createWorldState('w', 1);
    s.inventory.ink = 3;
    const g = s.inventory.generic;
    expect(applyPatch(s, { kind: 'spend', generic: 2, ink: 1 }, ctx).ok).toBe(true);
    expect(s.inventory.generic).toBe(g - 2);
    expect(s.inventory.ink).toBe(2);
    expect(applyPatch(s, { kind: 'spend', generic: g }, ctx)).toEqual({ ok: false, reason: '通用颜料不足' });
    expect(applyPatch(s, { kind: 'spend', ink: 5 }, ctx).ok).toBe(false);
    expect(s.inventory.ink).toBe(2);
  });
});

describe('city completion', () => {
  const ONE: CitySkeleton = { ...SKEL, chunks: 1, surfaces: SURFACES.map((x) => ({ ...x, chunk: 0 })) };
  const one: PatchContext = { ...ctx, cityOf: (id) => (id === 'c' ? ONE : null) };

  it('needs every block coloured, pays once, and reads as fully restored', () => {
    const s = createWorldState('w', 1);
    s.inventory.generic = 100;
    expect(applyPatch(s, { kind: 'complete', city: 'c' }, one)).toEqual({
      ok: false,
      reason: '还有街区没有颜色',
    });
    for (let i = 0; i < 3; i++) applyPatch(s, { kind: 'restore', city: 'c', surface: i }, one);
    const before = s.inventory.generic;
    expect(applyPatch(s, { kind: 'complete', city: 'c' }, one).ok).toBe(true);
    expect(s.inventory.generic).toBe(before + TUNING.city.completeReward.generic);
    expect(applyPatch(s, { kind: 'complete', city: 'c' }, one).ok).toBe(false);
    expect(savedProgress(s, 'c')).toBe(1);
    expect(deserializeWorld(serializeWorld(s)).cities.get('c')!.completed).toBe(true);
  });
});

describe('brush upgrades', () => {
  it('buy the next tier, refuse when short, stop at the top', () => {
    const s = createWorldState('w', 1);
    s.inventory.generic = 0;
    expect(applyPatch(s, { kind: 'upgrade', tool: 'brush' }, ctx).ok).toBe(false);
    s.inventory.generic = 1000;
    s.inventory.ink = 1000;
    for (let t = 1; t < BRUSH_TIERS.length; t++) {
      expect(applyPatch(s, { kind: 'upgrade', tool: 'brush' }, ctx).ok).toBe(true);
      expect(s.inventory.brushTier).toBe(t);
    }
    expect(applyPatch(s, { kind: 'upgrade', tool: 'brush' }, ctx)).toEqual({
      ok: false,
      reason: '笔刷已经是最好的了',
    });
    expect(deserializeWorld(serializeWorld(s)).inventory.brushTier).toBe(BRUSH_TIERS.length - 1);
  });
});

describe('combat rules', () => {
  const GUARDED: CitySkeleton = {
    ...SKEL,
    monsters: [
      { type: 0, x: 140, z: 12, chunk: 1 },
      { type: 1, x: 142, z: 14, chunk: 1 },
    ],
  };
  const g: PatchContext = { ...ctx, cityOf: (id) => (id === 'c' ? GUARDED : null) };

  it('refuses painting a block while its stronghold stands, and allows it after', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, g).ok).toBe(true); // block 0 is unguarded
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, g)).toEqual({
      ok: false,
      reason: '这个街区还有墨怪，先赶走它们',
    });
    applyPatch(s, { kind: 'defeat', city: 'c', monster: 0 }, g);
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, g).ok).toBe(false);
    applyPatch(s, { kind: 'defeat', city: 'c', monster: 1 }, g);
    expect(applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, g).ok).toBe(true);
    // a tide can still drain a guarded block
    expect(applyPatch(s, { kind: 'drain', city: 'c', surface: 2 }, g).ok).toBe(true);
  });

  it('pays ink once per defeated monster', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'defeat', city: 'c', monster: 1 }, g).ok).toBe(true);
    expect(s.inventory.ink).toBe(ENEMIES[1]!.ink);
    expect(applyPatch(s, { kind: 'defeat', city: 'c', monster: 1 }, g).ok).toBe(false);
    expect(applyPatch(s, { kind: 'defeat', city: 'c', monster: 7 }, g).ok).toBe(false);
    expect(s.inventory.ink).toBe(ENEMIES[1]!.ink);
  });

  it('drops a share of ink on death and gives it back once', () => {
    const s = createWorldState('w', 1);
    s.inventory.ink = 41;
    applyPatch(s, { kind: 'death', scene: { kind: 'city', id: 'c' }, x: 1, y: 0, z: 2 }, ctx);
    const lost = Math.floor(41 * TUNING.combat.deathInkShare);
    expect(s.inventory.ink).toBe(41 - lost);
    expect(s.drop).toMatchObject({ x: 1, z: 2, ink: lost });
    const back = deserializeWorld(serializeWorld(s));
    expect(back.drop).toEqual(s.drop);
    expect(applyPatch(s, { kind: 'recover' }, ctx).ok).toBe(true);
    expect(s.inventory.ink).toBe(41);
    expect(applyPatch(s, { kind: 'recover' }, ctx).ok).toBe(false);
  });

  it('dying again replaces the old drop', () => {
    const s = createWorldState('w', 1);
    s.inventory.ink = 20;
    applyPatch(s, { kind: 'death', scene: { kind: 'wild' }, x: 0, y: 0, z: 0 }, ctx);
    applyPatch(s, { kind: 'death', scene: { kind: 'wild' }, x: 5, y: 0, z: 5 }, ctx);
    expect(s.drop).toMatchObject({ x: 5, z: 5, ink: 5 });
    expect(s.inventory.ink).toBe(5);
  });

  it('resets defeat flags without touching painting when strongholds move', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, g);
    applyPatch(s, { kind: 'defeat', city: 'c', monster: 0 }, g);
    const moved = { ...GUARDED, monsters: [{ type: 0, x: 1, z: 1, chunk: 0 }] };
    const r = cityStates(s, 'c', moved);
    expect(r.reset).toBe(false);
    expect(r.states[0]).toBe(ORIGINAL);
    expect([...r.defeated]).toEqual([0]);
  });
});

describe('wilderness hunting', () => {
  it('pays ink once, then the monster comes back after the respawn time', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'hunt', monster: WILD.id }, ctx).ok).toBe(true);
    expect(s.inventory.ink).toBe(ENEMIES[0]!.ink);
    expect(applyPatch(s, { kind: 'hunt', monster: WILD.id }, ctx).ok).toBe(false);
    s.clock += TUNING.combat.wildRespawnSeconds;
    expect(applyPatch(s, { kind: 'hunt', monster: WILD.id }, ctx).ok).toBe(true);
    expect(applyPatch(s, { kind: 'hunt', monster: 'nowhere' }, ctx).ok).toBe(false);
  });

  it('keeps fresh kills in the save and drops ones that came back', () => {
    const s = createWorldState('w', 1);
    applyPatch(s, { kind: 'hunt', monster: WILD.id }, ctx);
    expect(deserializeWorld(serializeWorld(s)).hunted.get(WILD.id)).toBe(0);
    s.clock = TUNING.combat.wildRespawnSeconds + 1;
    expect(deserializeWorld(serializeWorld(s)).hunted.size).toBe(0);
  });
});

describe('growth', () => {
  const ONE: CitySkeleton = { ...SKEL, chunks: 1, surfaces: SURFACES.map((x) => ({ ...x, chunk: 0 })) };
  const one: PatchContext = { ...ctx, cityOf: (id) => (id === 'c' ? ONE : null) };

  it('levels follow the experience table', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(LEVEL_XP[1]! - 1)).toBe(1);
    expect(levelOf(LEVEL_XP[1]!)).toBe(2);
    expect(levelOf(1e9)).toBe(LEVEL_XP.length);
  });

  it('pays experience for newly coloured surfaces only, and the block milestones once', () => {
    const s = createWorldState('w', 1);
    s.inventory.generic = 100;
    applyPatch(s, { kind: 'restore', city: 'c', surface: 0 }, one);
    expect(s.growth.xp).toBe(XP.surface);
    applyPatch(s, { kind: 'paint', city: 'c', surface: 0, color: color('red') }, one); // already coloured
    expect(s.growth.xp).toBe(XP.surface);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 1 }, one);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, one); // block 0 reaches 有色
    expect(s.growth.xp).toBe(3 * XP.surface + XP.blockColored);
    expect(s.growth.points).toBe(MILESTONES.firstBlockColored);
    applyPatch(s, { kind: 'drain', city: 'c', surface: 2 }, one);
    applyPatch(s, { kind: 'restore', city: 'c', surface: 2 }, one); // back to 有色: no second payout
    expect(s.growth.points).toBe(MILESTONES.firstBlockColored);
    expect(s.growth.xp).toBe(4 * XP.surface + XP.blockColored);
  });

  it('pays the city, tide and monster rewards', () => {
    const s = createWorldState('w', 1);
    s.inventory.generic = 100;
    for (let i = 0; i < 3; i++) applyPatch(s, { kind: 'restore', city: 'c', surface: i }, one);
    const before = s.growth.points;
    applyPatch(s, { kind: 'complete', city: 'c' }, one);
    expect(s.growth.points).toBe(before + MILESTONES.cityRestored);
    applyPatch(s, { kind: 'tideHeld', city: 'c' }, one);
    applyPatch(s, { kind: 'tideHeld', city: 'c' }, one);
    expect(s.growth.points).toBe(before + MILESTONES.cityRestored + MILESTONES.firstTideHeld);
    const xp = s.growth.xp;
    applyPatch(s, { kind: 'hunt', monster: WILD.id }, ctx);
    expect(s.growth.xp).toBe(xp + XP.monster);
  });

  it('spends points on attributes that change stats, with armour reducing damage', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'assign', attr: 'health' }, ctx).ok).toBe(false);
    s.growth.points = 2;
    const base = stats(s.growth);
    applyPatch(s, { kind: 'assign', attr: 'health' }, ctx);
    applyPatch(s, { kind: 'assign', attr: 'armor' }, ctx);
    const after = stats(s.growth);
    expect(after.maxHp).toBeGreaterThan(base.maxHp);
    expect(afterArmor(100, after)).toBeLessThan(100);
    expect(afterArmor(100, base)).toBe(100);
    expect(s.growth.points).toBe(0);
    expect(deserializeWorld(serializeWorld(s)).growth).toEqual(s.growth);
  });
});

describe('ruins', () => {
  it('unlock their colour once, or give pigment when the colour is known', () => {
    const s = createWorldState('w', 1);
    expect(s.unlocked).not.toContain(RUIN.color);
    expect(applyPatch(s, { kind: 'discover', ruin: RUIN.id }, ctx).ok).toBe(true);
    expect(s.unlocked).toContain(RUIN.color);
    expect(s.growth.xp).toBe(XP.ruinFound);
    expect(applyPatch(s, { kind: 'discover', ruin: RUIN.id }, ctx).ok).toBe(false);
    const red = s.inventory.colored[OLD_RUIN.color]!;
    applyPatch(s, { kind: 'discover', ruin: OLD_RUIN.id }, ctx);
    expect(s.inventory.colored[OLD_RUIN.color]).toBe(red + TUNING.structures.ruinPigment);
    expect(deserializeWorld(serializeWorld(s)).discovered).toEqual([RUIN.id, OLD_RUIN.id]);
  });
});

describe('resident requests and thriving', () => {
  const walls = { px: 0, nx: 1, pz: 3, nz: 4 };
  const WALLED: SurfaceInfo[] = [0, 1, 2, 3, 4].map((i) => ({
    kind: 'wall',
    chunk: 0,
    color: color('cream'),
    area: 10,
    x: i,
    z: 0,
  }));
  const R: CitySkeleton = {
    ...SKEL,
    chunks: 1,
    surfaces: WALLED,
    requests: [
      {
        building: 0,
        chunk: 0,
        kind: 'recolor',
        color: color('red'),
        count: 0,
        resident: '老陈',
        line: '',
        door: { x: 0, z: 0 },
        walls,
      },
      {
        building: 1,
        chunk: 0,
        kind: 'fetch',
        color: color('blue'),
        count: 4,
        resident: '阿梅',
        line: '',
        door: { x: 0, z: 0 },
        walls,
      },
    ],
  };
  const rc: PatchContext = { ...ctx, cityOf: (id) => (id === 'c' ? R : null) };

  it('checks the wish before accepting it', () => {
    const s = createWorldState('w', 1);
    expect(applyPatch(s, { kind: 'request', city: 'c', request: 0 }, rc).ok).toBe(false);
    for (const i of [0, 1, 3, 4])
      applyPatch(s, { kind: 'paint', city: 'c', surface: i, color: color('red') }, rc);
    expect(applyPatch(s, { kind: 'request', city: 'c', request: 0 }, rc).ok).toBe(true);
    expect(applyPatch(s, { kind: 'request', city: 'c', request: 0 }, rc).ok).toBe(false);
    s.inventory.colored[color('blue')] = 3;
    expect(applyPatch(s, { kind: 'request', city: 'c', request: 1 }, rc).ok).toBe(false);
    s.inventory.colored[color('blue')] = 5;
    expect(applyPatch(s, { kind: 'request', city: 'c', request: 1 }, rc).ok).toBe(true);
    expect(s.inventory.colored[color('blue')]).toBe(1);
  });

  it('turns a coloured block with all wishes done into a producing studio', () => {
    const s = createWorldState('w', 1);
    s.inventory.colored[color('blue')] = 10;
    for (const i of [0, 1, 3, 4])
      applyPatch(s, { kind: 'paint', city: 'c', surface: i, color: color('red') }, rc);
    expect(applyPatch(s, { kind: 'collectStock', city: 'c', studio: 0 }, rc).ok).toBe(false); // not thriving
    applyPatch(s, { kind: 'request', city: 'c', request: 0 }, rc);
    applyPatch(s, { kind: 'request', city: 'c', request: 1 }, rc);
    const saved = s.cities.get('c')!;
    expect(saved.stockFrom[0]).toBe(s.clock);
    s.clock += TUNING.economy.studioStockSeconds * 2.5;
    const g = s.inventory.generic;
    expect(applyPatch(s, { kind: 'collectStock', city: 'c', studio: 0 }, rc).ok).toBe(true);
    expect(s.inventory.generic).toBe(g + 2);
    expect(applyPatch(s, { kind: 'collectStock', city: 'c', studio: 0 }, rc).ok).toBe(false); // half a period left
    s.clock += TUNING.economy.studioStockSeconds * 100;
    applyPatch(s, { kind: 'collectStock', city: 'c', studio: 0 }, rc);
    expect(s.inventory.generic).toBe(g + 2 + TUNING.economy.studioStockCap);
    const back = deserializeWorld(serializeWorld(s)).cities.get('c')!;
    expect([...back.requestsDone]).toEqual([1, 1]);
    expect(back.stockFrom).toEqual(saved.stockFrom);
  });
});

describe('ink marks and the paper plane', () => {
  it('costs pigment, caps at the limit, and can be pulled back', () => {
    const s = createWorldState('w', 1);
    s.inventory.generic = 100;
    for (let i = 0; i < TUNING.marks.max; i++)
      expect(applyPatch(s, { kind: 'mark', x: i, y: 0, z: 0 }, ctx).ok).toBe(true);
    expect(applyPatch(s, { kind: 'mark', x: 9, y: 0, z: 0 }, ctx).ok).toBe(false);
    expect(s.inventory.generic).toBe(100 - TUNING.marks.max * TUNING.marks.cost);
    const id = s.marks[0]!.id;
    expect(applyPatch(s, { kind: 'unmark', id }, ctx).ok).toBe(true);
    expect(applyPatch(s, { kind: 'mark', x: 9, y: 0, z: 0 }, ctx).ok).toBe(true);
    expect(new Set(s.marks.map((m) => m.id)).size).toBe(TUNING.marks.max);
    const back = deserializeWorld(serializeWorld(s));
    expect(back.marks).toEqual(s.marks);
    expect(back.nextMark).toBe(s.nextMark);
  });

  it('grants the paper plane with the first restored city', () => {
    const ONE: CitySkeleton = { ...SKEL, chunks: 1, surfaces: SURFACES.map((x) => ({ ...x, chunk: 0 })) };
    const one: PatchContext = { ...ctx, cityOf: (id) => (id === 'c' ? ONE : null) };
    const s = createWorldState('w', 1);
    s.inventory.generic = 100;
    for (let i = 0; i < 3; i++) applyPatch(s, { kind: 'restore', city: 'c', surface: i }, one);
    expect(s.inventory.glider).toBe(false);
    applyPatch(s, { kind: 'complete', city: 'c' }, one);
    expect(s.inventory.glider).toBe(true);
    expect(deserializeWorld(serializeWorld(s)).inventory.glider).toBe(true);
  });
});

describe('weapon unlocks', () => {
  it('start with the rifle and unlock the rest by growth', () => {
    const s = createWorldState('w', 1);
    expect(s.inventory.weapons).toEqual(['rifle']);
    s.growth.milestones.push('first-block');
    expect(unlockWeapons(s)).toEqual(['katana']);
    s.growth.xp = LEVEL_XP[2]!; // level 3
    s.growth.milestones.push('first-tide');
    expect(unlockWeapons(s).sort()).toEqual(['launcher', 'sniper']);
    cityStates(s, 'x', SKEL); // a city entered but not restored
    expect(unlockWeapons(s)).toEqual([]);
    s.cities.get('x')!.completed = true;
    expect(unlockWeapons(s)).toEqual(['staff']);
    expect(unlockWeapons(s)).toEqual([]);
    expect(deserializeWorld(serializeWorld(s)).inventory.weapons).toEqual(s.inventory.weapons);
  });
});
