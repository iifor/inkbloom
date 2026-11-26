import { expect, it } from 'vitest';
import { NpcAttention, attentionYaw, type Visitor } from '@/world/npc-attention';
import { planOuting, residentPose } from '@/world/city/resident-routine';
import { TravellerRoutine, type Journey } from '@/world/wilderness/travellers';
import { NpcVisitors } from '@/systems/figures/npc-visitors';
import { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { Vector3 } from 'three';

const at = { x: 0, y: 0, z: 0 };
const person = (x = 0.5, id = 1): Visitor => ({ id, x, y: 0, z: 0, eyeY: 1.6 });
const visible = () => true;

it('collects local and remote visitors but ignores flight, and respects actual wall colliders', () => {
  const physics = new PhysicsWorld(8);
  const ctx = {
    player: { position: new Vector3(0, 0, 2), eye: new Vector3(0, 1.65, 2), flying: false },
    combat: { alive: true },
    scenes: { active: { physics } },
    net: { me: 1, npcVisitors: (out: Visitor[]) => out.push(person(2, 2)) },
  } as unknown as GameContext;
  const visitors = new NpcVisitors(ctx);
  visitors.update();
  expect(visitors.people.map((v) => v.id)).toEqual([1, 2]);
  const origin = new Vector3();
  expect(visitors.canSee(origin, visitors.people[0]!)).toBe(true);
  physics.addBox('wall', { x: -1, y: 0, z: 0.9 }, { x: 1, y: 3, z: 1.1 });
  expect(visitors.canSee(origin, visitors.people[0]!)).toBe(false);
  physics.removeGroup('wall');
  physics.addBox('glass', { x: -1, y: 0, z: 0.9 }, { x: 1, y: 3, z: 1.1 }, { seeThrough: true });
  expect(visitors.canSee(origin, visitors.people[0]!)).toBe(true);
  ctx.player.flying = true;
  visitors.update();
  expect(visitors.people.map((v) => v.id)).toEqual([2]);
});

it('pauses a walking routine briefly and resumes from its previous position', () => {
  const home = { ...at, seed: 1, angle: 0 };
  const trip = planOuting(
    {
      grid: { cell: 1, walkable: () => true },
      ground: () => 0,
      sites: { guard: [{ x: 30, z: 0 }], mage: [], villager: [], woodcutter: [] },
      streets: [],
    },
    home,
    'guard',
    0,
  );
  const attention = new NpcAttention();
  const before = residentPose(home, 'guard', trip, 8);
  expect(before.motion).toBe('walk');
  attention.update(8, 0.016, at, [person()], visible, Math.PI / 2);
  for (let i = 1; i <= 10; i++) attention.update(8 + i * 0.1, 0.1, at, [person()], visible, Math.PI / 2);
  expect(residentPose(home, 'guard', trip, attention.time(9))).toEqual(before);
  attention.update(9.1, 0.1, at, [], visible);
  expect(attention.target).toBeUndefined();
  expect(residentPose(home, 'guard', trip, attention.time(9.1))).toEqual(before);
  const after = residentPose(home, 'guard', trip, attention.time(9.2));
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeCloseTo(0.21);
});

it('ignores proximity, notices a body contact, and cannot be held indefinitely by standing nearby', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const a = new NpcAttention();
    a.update(0, dt, at, [person(2)], visible);
    expect(a.target).toBeUndefined();
    a.update(dt, dt, at, [person()], visible, Math.PI / 2);
    expect(a.target?.id).toBe(1);
    for (let t = 2 * dt; t < 8; t += dt) a.update(t, dt, at, [person()], visible, Math.PI / 2);
    expect(a.target).toBeUndefined();
    a.update(8, dt, at, [person(1)], visible);
    a.update(8 + dt, dt, at, [person()], visible);
    expect(a.target?.id).toBe(1);
  }
});

it('releases after losing sight, and requires a fresh contact after cooldown', () => {
  const a = new NpcAttention();
  a.update(0, 0.2, at, [person()], visible, Math.PI / 2);
  for (let i = 1; i <= 5; i++) a.update(i * 0.2, 0.2, at, [person(2)], visible, Math.PI / 2);
  expect(a.target?.id).toBe(1);
  for (let i = 6; i <= 9; i++) a.update(i * 0.2, 0.2, at, [person(2)], () => false, Math.PI / 2);
  expect(a.target).toBeUndefined();
  a.update(2, 0.2, at, [person()], visible);
  expect(a.target).toBeUndefined();
  a.update(6, 4, at, [person()], visible);
  expect(a.target).toBeUndefined();
  a.update(6.2, 0.2, at, [person(1)], visible);
  a.update(6.4, 0.2, at, [person()], visible);
  expect(a.target?.id).toBe(1);
});

it('allows a turn toward a bump from behind but stops tracking outside the view cone', () => {
  const a = new NpcAttention();
  const behind = { ...person(), x: 0, z: -0.5 };
  a.update(0, 0.2, at, [behind], visible, 0);
  expect(a.target).toBeDefined();
  for (let i = 1; i <= 4; i++) a.update(i * 0.2, 0.2, at, [behind], visible, 0);
  expect(a.target).toBeDefined();
  for (let i = 5; i <= 9; i++) a.update(i * 0.2, 0.2, at, [behind], visible, 0);
  expect(a.target).toBeUndefined();
});
it('does not notice people through walls or on another floor, and unload stops the pause', () => {
  const a = new NpcAttention();
  a.update(1, 0.2, at, [person()], () => false);
  expect(a.target).toBeUndefined();
  a.update(2, 1, at, [{ ...person(), y: 3, eyeY: 4.6 }], visible);
  expect(a.target).toBeUndefined();
  a.update(2.5, 0.5, at, [], visible);
  a.update(3, 0.5, at, [person()], visible);
  a.release(5);
  expect(a.time(9)).toBe(7);
});

it('turns through the shortest arc with the same speed limit at different frame rates', () => {
  const start = Math.PI - 0.01,
    target = -Math.PI + 0.1;
  expect(attentionYaw(start, target, 1 / 60)).toBeGreaterThan(start);
  for (const dt of [1 / 30, 1 / 60, 1 / 144])
    expect(Math.abs(attentionYaw(0, Math.PI, dt))).toBeLessThanOrEqual(2.8 * dt);
});

it('holds a traveller when a new destination arrives and resumes without snapping', () => {
  const j: Journey = {
    trail: { id: 'road', pts: [0, 0, 100, 0], width: 2, bridges: [], minX: 0, minZ: 0, maxX: 100, maxZ: 0 },
    lengths: new Float64Array([0, 100]),
    speed: 2,
    rest: 12,
    offset: 0,
  };
  const routine = new TravellerRoutine(j);
  const initial = routine.pose(5);
  expect(initial.x).toBe(10);
  routine.attention.update(5, 0.1, { x: 10, y: 0, z: 0 }, [person(10.5)], visible);
  const plan = { at: 15, from: 30, to: 70, origin: 0 };
  expect(routine.pose(15, plan).x).toBe(initial.x);
  routine.attention.release(20);
  expect(routine.pose(20, plan).x).toBe(initial.x);
  expect(routine.pose(20.1, plan).x).toBeCloseTo(10.2);
});
