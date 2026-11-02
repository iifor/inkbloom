// A pigment source as a small always-coloured mesh: a base (bush, rock, reeds, flowers) with
// accents in the pigment's colour. Each source is its own mesh so it can be hidden when
// harvested and shown again when it grows back.
import * as THREE from 'three';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { Rng } from '@/world/math/rng';
import { hashString } from '@/world/math/hash';
import type { PigmentSource } from '@/world/wilderness/sources';

const ico = new THREE.IcosahedronGeometry(1, 0);
const cube = new THREE.BoxGeometry(1, 1, 1);

export function buildSource(src: PigmentSource): THREE.BufferGeometry {
  const def = PIGMENT_SOURCES[src.kind]!;
  const g = new GeometryBuilder();
  const rng = new Rng(hashString(src.id));
  const m = new THREE.Matrix4();
  const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rot = 0): THREE.Matrix4 =>
    m.compose(
      new THREE.Vector3(src.x + x, src.y + y, src.z + z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
      new THREE.Vector3(sx, sy, sz),
    );
  switch (def.key) {
    case 'flowers':
      for (let i = 0; i < 9; i++) {
        const x = rng.range(-1.6, 1.6);
        const z = rng.range(-1.6, 1.6);
        g.mesh(cube, at(x, 0.35, z, 0.08, 0.7, 0.08), def.base, ALWAYS_COLOR);
        g.mesh(ico, at(x, 0.75, z, 0.28, 0.2, 0.28), src.color, ALWAYS_COLOR);
      }
      break;
    case 'berries':
      g.mesh(ico, at(0, 0.8, 0, 1.4, 1, 1.4, rng.next()), def.base, ALWAYS_COLOR);
      for (let i = 0; i < 7; i++) {
        const a = rng.range(0, Math.PI * 2);
        g.mesh(
          ico,
          at(Math.cos(a) * 1.25, rng.range(0.5, 1.4), Math.sin(a) * 1.25, 0.22, 0.22, 0.22),
          src.color,
          ALWAYS_COLOR,
        );
      }
      break;
    case 'ore':
      g.mesh(ico, at(0, 0.6, 0, 1.5, 1.1, 1.3, rng.next()), def.base, ALWAYS_COLOR);
      for (let i = 0; i < 4; i++) {
        const a = rng.range(0, Math.PI * 2);
        g.mesh(
          cube,
          at(Math.cos(a) * 0.9, 1 + rng.range(0, 0.6), Math.sin(a) * 0.9, 0.3, 0.9, 0.3, a),
          src.color,
          ALWAYS_COLOR,
        );
      }
      break;
    case 'reeds':
      for (let i = 0; i < 12; i++) {
        const x = rng.range(-1.3, 1.3);
        const z = rng.range(-1.3, 1.3);
        const h = rng.range(1.2, 2.2);
        g.mesh(cube, at(x, h / 2, z, 0.07, h, 0.07), def.base, ALWAYS_COLOR);
        g.mesh(cube, at(x, h, z, 0.16, 0.4, 0.16), src.color, ALWAYS_COLOR);
      }
      break;
    default:
      g.mesh(ico, at(0, 0.6, 0, 1, 1, 1), src.color, ALWAYS_COLOR);
  }
  return g.build();
}
