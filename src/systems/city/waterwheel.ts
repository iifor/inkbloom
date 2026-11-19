import * as THREE from 'three';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { groundAt, type CityLayout } from '@/world/city/layout';
import { WATER_LEVEL } from '@/world/wilderness/water-level';

export interface MillBox {
  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
}

/** Separate moving machinery from its fixed, riverbed-founded support. Geometry is
 * wheel-local; collision boxes are world-space so the shared city physics owns them. */
export function buildWaterwheel(city: CityLayout) {
  if (!city.wheel) return null;
  const at = city.wheel,
    r = at.r;
  const rotor = new GeometryBuilder(),
    frame = new GeometryBuilder();
  const wood = color('bark'),
    plank = color('brown'),
    iron = color('charcoal');
  const matrix = new THREE.Matrix4(),
    turn = new THREE.Matrix4();
  const rim = new THREE.TorusGeometry(r, 0.13, 6, 32).rotateY(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.13, 2 * r - 0.12, 0.15);
  const paddle = new THREE.BoxGeometry(1.4, 0.56, 0.12);
  const axle = new THREE.CylinderGeometry(0.18, 0.18, 3.5, 10).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.36, 0.36, 0.22, 10).rotateZ(Math.PI / 2);
  for (const x of [-0.58, 0.58]) {
    rotor.meshSmooth(rim, matrix.makeTranslation(x, 0, 0), wood);
    for (let k = 0; k < 4; k++)
      rotor.mesh(
        spoke,
        matrix.makeTranslation(x, 0, 0).multiply(turn.makeRotationX((k * Math.PI) / 4)),
        plank,
      );
    rotor.meshSmooth(hub, matrix.makeTranslation(x * 1.18, 0, 0), wood);
  }
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI * 2) / 16;
    rotor.mesh(
      paddle,
      turn.makeRotationX(a).multiply(matrix.makeTranslation(0, r - 0.2, 0)),
      k % 3 ? wood : plank,
    );
  }
  rotor.meshSmooth(axle, matrix.identity(), wood);
  for (const g of [rim, spoke, paddle, axle, hub]) g.dispose();

  const boxes: MillBox[] = [];
  const origin = new THREE.Vector3(at.x, at.y, at.z);
  const box = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    tint: number,
    solid = true,
  ) => {
    const min = new THREE.Vector3(x - sx / 2, y - sy / 2, z - sz / 2);
    const max = new THREE.Vector3(x + sx / 2, y + sy / 2, z + sz / 2);
    frame.box(min, max, { px: tint, nx: tint, py: tint, ny: tint, pz: tint, nz: tint });
    if (solid) boxes.push({ min: min.clone().add(origin), max: max.clone().add(origin) });
  };
  const beam = (a: THREE.Vector3, b: THREE.Vector3, width: number) => {
    const geo = new THREE.BoxGeometry(width, a.distanceTo(b), width);
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
    frame.mesh(
      geo,
      matrix.compose(a.clone().add(b).multiplyScalar(0.5), rotation, new THREE.Vector3(1, 1, 1)),
      wood,
    );
    geo.dispose();
  };
  const water = WATER_LEVEL - at.y;
  const bed = (x: number, z: number) => groundAt(city, at.x + x, at.z + z) - at.y - 0.18;
  const plinth = water + 0.3;
  const deck = Math.max(water + 0.65, ...[-2.35, 0, 2.35].map((z) => bed(2.5, z) + 0.28));
  // Four masonry feet extend into the actual bed, even when the two banks differ in height.
  for (const x of [-1.18, 1.18]) {
    for (const z of [-1.15, 1.15]) {
      const bottom = bed(x, z),
        top = Math.max(plinth, bottom + 0.3);
      box(x, (bottom + top) / 2, z, 0.66, top - bottom, 0.78, color('rock'));
      const postTop = 0.14;
      if (top < postTop) box(x, (top + postTop) / 2, z, 0.25, postTop - top, 0.25, wood);
      beam(new THREE.Vector3(x, top, z), new THREE.Vector3(x, 0.12, 0), 0.19);
    }
    box(x, -0.18, 0, 0.4, 0.28, 2.85, wood);
    // A visible bearing block cradles the axle; a small metal strap sits over it.
    box(x, -0.08, 0, 0.42, 0.45, 0.62, plank);
    box(x, 0.19, 0, 0.48, 0.055, 0.62, iron, false);
  }
  // Low stone cheeks guide the existing river through the paddles. No fake water plane.
  for (const x of [-1.02, 1.02])
    for (let k = 0; k < 7; k++) {
      const z = (k - 3) * 0.94;
      const bottom = bed(x, z),
        top = Math.max(water + 0.12, bottom + 0.16);
      box(x, (bottom + top) / 2, z, 0.36, top - bottom, 0.9, k % 2 ? color('stone') : color('rock'));
    }
  // Narrow maintenance deck outside the moving rim, with piles and an outer handrail.
  for (let k = 0; k < 12; k++) box(1.99, deck, (k - 5.5) * 0.43, 1.2, 0.14, 0.405, k % 3 ? plank : wood);
  for (const z of [-2.35, 0, 2.35]) {
    const bottom = bed(2.5, z);
    box(2.5, (bottom + deck + 0.95) / 2, z, 0.16, deck + 0.95 - bottom, 0.16, wood);
  }
  box(2.5, deck + 0.9, 0, 0.12, 0.14, 5.05, wood);
  box(2.5, deck + 0.43, 0, 0.08, 0.09, 5.05, wood);
  // Conservative stationary collision envelope for the moving machinery.
  boxes.push({
    min: new THREE.Vector3(-0.79, -r, -r).add(origin),
    max: new THREE.Vector3(0.79, r, r).add(origin),
  });
  return { rotor: rotor.build(), frame: frame.build(), boxes };
}
