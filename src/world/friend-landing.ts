import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { makeBody, type PhysicsWorld, type Vec3Like } from '@/engine/physics/world';
import { WATER_LEVEL } from './wilderness/water-level';

/** Find dry, supported ground near a friend; never use their airborne height as a spawn. */
export function friendLanding(
  target: Vec3Like,
  physics: PhysicsWorld,
  heightAt: (x: number, z: number) => number,
  prepare: (x: number, z: number) => void = () => {},
): THREE.Vector3 | null {
  if (![target.x, target.y, target.z].every(Number.isFinite)) return null;
  const p = TUNING.player;
  const body = makeBody(new THREE.Vector3(), p.halfWidth, p.height);
  for (const radius of [2.4, 4, 7, 11, 18, 28, 40]) {
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8;
      const x = target.x + Math.cos(angle) * radius;
      const z = target.z + Math.sin(angle) * radius;
      const ground = heightAt(x, z);
      if (!Number.isFinite(ground)) continue;
      // Include neighbouring chunk colliders across the player's footprint, not just its centre.
      for (const dx of [-0.6, 0.6]) for (const dz of [-0.6, 0.6]) prepare(x + dx, z + dz);
      const top = Math.max(ground + 2, WATER_LEVEL + 3);
      const heights: number[] = [];
      for (const [dx, dz] of [
        [0, 0],
        [-0.45, -0.45],
        [-0.45, 0.45],
        [0.45, -0.45],
        [0.45, 0.45],
      ]) {
        const y = physics.groundBelow(x + dx!, top, z + dz!, 12);
        if (y !== null && Number.isFinite(y)) heights.push(y);
      }
      if (heights.length !== 5 || Math.min(...heights) < WATER_LEVEL + 0.15) continue;
      if (Math.max(...heights) - Math.min(...heights) > 0.4) continue;
      body.pos.set(x, Math.max(...heights) + 0.06, z);
      if (!physics.overlapsBody(body)) return body.pos.clone();
    }
  }
  return null;
}
