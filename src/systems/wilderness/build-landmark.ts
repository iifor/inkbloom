// City entrance landmark from a LandmarkTemplate. Stacked tiers, optional spire, a door on the
// face pointing at the world origin. Colours follow the derived drain, so the landmark of an
// unrestored city is drawn in graphite.
import * as THREE from 'three';
import { LANDMARKS } from '@/content/templates';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PhysicsWorld } from '@/engine/physics/world';
import { Rng } from '@/world/math/rng';
import type { Entrance } from '@/world/wilderness/generator';
import { color } from '@/content/palette';

export interface LandmarkResult {
  /** Point in front of the door, at ground level. */
  readonly doorPos: THREE.Vector3;
  readonly height: number;
}

export function buildLandmark(
  e: Entrance,
  g: GeometryBuilder,
  physics: PhysicsWorld,
  group: string,
): LandmarkResult {
  const tpl = LANDMARKS[e.landmark]!;
  const rng = new Rng(e.seed);
  const tiers = rng.int(tpl.tiers.min, tpl.tiers.max);
  const body = rng.pick(tpl.body);
  const trim = rng.pick(tpl.trim);
  let width = rng.range(tpl.baseWidth.min, tpl.baseWidth.max);
  const hw0 = width / 2;
  let y = e.y;
  const all = { px: body, nx: body, py: trim, pz: body, nz: body };
  for (let t = 0; t < tiers; t++) {
    const th = rng.range(tpl.tierHeight.min, tpl.tierHeight.max);
    const hw = width / 2;
    const min = { x: e.x - hw, y, z: e.z - hw };
    const max = { x: e.x + hw, y: y + th, z: e.z + hw };
    g.box(min, max, all);
    // a trim band at the top of each tier
    g.box(
      { x: min.x - 0.3, y: max.y - 0.6, z: min.z - 0.3 },
      { x: max.x + 0.3, y: max.y, z: max.z + 0.3 },
      { px: trim, nx: trim, pz: trim, nz: trim, py: trim, ny: trim },
    );
    physics.addBox(group, min, max);
    y += th;
    width *= tpl.shrink;
  }
  if (tpl.spire) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(e.x, y + width * 0.9, e.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
      new THREE.Vector3(width * 0.72, width * 1.8, width * 0.72),
    );
    g.mesh(new THREE.ConeGeometry(1, 1, 4, 1), m, trim);
    y += width * 1.8;
  }
  // door on the base face
  const [dx, dz] = e.door;
  const fx = e.x + dx * (hw0 + 0.05);
  const fz = e.z + dz * (hw0 + 0.05);
  const doorColor = color('brown');
  const dw = 1.4;
  const dh = 3.2;
  const n = { x: dx, y: 0, z: dz };
  if (dx !== 0)
    g.quad(
      { x: fx, y: e.y, z: fz + dw * dx },
      { x: fx, y: e.y, z: fz - dw * dx },
      { x: fx, y: e.y + dh, z: fz - dw * dx },
      { x: fx, y: e.y + dh, z: fz + dw * dx },
      n,
      doorColor,
    );
  else
    g.quad(
      { x: fx - dw * dz, y: e.y, z: fz },
      { x: fx + dw * dz, y: e.y, z: fz },
      { x: fx + dw * dz, y: e.y + dh, z: fz },
      { x: fx - dw * dz, y: e.y + dh, z: fz },
      n,
      doorColor,
    );
  return {
    doorPos: new THREE.Vector3(e.x + dx * (hw0 + 2.5), e.y, e.z + dz * (hw0 + 2.5)),
    height: y - e.y,
  };
}
