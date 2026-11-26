import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { generateCity, placeCity, townLayout } from '@/world/city/layout';
import { createWilderness } from '@/world/wilderness/generator';
import { hasTravelAltar, travelAltar } from '@/world/city/travel-altar';
import { InteractionSystem } from '@/systems/interaction/interaction';
import { SceneManager } from '@/systems/scenes/scene-manager';
import type { WildScene } from '@/systems/wilderness/wild-scene';
import { WildMarks } from '@/systems/wilderness/marks';
import { TravelAltar } from '@/systems/city/travel-altar';
import { headless } from './support/headless';

const seed = Array.from({ length: 100 }, (_, i) => i).find((i) => hasTravelAltar(i, 3))!;
const city = generateCity('altar-city', seed, 3, 'nz', () => 3);

it('gives dry villages of every size a liberation altar without changing their layout', () => {
  for (const chunks of [2, 3, 4])
    for (let seed = 0; seed < 12; seed++) {
      const layout = generateCity('x', seed, chunks, 'nz', () => 3);
      expect(hasTravelAltar(seed, chunks)).toBe(true);
      expect(travelAltar(layout)).not.toBeNull();
    }
});

it('places the altar beside the well without mutating saved layout and follows world offsets', () => {
  const before = JSON.stringify(city);
  const a = travelAltar(city)!;
  expect(a).not.toBeNull();
  expect(Math.hypot(a.x - city.square.x, a.z - city.square.z)).toBeCloseTo(6.1);
  expect(JSON.stringify(city)).toBe(before);
  const b = travelAltar(placeCity(city, { x: 1400, z: -2200 }))!;
  expect(b.x - a.x).toBeCloseTo(1400);
  expect(b.z - a.z).toBeCloseTo(-2200);
  expect(travelAltar({ ...city, water: new Uint8Array(city.water.length).fill(1) })).toBeNull();
  expect(travelAltar({ ...city, heights: new Float32Array(city.heights.length).fill(-2) })).toBeNull();
});

it('gives villages on generated terrain a reachable liberation altar', () => {
  let count = 0;
  for (const seed of [7, 42, 4242]) {
    const land = createWilderness(seed);
    for (const e of land.entrancesNear(0, 0, 3)) {
      const layout = townLayout(e, land);
      expect(travelAltar(layout), `seed ${seed}, village ${e.cityId}`).not.toBeNull();
      count++;
    }
  }
  expect(count).toBeGreaterThan(10);
});

function interactionHarness() {
  const h = headless();
  let pressed = false;
  h.ctx.input.pressed = (a) => pressed && a === 'interact';
  const interactions = new InteractionSystem(h.ctx);
  Object.assign(h.ctx, { interactions });
  const activate = vi.fn(),
    onHold = vi.fn();
  const item = {
    scene: 'wild',
    pos: new THREE.Vector3(),
    radius: 2.7,
    holdSeconds: 2,
    label: () => '长按 E',
    activate,
    onHold,
  };
  interactions.add(item);
  const begin = () => {
    h.held.add('interact');
    pressed = true;
    interactions.update(1 / 30);
    pressed = false;
  };
  const run = (s: number) => h.run(s, (dt) => interactions.update(dt));
  return { ...h, interactions, activate, onHold, begin, run };
}

it('loads saved ink marks before the scene manager is assigned', () => {
  const { ctx } = headless();
  const scenes = ctx.scenes;
  const action = { label: () => '传送', activate: vi.fn(), holdSeconds: 2 };
  const travelAction = vi.fn(() => action);
  const interactions = new InteractionSystem(ctx);
  const registered = vi.spyOn(interactions, 'add');
  ctx.state.marks.push({ id: 'k1', x: 0, y: 0, z: 0 });
  Object.assign(ctx, { interactions, scenes: undefined });
  const material = new THREE.MeshBasicMaterial();
  const marks = new WildMarks(ctx, material, new THREE.Group());
  expect(registered).toHaveBeenCalledOnce();
  expect(travelAction).not.toHaveBeenCalled();
  Object.assign(ctx, { scenes: { ...scenes, travelAction } });
  const saved = registered.mock.calls[0]![0];
  expect(saved.alt).toBe(action);
  expect(saved.alt).toBe(action);
  expect(travelAction).toHaveBeenCalledExactlyOnceWith('k1');
  marks.dispose();
  interactions.dispose();
  material.dispose();
});

it('requires a fresh two-second hold, cancels on release, and never chains while the key stays down', () => {
  const h = interactionHarness();
  h.begin();
  h.run(1);
  h.held.clear();
  h.run(0.1);
  expect(h.activate).not.toHaveBeenCalled();
  expect(h.onHold).toHaveBeenLastCalledWith(0);
  h.begin();
  h.run(1);
  expect(h.activate).not.toHaveBeenCalled();
  h.run(1.2);
  expect(h.activate).toHaveBeenCalledTimes(1);
  h.run(5);
  expect(h.activate).toHaveBeenCalledTimes(1);
  h.interactions.dispose();
});

