import type { Body, Vec3Like } from './world';

/** Centre spacing for two people, including room for shoulders and clothing. */
export const PERSON_SPACING = 0.84;

/** Does this horizontal segment move closer to, and enter, the other person's footprint? */
export function entersPerson(x: number, z: number, dx: number, dz: number): boolean {
  const toward = -(x * dx + z * dz);
  if (toward <= 0) return false;
  const t = Math.min(1, toward / (dx * dx + dz * dz));
  return (x + t * dx) ** 2 + (z + t * dz) ** 2 < PERSON_SPACING ** 2;
}

/** Adjust the proposed velocity before terrain physics so contact still respects solid walls. */
export function avoidPerson(
  b: Body,
  x: number,
  y: number,
  z: number,
  height: number,
  dt: number,
  side = 1,
): void {
  if (dt <= 0 || b.pos.y >= y + height || b.pos.y + b.height <= y) return;
  const rx = b.pos.x - x,
    rz = b.pos.z - z;
  const distance = Math.hypot(rx, rz);
  if (distance >= PERSON_SPACING && !entersPerson(rx, rz, b.vel.x * dt, b.vel.z * dt)) return;
  const nx = distance > 1e-6 ? rx / distance : side;
  const nz = distance > 1e-6 ? rz / distance : 0;
  const required = Math.min(5, (PERSON_SPACING - distance) / dt);
  const correction = required - (b.vel.x * nx + b.vel.z * nz);
  if (correction > 0) {
    b.vel.x += nx * correction;
    b.vel.z += nz * correction;
  }
}

export function pathBlockedByPerson(from: Vec3Like, to: Vec3Like, other: Vec3Like): boolean {
  return (
    Math.abs(to.y - other.y) < 1.65 &&
    entersPerson(from.x - other.x, from.z - other.z, to.x - from.x, to.z - from.z)
  );
}
