import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ToolBelt } from '@/systems/tools/tool';
import { WeaponSlot } from '@/systems/tools/weapons';
import { headless } from './support/headless';

it.each(['gliding', 'flying', 'falling'] as const)(
  'stows weapons during %s without firing or spending ammo, and resumes afterwards',
  (mode) => {
    const h = headless();
    const camera = new THREE.PerspectiveCamera(65);
    Object.assign(h.ctx, { renderer: { camera, baseFov: 65, scene: new THREE.Scene() } });
    Object.assign(h.ctx.input, { takeWheel: () => 0 });
    const weapons = new WeaponSlot(h.ctx);
    const belt = new ToolBelt(h.ctx, [weapons]);
    const shoot = vi.spyOn(h.combat, 'shoot');
    const ammo = weapons.hud().lines[0];
    h.held.add('use');
    Object.assign(h.ctx.player, { [mode]: true, grounded: false });

    h.run(1, (dt) => belt.update(dt));
    expect(shoot).not.toHaveBeenCalled();
    expect(h.count('weapon:fired')).toBe(0);
    expect(weapons.hud().lines[0]).toBe(ammo);
    expect(belt.inHand().item).toBeNull();
    expect(camera.children.every((child) => !child.visible)).toBe(true);

    Object.assign(h.ctx.player, { [mode]: false, grounded: true });
    belt.update(1 / 60);
    expect(shoot).toHaveBeenCalledOnce();
    expect(h.count('weapon:fired')).toBe(1);
    expect(weapons.hud().lines[0]).not.toBe(ammo);
    expect(belt.inHand().item).toBe('rifle');
    expect(camera.children.some((child) => child.visible)).toBe(true);
  },
);

it('blocks the launcher skill and scope while gliding, including switching tools in flight', () => {
  const h = headless();
  const camera = new THREE.PerspectiveCamera(65);
  Object.assign(h.ctx, { renderer: { camera, baseFov: 65, scene: new THREE.Scene() } });
  Object.assign(h.ctx.input, { takeWheel: () => 0, pressed: (key: string) => key === 'skill' });
  h.ctx.state.inventory.weapons = ['launcher'];
  const launcher = new WeaponSlot(h.ctx);
  const belt = new ToolBelt(h.ctx, [
    launcher,
    { id: 'empty', name: '', update() {}, hud: () => ({ lines: [], progress: null, swatch: null }) },
  ]);
  Object.assign(h.ctx.player, { gliding: true, grounded: false });
  h.held.add('use');
  h.held.add('alt');
  belt.update(1 / 60);
  belt.select(1);
  belt.select(0);
  belt.update(1 / 60);
  expect(h.count('weapon:skill')).toBe(0);
  expect(h.count('weapon:fired')).toBe(0);
  expect(h.ctx.scenes.active.root.children).toHaveLength(0);
  expect(belt.inHand()).toEqual({ item: null, aiming: false, painting: false });

  h.ctx.state.inventory.weapons = ['sniper'];
  belt.update(1 / 60);
  expect(camera.fov).toBe(65);
  Object.assign(h.ctx.player, { gliding: false });
  belt.update(1 / 60);
  expect(camera.fov).toBe(32);
  expect(h.count('weapon:fired')).toBe(1);
  expect(belt.inHand().item).toBe('sniper');
});
