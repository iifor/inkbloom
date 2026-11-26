import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { PhysicsWorld, makeBody } from '@/engine/physics/world';
import { avoidPerson, PERSON_SPACING } from '@/engine/physics/character-contact';
import { footHeight, walkNpc } from '@/systems/figures/npc-walking';
import { NpcBattles, NpcFighter } from '@/systems/combat/npc-combat';
import { NpcAttention } from '@/world/npc-attention';

const dt = 1 / 60;
const flat = () => 0;

it('separates coincident players, stops a dash and allows sliding and passing on another floor', () => {
  const world = new PhysicsWorld(4);
  const a = makeBody(new Vector3(), 0.35, 1.8);
  const b = makeBody(new Vector3(), 0.35, 1.8);
  for (let i = 0; i < 30; i++) {
    a.vel.set(0, 0, 0);
    b.vel.set(0, 0, 0);
    avoidPerson(a, b.pos.x, 0, 0, 1.8, dt, -1);
    avoidPerson(b, a.pos.x, 0, 0, 1.8, dt, 1);
    world.moveBody(a, dt);
    world.moveBody(b, dt);
  }
  expect(b.pos.x - a.pos.x).toBeGreaterThanOrEqual(PERSON_SPACING - 1e-6);
  a.pos.set(-2, 0, 0);
  a.vel.set(100, 0, 1);
  avoidPerson(a, 0, 0, 0, 1.8, 0.05);
  world.moveBody(a, 0.05);
  expect(a.pos.x).toBeCloseTo(-PERSON_SPACING);
  expect(a.pos.z).toBeCloseTo(0.05);
  a.vel.x = 10;
  avoidPerson(a, 0, 2, 0, 1.8, dt);
  expect(a.vel.x).toBe(10);
});

it('watches a blocking player, walks around them and rejoins its route', () => {
  const physics = new PhysicsWorld(4);
  const npc = new NpcFighter(new NpcBattles(), physics, new Vector3(-2, 0, 0));
  const visitor = { id: 1, x: 0, y: 0, z: 0, eyeY: 1.6 };
  const attention = new NpcAttention();
  let watched = 0,
    widest = 0,
    nearest = Infinity;
  for (let i = 0; i < 600; i++) {
    const t = i * dt;
    const goal = { x: Math.min(4, -2 + 1.5 * attention.time(t)), z: 0 };
    if (!attention.target) walkNpc(npc, goal, flat, [visitor], dt);
    attention.update(t, dt, npc.position, [visitor], () => true, Math.PI / 2);
    if (attention.target) watched += dt;
    widest = Math.max(widest, Math.abs(npc.position.z));
    nearest = Math.min(nearest, npc.position.length());
  }
  expect(watched).toBeGreaterThan(3);
  expect(nearest).toBeGreaterThanOrEqual(PERSON_SPACING - 1e-6);
  expect(widest).toBeGreaterThan(0.8);
  expect(npc.position.x).toBeCloseTo(4);
  expect(npc.position.z).toBeCloseTo(0);
});

it('places feet on rotated treads and ignores the wall and roof beside them', () => {
  const physics = new PhysicsWorld(4);
  physics.addBox('house', { x: -1, y: -1, z: -0.5 }, { x: 1, y: 1.2, z: 0.5 }, { tag: 'walk-surface' }, 0.6);
  physics.addBox('house', { x: -1, y: 2, z: -1 }, { x: 1, y: 3, z: 1 });
  expect(footHeight(physics, 0, 0, 0)).toBe(1.2);
  expect(footHeight(physics, 2, 0.2, 0)).toBe(0.2);
});

it.each([-1, 1])('takes the open side of a player beside a wall (%i)', (sign) => {
  const physics = new PhysicsWorld(4);
  const z = sign * 0.65;
  physics.addBox('wall', { x: -5, y: 0, z: z - 0.1 }, { x: 5, y: 3, z: z + 0.1 });
  const npc = new NpcFighter(new NpcBattles(), physics, new Vector3(-2, 0, 0));
  for (let i = 0; i < 480; i++) {
    walkNpc(npc, { x: Math.min(3, -2 + i * dt * 1.6), z: 0 }, flat, [{ x: 0, y: 0, z: 0 }], dt);
    expect(npc.position.length()).toBeGreaterThanOrEqual(PERSON_SPACING - 1e-6);
    expect(npc.position.z * sign).toBeLessThan(0.28);
  }
  expect(npc.position.x).toBeCloseTo(3);
});