it('cancels charging on leaving, damage, and death', () => {
  const h = interactionHarness();
  h.begin();
  h.run(1);
  h.place(3, 0, 0);
  h.run(2);
  expect(h.activate).not.toHaveBeenCalled();
  h.place(0, 0, 0);
  h.begin();
  h.run(1);
  h.ctx.events.emit('player:hurt', { amount: 1, absorbed: 0, from: null, melee: false });
  h.run(2);
  expect(h.activate).not.toHaveBeenCalled();
  h.begin();
  h.run(1);
  vi.spyOn(h.ctx.combat, 'alive', 'get').mockReturnValue(false);
  h.run(2);
  expect(h.activate).not.toHaveBeenCalled();
  h.interactions.dispose();
});

it('preserves instant interactions and supports held secondary actions at ink marks', () => {
  const h = headless();
  let press: string | null = null;
  h.ctx.input.pressed = (a) => a === press;
  const interactions = new InteractionSystem(h.ctx);
  const activate = vi.fn(),
    travel = vi.fn();
  const off = interactions.add({
    scene: 'wild',
    pos: new THREE.Vector3(),
    radius: 3,
    label: () => '标记',
    activate,
    alt: { label: () => '长按 F', activate: travel, holdSeconds: 2 },
  });
  press = 'interact';
  interactions.update(1 / 30);
  expect(activate).toHaveBeenCalledTimes(1);
  press = 'secondary';
  h.held.add('secondary');
  interactions.update(1 / 30);
  press = null;
  h.run(1, (dt) => interactions.update(dt));
  off();
  h.run(2, (dt) => interactions.update(dt));
  expect(travel).not.toHaveBeenCalled();
  expect(interactions.focused).toBeNull();
  interactions.dispose();
});

it('builds a walkable altar and releases its interaction and effects', () => {
  const h = headless();
  const interactions = new InteractionSystem(h.ctx);
  Object.assign(h.ctx, { interactions });
  const root = new THREE.Group();
  const altar = new TravelAltar(h.ctx, city, h.physics, root);
  const a = travelAltar(city)!;
  expect(h.physics.groundBelow(a.x, a.y + 2, a.z, 3)).toBeCloseTo(a.y + 0.21);
  h.ctx.events.emit('travel:charge', { from: city.id, progress: 0.5 });
  altar.update(0.1);
  expect(root.getObjectByName('altar:charging-motes')!.visible).toBe(true);
  altar.dispose();
  expect(root.children).toHaveLength(0);
  interactions.dispose();
});

it('filters villages without altars and arrives on the altar after the dissolve', () => {
  const h = headless();
  const wet = generateCity('small', 1, 2);
  const noAltar = { ...wet, water: new Uint8Array(wet.water.length).fill(1) };
  const layouts = new Map([
    [city.id, city],
    [noAltar.id, noAltar],
  ]);
  h.ctx.state.marks.push({ id: 'm1', x: 20, y: 3, z: 20 });
  // Only the two flags are used by the travel network in this isolated harness.
  for (const id of layouts.keys()) h.ctx.state.cities.set(id, { completed: true, peaceful: false } as never);
  Object.assign(h.ctx, {
    cities: {
      entranceOf: (id: string) => ({ cityId: id }),
      layout: (e: { cityId: string }) => layouts.get(e.cityId)!,
    },
  });
  Object.assign(h.ctx, { wilderness: { entrancesNear: () => [], townAt: () => null } });
  Object.assign(h.ctx, { renderer: { scene: new THREE.Scene() } });
  const wild = { ...h.ctx.scenes.active, ensureAt: vi.fn(), activate: () => {} } as unknown as WildScene;
  const manager = new SceneManager(h.ctx, wild, () => {
    throw new Error('unexpected city');
  });
  Object.assign(h.ctx, { scenes: manager });
  expect(manager.travelAction('m1').label()).toContain(city.name);
  expect(manager.travelAction(noAltar.id).label()).toBeNull();
  manager.travelTo(noAltar.id);
  h.run(2, (dt) => manager.update(dt));
  expect(h.ctx.player.position.x).toBe(0);
  manager.travelTo(city.id);
  h.run(0.3, (dt) => manager.update(dt));
  expect(h.ctx.player.position.x).toBe(0);
  h.run(1.2, (dt) => manager.update(dt));
  const a = travelAltar(city)!;
  expect(h.ctx.player.position.x).toBeCloseTo(a.x);
  expect(h.ctx.player.position.y).toBeCloseTo(a.y + 0.26);
  expect(h.ctx.player.position.z).toBeCloseTo(a.z);
  manager.dispose();
});
