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

describe('paintable boxes with a yaw', () => {
  /** A house turned 0.6 about (10, -4), 8 by 6 across, from y 2 to 6, a door in its front. */
  const house = { x: 10, z: -4, angle: 0.6, hx: 4, hz: 3, y0: 2, y1: 6 };
  const data = {
    faces: { px: 1, nx: 2, pz: 3, nz: 4, py: 5 },
    // placed on the box as it stood before it turned
    decals: [
      {
        face: 'pz' as const,
        min: { x: house.x - 0.8, y: 2, z: house.z + 2.9 },
        max: { x: house.x + 0.8, y: 4.4, z: house.z + 3.1 },
        surface: 9,
      },
    ],
  };
  const build = (angle: number) => {
    const w = new PhysicsWorld(8);
    const { x, z, hx, hz, y0, y1 } = house;
    w.addBox('house', { x: x - hx, y: y0, z: z - hz }, { x: x + hx, y: y1, z: z + hz }, data, angle);
    return w;
  };
  /** A point in the house's own frame (y from its floor), in the world. */
  const world = (angle: number, u: number, y: number, v: number) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new THREE.Vector3(house.x + c * u + s * v, house.y0 + y, house.z - s * u + c * v);
  };
  const shoot = (w: PhysicsWorld, from: THREE.Vector3, to: THREE.Vector3) => {
    const d = to.clone().sub(from).normalize();
    const hit = w.raycast(from, d, 50)!;
    return surfaceAt(hit);
  };

  for (const angle of [house.angle, Math.PI / 2, -Math.PI])
    it(`paint the face a ray meets, door included, turned ${angle.toFixed(2)}`, () => {
      const w = build(angle);
      const at = (u: number, y: number, v: number) => world(angle, u, y, v);
      // straight at the front, beside the door and at the door; then the side, the back and the top
      expect(shoot(w, at(2.5, 1.5, 12), at(2.5, 1.5, 0))).toBe(3);
      expect(shoot(w, at(0, 1.2, 12), at(0, 1.2, 0))).toBe(9);
      expect(shoot(w, at(12, 1.5, 0.5), at(0, 1.5, 0.5))).toBe(1);
      expect(shoot(w, at(-12, 1.5, 0.5), at(0, 1.5, 0.5))).toBe(2);
      expect(shoot(w, at(-1, 1.5, -12), at(-1, 1.5, 0))).toBe(4);
      expect(shoot(w, at(0.5, 20, 0.3), at(0.5, 0, 0.3))).toBe(5);
      // close to a corner, on the front at a slant: still the front
      expect(shoot(w, at(3.9, 1.5, 12), at(3.7, 1.5, 0))).toBe(3);
    });

  it('collides a box turned by a whole quarter as its AABB', () => {
    const w = build(Math.PI / 2);
    const [box] = w.query({ x: 9, y: 3, z: -5 }, { x: 11, y: 4, z: -3 });
    expect(box!.turn).toBeUndefined();
    expect(box!.frame).toBeDefined();
    // 8 along x turned a quarter is 8 along z
    expect(box!.max.z - box!.min.z).toBeCloseTo(8, 9);
    expect(box!.max.x - box!.min.x).toBeCloseTo(6, 9);
  });
});

