import { Vector3 } from 'three';
import type { Box, PhysicsWorld, Vec3Like } from '@/engine/physics/world';
import { pathBlockedByPerson, PERSON_SPACING } from '@/engine/physics/character-contact';
import type { NpcFighter } from '@/systems/combat/npc-combat';

// Try the straight route first, then progressively wider turns on either side.
const turns = [0, 25, -25, 50, -50, 75, -75, 95, -95].map((d) => (d * Math.PI) / 180);
const sole = 0.16;
const min = new Vector3(),
  max = new Vector3(),
  next = new Vector3();
const boxes: Box[] = [];

export function footHeight(physics: PhysicsWorld, x: number, ground: number, z: number): number {
  min.set(x - sole, ground - 0.05, z - sole);
  max.set(x + sole, Infinity, z + sole);
  let y = ground;
  for (const b of physics.query(min, max, boxes)) if (b.data.tag === 'walk-surface') y = Math.max(y, b.max.y);
  return y;
}

function hasRoom(physics: PhysicsWorld, x: number, y: number, z: number): boolean {
  min.set(x - 0.28, y + 0.06, z - 0.28);
  max.set(x + 0.28, y + 1.6, z + 0.28);
  return physics.query(min, max, boxes).every((b) => b.data.tag === 'walk-surface');
}

/** Follow the scheduled route at walking speed, steering the visible body around occupied space. */
export function walkNpc(
  fighter: NpcFighter,
  goal: { x: number; z: number },
  ground: (x: number, z: number) => number,
  visitors: readonly Vec3Like[],
  dt: number,
): number | undefined {
  const at = fighter.position,
    physics = fighter.physics;
  const dx = goal.x - at.x,
    dz = goal.z - at.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-5 || dt <= 0) return;
  const step = Math.min(length, 2.8 * dt);
  const heading = Math.atan2(dx, dz);
  for (const turn of turns) {
    const yaw = heading + turn;
    next.set(at.x + Math.sin(yaw) * step, at.y, at.z + Math.cos(yaw) * step);
    next.y = footHeight(physics, next.x, ground(next.x, next.z), next.z);
    if (Math.abs(next.y - at.y) > 0.55) continue;
    if (visitors.some((v) => pathBlockedByPerson(at, next, v))) continue;
    let blocked = false;
    for (const person of fighter.battles.people) {
      if (
        person !== fighter &&
        person.physics === physics &&
        person.alive &&
        pathBlockedByPerson(at, next, person.position)
      ) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    if (!hasRoom(physics, next.x, next.y, next.z)) continue;
    // Check beyond the first sidestep: a narrow gap between a person and a wall can
    // admit the first few centimetres without having enough space for a body to pass.
    if (turn !== 0) {
      const x = next.x + Math.sin(yaw) * PERSON_SPACING;
      const z = next.z + Math.cos(yaw) * PERSON_SPACING;
      const y = footHeight(physics, x, ground(x, z), z);
      if (
        !hasRoom(physics, x, y, z) ||
        !hasRoom(physics, (next.x + x) / 2, (next.y + y) / 2, (next.z + z) / 2)
      )
        continue;
    }
    at.copy(next);
    return yaw;
  }
}
