import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PhysicsWorld, makeBody, surfaceAt, turnedBox } from '@/engine/physics/world';

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

describe('smooth ground', () => {
  /** A ramp rising along +x at `slope`, flat below x = 0. */
  const ramp =
    (slope: number) =>
    (x: number): number =>
      Math.max(0, x) * slope;

  function world(slope: number): PhysicsWorld {
    const w = new PhysicsWorld(8);
    const r = ramp(slope);
    w.ground = (x) => r(x);
    return w;
  }

  const run = (w: PhysicsWorld, b: ReturnType<typeof makeBody>, seconds: number, vx: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      b.vel.x = vx;
      b.vel.y -= 22 / 60;
      w.moveBody(b, 1 / 60);
    }
  };

  it('lands a falling body on the ground and keeps it there', () => {
    const w = world(0.3);
    const b = makeBody(new THREE.Vector3(5, 10, 0), 0.4, 1.8);
    run(w, b, 2, 0);
    expect(b.onGround).toBe(true);
    expect(b.pos.y).toBeCloseTo(1.5, 2);
  });

  it('walks up a gentle hill and back down it without leaving the ground', () => {
    const w = world(0.5);
    const b = makeBody(new THREE.Vector3(-2, 0, 0), 0.4, 1.8);
    run(w, b, 3, 4);
    expect(b.pos.x).toBeGreaterThan(8);
    expect(b.pos.y).toBeCloseTo(b.pos.x * 0.5, 1);
    let airborne = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      run(w, b, 1 / 60, -6);
      if (!b.onGround) airborne++;
    }
    expect(airborne).toBe(0);
  });

  it('stops at ground too steep to climb, like a wall', () => {
    const w = world(2.5);
    const b = makeBody(new THREE.Vector3(-3, 0, 0), 0.4, 1.8);
    run(w, b, 2, 4);
    expect(b.pos.x).toBeLessThan(0.5);
    expect(b.pos.y).toBeLessThan(1);
  });

  it('stops rays at the ground, with an upward normal and no surface', () => {
    const w = world(0.5);
    const hit = w.raycast({ x: -10, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, 100)!;
    expect(hit.point.x).toBeCloseTo(10, 1);
    expect(hit.normal.y).toBeGreaterThan(0.8);
    expect(hit.normal.x).toBeLessThan(0);
    expect(surfaceAt(hit)).toBeNull();
    // a box in front of the hill still wins
    w.addBox('a', { x: 2, y: 0, z: -1 }, { x: 3, y: 8, z: 1 }, { faces: { nx: 4 } });
    const box = w.raycast({ x: -10, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, 100)!;
    expect(surfaceAt(box)).toBe(4);
    expect(w.groundBelow(20, 50, 0)).toBeCloseTo(10, 1);
  });
});

describe('turned boxes', () => {
  const frame = {
    x: 10,
    y: 2,
    z: -4,
    angle: 0.6,
    hx: 4,
    hz: 3,
    faces: { px: 1, nx: 2, pz: 3, nz: 4, py: 5 },
    decals: [
      { face: 'pz' as const, min: { x: -0.8, y: 0, z: 2.9 }, max: { x: 0.8, y: 2.4, z: 3.1 }, surface: 9 },
    ],
  };
  /** A point in the turned box's own frame, in the world. */
  const world = (u: number, y: number, v: number) => {
    const c = Math.cos(frame.angle);
    const s = Math.sin(frame.angle);
    return new THREE.Vector3(frame.x + c * u + s * v, frame.y + y, frame.z - s * u + c * v);
  };

  it('stand in for it with slices that never poke out of it', () => {
    const boxes: { min: { x: number; z: number }; max: { x: number; z: number } }[] = [];
    turnedBox(frame, 2, 6, (min, max) => boxes.push({ min, max }));
    expect(boxes.length).toBeGreaterThan(8);
    const c = Math.cos(frame.angle);
    const s = Math.sin(frame.angle);
    for (const b of boxes)
      for (const [x, z] of [
        [b.min.x, b.min.z],
        [b.max.x, b.max.z],
        [b.min.x, b.max.z],
        [b.max.x, b.min.z],
      ] as const) {
        const u = (x - frame.x) * c - (z - frame.z) * s;
        const v = (x - frame.x) * s + (z - frame.z) * c;
        expect(Math.abs(u)).toBeLessThanOrEqual(frame.hx + 1e-6);
        expect(Math.abs(v)).toBeLessThanOrEqual(frame.hz + 1e-6);
      }
  });

  it('paint the face of the turned box a ray meets, door included', () => {
    const w = new PhysicsWorld(8);
    turnedBox(frame, 2, 6, (min, max, data) => w.addBox('house', min, max, data));
    const shoot = (from: THREE.Vector3, to: THREE.Vector3) => {
      const d = to.clone().sub(from).normalize();
      const hit = w.raycast(from, d, 50)!;
      return surfaceAt(hit);
    };
    // straight at the front, beside the door and at the door; then the side, the back and the top
    expect(shoot(world(2.5, 1.5, 12), world(2.5, 1.5, 0))).toBe(3);
    expect(shoot(world(0, 1.2, 12), world(0, 1.2, 0))).toBe(9);
    expect(shoot(world(12, 1.5, 0.5), world(0, 1.5, 0.5))).toBe(1);
    expect(shoot(world(-1, 1.5, -12), world(-1, 1.5, 0))).toBe(4);
    expect(shoot(world(0.5, 20, 0.3), world(0.5, 0, 0.3))).toBe(5);
  });
});
