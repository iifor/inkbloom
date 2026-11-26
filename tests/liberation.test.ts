import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyPatch, type Patch } from '@/world/patch';
import { cityStates, deserializeWorld, serializeWorld } from '@/world/state';
import { generateCity } from '@/world/city/layout';
import { travelAltar } from '@/world/city/travel-altar';
import { ALTAR_CAPTURED, liberation } from '@/world/city/liberation';
import { graffiti, ORIGINAL } from '@/world/paint/surfaces';
import { applyFix, cityFix } from '@/world/net/fix';
import { validPatch } from '@/world/net/validate';
import { CityMonsters } from '@/systems/city/city-monsters';
import { TravelAltar } from '@/systems/city/travel-altar';
import { InteractionSystem } from '@/systems/interaction/interaction';
import { objective, type Situation } from '@/world/objectives';
import { headless } from './support/headless';

function setup(count = 5) {
  const layout = {
    ...generateCity('c1_1', 2, 2, 'nz', () => 3),
    monsters: Array.from({ length: count }, (_, i) => ({ type: 0, chunk: 0, x: 15 + i * 4, z: 15 })),
  };
  const h = headless({ cities: { [layout.id]: layout } });
  cityStates(h.ctx.state, layout.id, layout);
  const saved = h.ctx.state.cities.get(layout.id)!;
  Object.assign(saved, { peaceful: false, completed: false, altarGuards: 0 });
  saved.states.fill(0);
  saved.defeated.fill(0);
  const altar = travelAltar(layout)!;
  expect(altar).not.toBeNull();
  const context = {
    cityOf: () => layout,
    altarOf: () => altar,
    sourceOf: () => null,
    wildMonsterOf: () => null,
    ruinOf: () => null,
  };
  h.ctx.apply = (patch) => {
    const result = applyPatch(h.ctx.state, patch, context);
    if (result.ok) h.ctx.events.emit('patch:applied', { patch });
    return result;
  };
  const patch = (p: Omit<Extract<Patch, { city: string }>, 'city'> & Record<string, unknown>) =>
    h.ctx.apply({ ...p, city: layout.id } as Patch);
  return { ...h, layout, saved, altar, patch, context };
}

describe('altar liberation rules', () => {
  it('requires at least half the original guards, rounded up, before the three garrison kills', () => {
    const h = setup();
    h.saved.defeated.fill(1, 0, 2);
    expect(liberation(h.layout, h.saved)).toMatchObject({ defeated: 2, required: 3, unlocked: false });
    expect(h.patch({ kind: 'defeatAltarGuard', guard: 0 }).ok).toBe(false);
    expect(h.patch({ kind: 'restoreAltar' }).ok).toBe(false);
    h.saved.defeated[2] = 1;
    expect(h.patch({ kind: 'defeatAltarGuard', guard: 0 }).ok).toBe(true);
    expect(h.patch({ kind: 'defeatAltarGuard', guard: 0 }).ok).toBe(false);
    expect(h.patch({ kind: 'restoreAltar' }).ok).toBe(false);
    for (const guard of [1, 2]) expect(h.patch({ kind: 'defeatAltarGuard', guard }).ok).toBe(true);
    expect(h.saved.completed).toBe(false);
    expect(h.saved.altarGuards).toBe(ALTAR_CAPTURED);
    expect(h.patch({ kind: 'restoreAltar' }).ok).toBe(true);
    expect(h.saved.completed).toBe(true);
    const even = setup(4);
    even.saved.defeated.fill(1, 0, 2);
    expect(liberation(even.layout, even.saved).unlocked).toBe(true);
  });

  it('restores the whole village once, preserves graffiti, dismisses guards and tides without bulk kill rewards', () => {
    const h = setup();
    h.saved.defeated.fill(1, 0, 3);
    h.saved.altarGuards = ALTAR_CAPTURED;
    h.saved.states[0] = graffiti(4);
    h.saved.tide.wave = { chunk: 0, from: 0, startsIn: 0, endsIn: 20, front: 5 };
    h.ctx.state.clock = 123;
    h.ctx.state.inventory.generic = 0;
    expect(h.patch({ kind: 'restoreAltar' }).ok).toBe(true);
    expect(h.saved.states[0]).toBe(graffiti(4));
    expect(h.saved.states.slice(1).every((s) => s === ORIGINAL)).toBe(true);
    expect(h.saved.defeated.every((s) => s === 1)).toBe(true);
    expect(h.saved.stains.every((s) => s === 1)).toBe(true);
    expect(h.saved.tide.wave).toBeNull();
    expect(h.saved.restoredAt).toBe(123);
    expect(h.ctx.state.inventory.glider).toBe(true);
    const inventory = { ...h.ctx.state.inventory };
    expect(h.patch({ kind: 'restoreAltar' }).ok).toBe(false);
    expect(h.patch({ kind: 'complete' }).ok).toBe(false);
    expect(h.patch({ kind: 'defeat', monster: 4 }).ok).toBe(false);
    expect(h.patch({ kind: 'drain', surface: 0 }).ok).toBe(false);
    expect(h.ctx.state.inventory).toEqual(inventory);
  });

  it('does not grant liberation just for killing all street guards, or in peaceful/missing-altar villages', () => {
    const h = setup();
    h.saved.defeated.fill(1);
    expect(h.patch({ kind: 'restoreAltar' }).ok).toBe(false);
    h.saved.altarGuards = ALTAR_CAPTURED;
    expect(
      applyPatch(
        h.ctx.state,
        { kind: 'restoreAltar', city: h.layout.id },
        { ...h.context, altarOf: () => null },
      ).ok,
    ).toBe(false);
    h.saved.peaceful = true;
    expect(h.patch({ kind: 'restoreAltar' }).ok).toBe(false);
  });

  it('persists partial capture, migrates v11, and reconciles server corrections in both directions', () => {
    const h = setup();
    h.saved.altarGuards = 5;
    expect(deserializeWorld(serializeWorld(h.ctx.state)).cities.get(h.layout.id)!.altarGuards).toBe(5);
    const old = JSON.parse(serializeWorld(h.ctx.state));
    old.version = 11;
    delete old.cities[h.layout.id].ag;
    const loaded = deserializeWorld(JSON.stringify(old));
    expect(loaded.cities.get(h.layout.id)!.altarGuards).toBe(0);
    expect(loaded.cities.get(h.layout.id)!.states).toEqual(h.saved.states);
    const before = structuredClone(h.saved);
    h.saved.altarGuards = 7;
    const fix = cityFix(h.layout.id, before, h.saved)!;
    applyFix(loaded, { city: fix });
    expect(loaded.cities.get(h.layout.id)!.altarGuards).toBe(7);
    applyFix(loaded, { city: { id: h.layout.id, altarGuards: 1 } });
    expect(loaded.cities.get(h.layout.id)!.altarGuards).toBe(1);
    for (const guard of [-1, 3, 0.5, '0'])
      expect(validPatch({ kind: 'defeatAltarGuard', city: h.layout.id, guard })).toBeNull();
    expect(validPatch({ kind: 'defeatAltarGuard', city: h.layout.id, guard: 2 })).not.toBeNull();
    expect(validPatch({ kind: 'restoreAltar', city: h.layout.id })).not.toBeNull();
  });
});

