import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PlayerSystem } from '@/systems/player/player';
import { townLayout } from '@/world/city/layout';
import { villageLawnKind } from '@/world/city/lawn';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { headless } from './support/headless';
import { shared } from '@/engine/render/ink-material';

it('rests on a town lawn, stands up when moving, and rejects paving and obstructed spots', () => {
  const h = headless();
  const wilderness = createWilderness(4242);
  const layout = townLayout(wilderness.entranceInCell(0, 0)!, wilderness);
  const grass = layout.groundOf.findIndex((_, i) => {
    const x = layout.ox + ((i % layout.n) + 0.5) * layout.cell;
    const z = layout.oz + (Math.floor(i / layout.n) + 0.5) * layout.cell;
    const y = wilderness.heightAt(x, z);
    return (
      y > WATER_LEVEL + 0.5 &&
      villageLawnKind(layout, x, z) === 1 &&
      [-0.9, 0.9].every((dx) =>
        [-0.9, 0.9].every((dz) => Math.abs(wilderness.heightAt(x + dx, z + dz) - y) < 0.25),
      )
    );
  });
  expect(grass).toBeGreaterThanOrEqual(0);
  const x = layout.ox + ((grass % layout.n) + 0.5) * layout.cell;
  const z = layout.oz + (Math.floor(grass / layout.n) + 0.5) * layout.cell;
  const y = wilderness.heightAt(x, z);
  let pressed = '';
  Object.assign(h.ctx, {
    renderer: { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() },
    wilderness,
    cities: { byId: () => layout },
  });
  Object.assign(h.ctx.scenes.active, { ref: { kind: 'city', id: layout.id } });
  Object.assign(h.ctx.input, {
    takeLook: () => ({ yaw: 0, pitch: 0 }),
    pressed: (key: string) => key === pressed,
  });
  h.physics.ground = wilderness.heightAt;
  const p = new PlayerSystem(h.ctx);
  Object.assign(h.ctx, { player: p });
  const step = () => p.update(1 / 60);
  const place = (x: number, z: number) => {
    p.teleport(new THREE.Vector3(x, wilderness.heightAt(x, z), z));
    step();
  };
  const act = (key: string) => {
    pressed = key;
    step();
    pressed = '';
  };
  place(x, z);
  act('sit');
  expect(p.resting).toBe('sitting');
  for (let i = 0; i < 50; i++) step();
  expect(p.restMotion).toMatchObject({ sitting: 1, lying: 0 });
  expect(shared.uRestArea.value.w).toBe(1);
  const anchoredYaw = p.restMotion!.yaw;
  p.yaw += 0.4;
  expect(p.restMotion!.yaw).toBe(anchoredYaw);
  act('lieDown');
  expect(p.resting).toBe('lying');
  for (let i = 0; i < 65; i++) step();
  expect(p.restMotion).toMatchObject({ sitting: 0, lying: 1 });
  h.held.add('forward');
  step();
  expect(p.resting).toBeNull();
  expect(p.restMotion!.lying).toBeGreaterThan(0.9);
  h.held.clear();
  for (let i = 0; i < 40; i++) step();
  expect(p.restMotion).toBeUndefined();
  expect(shared.uRestArea.value.w).toBe(0);
  expect(h.ctx.renderer.scene.getObjectByName('resting-player')!.visible).toBe(false);

  place(layout.square.x, layout.square.z);
  act('sit');
  expect(p.resting).toBeNull();

  place(x, z);
  h.physics.addBox('trunk', { x: x + 0.72, y, z: z - 0.15 }, { x: x + 1.12, y: y + 3, z: z + 0.15 });
  act('lieDown');
  expect(p.resting).toBeNull();
  act('sit');
  expect(p.resting).toBe('sitting');
  p.dispose();
});
