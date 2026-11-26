import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Brush } from '@/systems/tools/brush';
import { WalkArms } from '@/systems/player/walk-arms';
import { BrushSpray } from '@/engine/render/brush-spray';
import { walkingBrushTip } from '@/systems/tools/viewmodels';
import type { CityLayout } from '@/world/city/layout';
import { cityStates } from '@/world/state';
import { ORIGINAL } from '@/world/paint/surfaces';
import { headless } from './support/headless';

function setup() {
  const city = {
    chunks: 1,
    surfaces: [{ kind: 'wall', chunk: 0, color: 31, area: 10, x: 0, z: -2 }],
    stains: [],
    studios: [],
    homeStudio: -1,
    residents: [],
    monsters: [{ type: 0, chunk: 0, x: 0, z: -2 }],
  } as unknown as CityLayout;
  const h = headless({ cities: { test: city } });
  Object.assign(h.ctx, { cities: { byId: () => city } });
  Object.assign(h.ctx.input, { takeWheel: () => 0 });
  Object.assign(h.ctx.scenes.active, { ref: { kind: 'city', id: 'test' } });
  h.physics.addBox('wall', { x: -2, y: 0, z: -2.2 }, { x: 2, y: 4, z: -2 }, { faces: { pz: 0 } });
  cityStates(h.ctx.state, 'test', city);
  const saved = h.ctx.state.cities.get('test')!;
  saved.states.fill(0);
  saved.defeated.fill(1);
  saved.completed = false;
  h.ctx.state.inventory.generic = 30;
  h.ctx.state.unlocked = [0, 1, 4];
  return { ...h, brush: new Brush(h.ctx), saved };
}

describe('brush feedback follows actual paint eligibility', () => {
  it('previews architectural wall colour, then selected graffiti colour, and supplies the ray hit only while working', () => {
    const h = setup();
    h.brush.update(0.05);
    expect(h.brush.inHand()).toMatchObject({ paintColor: 31, painting: false });
    expect(h.brush.inHand().paintTarget).toBeUndefined();
    h.held.add('use');
    h.brush.update(0.05);
    expect(h.brush.inHand()).toMatchObject({
      painting: true,
      paintColor: 31,
      paintTarget: { x: 0, y: 1.6, z: -2 },
    });
    expect(h.log.find((e) => e.type === 'paint:dab')!.payload).toMatchObject({ color: 31 });
    h.brush.mode = 'graffiti';
    h.brush.colorIndex = 1;
    h.brush.update(0.08);
    expect(h.brush.inHand().paintColor).toBe(1);
    expect(h.log.filter((e) => e.type === 'paint:dab').at(-1)!.payload).toMatchObject({ color: 1 });
  });

  it.each(['release', 'finished', 'guard', 'pigment', 'miss', 'unequip', 'curtain'] as const)(
    'stops wall spray after %s',
    (reason) => {
      const h = setup();
      h.held.add('use');
      h.brush.update(0.1);
      expect(h.brush.inHand().paintTarget).toBeDefined();
      if (reason === 'release') h.held.clear();
      if (reason === 'finished') h.saved.states[0] = ORIGINAL;
      if (reason === 'guard') h.saved.defeated.fill(0);
      if (reason === 'pigment') h.ctx.state.inventory.generic = 0;
      if (reason === 'miss') h.place(8, 0, 0);
      if (reason === 'curtain') Object.assign(h.ctx.scenes.active, { brushStop: () => 1 });
      if (reason === 'unequip') h.brush.onUnequip();
      else h.brush.update(0.1);
      expect(h.brush.inHand().paintTarget).toBeUndefined();
      // Pushing ink still uses the hand motion, but cannot spray at the wall behind it.
      expect(h.brush.inHand().painting).toBe(reason === 'curtain');
    },
  );

  it('stops the effect on the same frame as a successful or rejected patch', () => {
    for (const reject of [false, true]) {
      const h = setup();
      if (reject) h.ctx.apply = () => ({ ok: false, reason: 'test rejection' });
      h.held.add('use');
      h.run(1.1, (dt) => h.brush.update(dt));
      expect(h.brush.inHand().painting).toBe(false);
      expect(h.brush.inHand().paintTarget).toBeUndefined();
      expect(h.count('paint:bloom')).toBe(reject ? 0 : 1);
    }
  });

  it('starts a fresh stroke when switching colour mid-stroke', () => {
    const h = setup();
    h.held.add('use');
    h.brush.update(0.8);
    h.brush.mode = 'graffiti';
    h.brush.colorIndex = 1;
    h.brush.update(0.1);
    expect(h.count('paint:bloom')).toBe(0);
    expect(h.brush.hud().progress).toBeCloseTo(0.1);
  });
});

it('pulses forward, preserves the hand colours, and attaches spray to the rendered tip at every FOV', () => {
  const h = headless();
  const camera = new THREE.PerspectiveCamera(65, 16 / 9);
  camera.position.set(3, 2, 4);
  camera.rotation.set(0.2, 0.4, 0);
  const spray = new BrushSpray(new THREE.Texture());
  const arms = new WalkArms(camera, spray);
  const hand = camera.getObjectByName('walking-hands')!.children[1] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.ShaderMaterial
  >;
  const held = {
    item: 'brush' as const,
    painting: true,
    aiming: false,
    paintColor: 1,
    paintTarget: new THREE.Vector3(0, 2, -2),
  };
  const render = vi.fn();
  const renderer = {
    getRenderTarget: () => ({ width: 1280, height: 720 }),
    render,
  } as unknown as THREE.WebGLRenderer;
  h.run(0.5, (dt) => arms.update(dt, h.ctx.player, held, true));
  const reds = Array.from(hand.geometry.getAttribute('aColor').array);
  const z: number[] = [];
  for (const fov of [50, 65, 92, 110]) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    arms.update(1 / 60, h.ctx.player, held, true);
    z.push(hand.position.z);
    spray.render(renderer, camera, 0);
    const scene = render.mock.lastCall![0] as THREE.Scene;
    const material = (scene.children[0] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
    const from = material.uniforms.uFrom!.value.clone().project(camera);
    const tip = hand.localToWorld(walkingBrushTip(new THREE.Vector3())).project(camera);
    expect(from.x).toBeCloseTo(tip.x * hand.material.uniforms.uViewScale!.value, 6);
    expect(from.y).toBeCloseTo(tip.y * hand.material.uniforms.uViewScale!.value, 6);
    expect(material.uniforms.uTo!.value).toEqual(held.paintTarget);
  }
  expect(Math.max(...z)).toBeLessThan(-0.52);
  expect(Math.max(...z) - Math.min(...z)).toBeGreaterThan(0.008);
  arms.update(1 / 60, h.ctx.player, { ...held, paintColor: 4 }, true);
  const greens = Array.from(hand.geometry.getAttribute('aColor').array);
  const changes = reds.map((v, i) => [v, greens[i]]).filter(([a, b]) => a !== b);
  expect(changes.length).toBeGreaterThan(0);
  expect(changes.every(([a, b]) => a === 1 && b === 4)).toBe(true);
  render.mockClear();
  arms.update(1 / 60, h.ctx.player, { ...held, painting: false }, true);
  spray.render(renderer, camera, 0);
  expect(render).not.toHaveBeenCalled();
  arms.dispose();
  spray.dispose();
});