it('spawns the actual garrison only after the threshold and can defeat it with the combat system', () => {
  const h = setup();
  const material = new THREE.MeshBasicMaterial();
  const monsters = new CityMonsters(
    h.ctx,
    h.layout,
    h.saved.defeated,
    h.physics,
    new THREE.Group(),
    material,
  );
  monsters.update(0.01);
  expect(monsters.group.living('altar')).toHaveLength(0);
  h.saved.defeated.fill(1, 0, 3);
  monsters.update(0.01);
  expect(monsters.group.living('altar')).toHaveLength(3);
  const at = new THREE.Vector3(h.altar.x, h.altar.y + 1, h.altar.z);
  h.combat.blast(at, 6, 10000);
  expect(h.saved.altarGuards).toBe(ALTAR_CAPTURED);
  monsters.update(0.01);
  expect(monsters.group.living('altar')).toHaveLength(0);
  h.patch({ kind: 'restoreAltar' });
  monsters.update(0.01);
  expect(monsters.group.living()).toHaveLength(0);
  monsters.dispose();
  material.dispose();
});

it('requires an uninterrupted three-second repair at the altar after capture', () => {
  const h = setup();
  Object.assign(h.ctx.scenes.active, { ref: { kind: 'city', id: h.layout.id } });
  const interactions = new InteractionSystem(h.ctx);
  Object.assign(h.ctx, { interactions });
  const altar = new TravelAltar(h.ctx, h.layout, h.physics, new THREE.Group());
  h.place(h.altar.x, h.altar.y + 0.21, h.altar.z);
  let pressed = true;
  h.ctx.input.pressed = (action) => pressed && action === 'interact';
  const begin = () => {
    pressed = true;
    h.held.add('interact');
    interactions.update(0.01);
    pressed = false;
  };
  begin();
  h.run(4, (dt) => interactions.update(dt));
  expect(h.saved.completed).toBe(false);
  h.saved.defeated.fill(1, 0, 3);
  h.saved.altarGuards = ALTAR_CAPTURED;
  begin();
  h.run(2, (dt) => interactions.update(dt));
  expect(h.saved.completed).toBe(false);
  h.held.clear();
  interactions.update(0.01);
  begin();
  h.run(1.5, (dt) => interactions.update(dt));
  expect(h.saved.completed).toBe(false);
  h.run(1.6, (dt) => interactions.update(dt));
  expect(h.saved.completed).toBe(true);
  altar.update(0.1);
  expect(altar.root.getObjectByName('altar:ink-stronghold')!.visible).toBe(false);
  altar.dispose();
  interactions.dispose();
});

it('guides players through the three stages even without pigment or guards in their current block', () => {
  const h = setup();
  const situation: Situation = {
    scene: 'city',
    generic: 0,
    ink: 0,
    inkPerGeneric: 2,
    visitedCity: true,
    restoredCities: 0,
    drop: null,
    nextCity: null,
    city: {
      name: '测试村',
      completed: false,
      coloredBlocks: 0,
      blocks: 4,
      gate: { x: 0, z: 0 },
      studio: null,
      stain: null,
      guards: 0,
      nearestGuard: { x: 10, z: 10 },
      holdsWeapon: true,
    },
  };
  const read = () =>
    objective({
      ...situation,
      city: { ...situation.city!, liberation: { altar: h.altar, ...liberation(h.layout, h.saved) } },
    });
  expect(read().text).toContain('50%');
  expect(read().target).toEqual(situation.city!.nearestGuard);
  h.saved.defeated.fill(1, 0, 3);
  expect(read().text).toContain('驻守墨怪剩 3');
  expect(read().target).toEqual(h.altar);
  h.saved.altarGuards = 7;
  expect(read().text).toContain('修复祭坛');
});
