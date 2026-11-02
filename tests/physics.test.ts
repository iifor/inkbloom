import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicsWorld, makeBody, surfaceAt } from '@/engine/physics/world';

describe('physics', () => {
  it('raycasts across grid cells and reports the nearest face', () => {
    const w = new PhysicsWorld(8);
    w.addBox('a', { x: 40, y: 0, z: -1 }, { x: 42, y: 4, z: 1 }, { faces: { nx: 7 } });
    w.addBox('a', { x: 20, y: 0, z: -1 }, { x: 22, y: 4, z: 1 }, { faces: { nx: 3 } });
    const hit = w.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100);
    expect(hit).not.toBeNull();
    expect(hit!.dist).toBeCloseTo(20);
    expect(hit!.normal.x).toBe(-1);
    expect(surfaceAt(hit!)).toBe(3);
  });

  it('finds a box spanning many cells from far away', () => {
    const w = new PhysicsWorld(8);
    w.addBox('ground', { x: -200, y: -1, z: -200 }, { x: 200, y: 0, z: 200 });
    expect(w.groundBelow(150, 10, -120)).toBeCloseTo(0);
  });

  it('maps door decals to their own surface', () => {
    const w = new PhysicsWorld(8);
    w.addBox(
      'house',
      { x: 0, y: 0, z: 0 },
      { x: 8, y: 6, z: 8 },
      {
        faces: { pz: 1 },
        decals: [{ face: 'pz', min: { x: 3, y: 0, z: 8 }, max: { x: 5, y: 2.4, z: 8 }, surface: 9 }],
      },
    );
    const door = w.raycast({ x: 4, y: 1, z: 20 }, { x: 0, y: 0, z: -1 }, 30)!;
    const wall = w.raycast({ x: 1, y: 4, z: 20 }, { x: 0, y: 0, z: -1 }, 30)!;
    expect(surfaceAt(door)).toBe(9);
    expect(surfaceAt(wall)).toBe(1);
  });

  it('removes a group without disturbing others', () => {
    const w = new PhysicsWorld(8);
    w.addBox('keep', { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    w.addBox('drop', { x: 0, y: 2, z: 0 }, { x: 1, y: 3, z: 1 });
    w.removeGroup('drop');
    expect(w.boxCount).toBe(1);
    expect(w.raycast({ x: 0.5, y: 10, z: 0.5 }, { x: 0, y: -1, z: 0 })!.point.y).toBeCloseTo(1);
  });

  it('steps a body up a terrace and lands it on the ground', () => {
    const w = new PhysicsWorld(8);
    w.addBox('g', { x: -10, y: -1, z: -10 }, { x: 0, y: 0, z: 10 });
    w.addBox('g', { x: 0, y: -1, z: -10 }, { x: 10, y: 0.5, z: 10 });
    const body = makeBody(new THREE.Vector3(-2, 0, 0), 0.35, 1.8, 0.55);
    body.onGround = true;
    for (let i = 0; i < 60; i++) {
      body.vel.set(5, body.vel.y - 22 * (1 / 60), 0);
      w.moveBody(body, 1 / 60);
    }
    expect(body.pos.x).toBeGreaterThan(2);
    expect(body.pos.y).toBeCloseTo(0.5, 2);
    expect(body.onGround).toBe(true);
  });
});
