import { hashAt } from '../math/hash';
import { Rng } from '../math/rng';
import { WATER_LEVEL, type Wilderness } from './generator';
import { CURRENT_STEP, waterCurrentsOf } from './water-current';

export const DRIFT_CELL = 8;
export const DRIFT_STEP = 0.5;

/** Sample the same grid (and linear filter) used to draw the current. */
function surfaceVelocity(w: Wilderness, x: number, z: number) {
  const currents = waterCurrentsOf(w);
  const x0 = Math.floor(x / CURRENT_STEP) * CURRENT_STEP;
  const z0 = Math.floor(z / CURRENT_STEP) * CURRENT_STEP;
  const u = (x - x0) / CURRENT_STEP,
    v = (z - z0) / CURRENT_STEP;
  const a = currents.at(x0, z0),
    b = currents.at(x0 + CURRENT_STEP, z0);
  const c = currents.at(x0, z0 + CURRENT_STEP),
    d = currents.at(x0 + CURRENT_STEP, z0 + CURRENT_STEP);
  const blend = (k: 'x' | 'z') => (a[k] * (1 - u) + b[k] * u) * (1 - v) + (c[k] * (1 - u) + d[k] * u) * v;
  return { x: blend('x'), z: blend('z') };
}

export function riverDriftTrack(w: Wilderness, ix: number, iz: number) {
  const rng = new Rng(hashAt(w.seed, 'river-drift', ix, iz));
  let x = (ix + rng.next()) * DRIFT_CELL,
    z = (iz + rng.next()) * DRIFT_CELL;
  if (w.heightAt(x, z) > WATER_LEVEL - 0.16) return null;
  const actual = waterCurrentsOf(w).at(x, z);
  if (Math.hypot(actual.x, actual.z) < 0.15) return null;
  const points = [{ x, z }];
  const steps = rng.int(17, 29);
  for (let i = 0; i < steps; i++) {
    const velocity = surfaceVelocity(w, x, z);
    if (Math.hypot(velocity.x, velocity.z) < 0.12) break;
    x += velocity.x * DRIFT_STEP;
    z += velocity.z * DRIFT_STEP;
    if (Math.hypot(x - points[0]!.x, z - points[0]!.z) > 16) break;
    if (w.heightAt(x, z) > WATER_LEVEL - 0.16 || w.waterGuidesAt(x, z).basin >= 1) break;
    points.push({ x, z });
  }
  if (points.length < 5) return null;
  const duration = (points.length - 1) * DRIFT_STEP;
  const period = duration + rng.range(0.8, 3.5);
  return {
    points,
    duration,
    period,
    phase: rng.next() * period,
    twig: rng.chance(0.23),
    size: rng.range(0.8, 1.24),
    yaw: rng.range(0, 2 * Math.PI),
    spin: rng.range(-0.24, 0.24),
    tint: rng.int(0, 2),
  };
}