describe('boxes with a yaw', () => {
  const floor = (w: PhysicsWorld): void => {
    w.addBox('g', { x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 });
  };
  /** A 20 m wall, 1 m thick, turned 45°: it runs along (1, -1) and faces (1, 1) / √2. */
  const wall = (w: PhysicsWorld, data = {}) =>
    w.addBox('w', { x: -10, y: 0, z: -0.5 }, { x: 10, y: 4, z: 0.5 }, data, Math.PI / 4);

  it('slides a body walking into a 45° wall along it', () => {
    const w = new PhysicsWorld(8);
    floor(w);
    wall(w);
    const b = makeBody(new THREE.Vector3(-3, 0, -3), 0.35, 1.8);
    b.onGround = true;
    for (let i = 0; i < 180; i++) {
      b.vel.set(4, b.vel.y - 22 / 60, 0);
      w.moveBody(b, 1 / 60);
    }
    // half the push goes into the wall and is lost, the rest carries the body along it
    expect(b.pos.x).toBeGreaterThan(3);
    expect(b.pos.z).toBeLessThan(-3);
    const gap = -(b.pos.x + b.pos.z) / Math.SQRT2;
    expect(gap).toBeGreaterThan(0.5 + 0.35 * Math.SQRT2 - 0.01);
    expect(b.hitWall).toBe(true);
    expect(b.wallNormal.x).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(b.wallNormal.z).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(b.onGround).toBe(true);
    expect(b.pos.y).toBeCloseTo(0, 3);
  });

  it('stands a body on a turned box, and not on the empty corners of its AABB', () => {
    const w = new PhysicsWorld(8);
    floor(w);
    w.addBox('b', { x: 8, y: 0, z: -2 }, { x: 12, y: 1, z: 2 }, {}, Math.PI / 4);
    const fall = (x: number, z: number) => {
      const b = makeBody(new THREE.Vector3(x, 5, z), 0.35, 1.8);
      for (let i = 0; i < 120; i++) {
        b.vel.y -= 22 / 60;
        w.moveBody(b, 1 / 60);
      }
      return b;
    };
    const on = fall(10.5, 0.5);
    expect(on.onGround).toBe(true);
    expect(on.pos.y).toBeCloseTo(1, 3);
    const off = fall(12.3, 2.3);
    expect(off.onGround).toBe(true);
    expect(off.pos.y).toBeCloseTo(0, 3);
  });

  it('steps a body up onto a low turned slab', () => {
    const w = new PhysicsWorld(8);
    floor(w);
    w.addBox('b', { x: 2, y: 0, z: -3 }, { x: 8, y: 0.4, z: 3 }, {}, 0.5);
    const b = makeBody(new THREE.Vector3(-2, 0, 0), 0.35, 1.8);
    b.onGround = true;
    for (let i = 0; i < 90; i++) {
      b.vel.set(4, b.vel.y - 22 / 60, 0);
      w.moveBody(b, 1 / 60);
    }
    expect(b.pos.x).toBeGreaterThan(3.5);
    expect(b.pos.y).toBeCloseTo(0.4, 3);
    expect(b.onGround).toBe(true);
  });

  it('raycasts onto a turned face with its turned normal and surface', () => {
    const w = new PhysicsWorld(8);
    wall(w, { faces: { nz: 5 } });
    const d = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
    const hit = w.raycast({ x: -5, y: 1, z: -5 }, d, 50)!;
    expect(hit).not.toBeNull();
    expect(hit.dist).toBeCloseTo(5 * Math.SQRT2 - 0.5, 4);
    expect(hit.normal.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(hit.normal.y).toBeCloseTo(0, 6);
    expect(hit.normal.z).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(surfaceAt(hit)).toBe(5);
  });

  it('lets a ray pass a corner that only the AABB covers', () => {
    const w = new PhysicsWorld(8);
    const box = w.addBox('b', { x: -1, y: 0, z: -1 }, { x: 1, y: 4, z: 1 }, {}, Math.PI / 4);
    // the line x + z = 2.4 crosses the AABB at (1.2, 1.2) but runs beside the diamond's edge
    expect(box.max.x).toBeGreaterThan(1.2);
    expect(box.max.z).toBeGreaterThan(1.2);
    const d = { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 };
    expect(w.raycast({ x: -2, y: 1, z: 4.4 }, d, 50)).toBeNull();
    // x + z = 1.3 is just inside it
    expect(w.raycast({ x: -2, y: 1, z: 3.3 }, d, 50)).not.toBeNull();
  });
});
