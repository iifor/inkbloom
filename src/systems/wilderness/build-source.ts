// A pigment source as a small always-coloured mesh: a base (bush, rock, reeds, flowers) with
// accents in the pigment's colour. Each source is its own mesh so it can be hidden when
// harvested and shown again when it grows back.
import * as THREE from 'three';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { dropGeometry, lumpGeometry } from '@/engine/render/soft-shapes';
import { Rng } from '@/world/math/rng';
import { hashString } from '@/world/math/hash';
import type { PigmentSource } from '@/world/wilderness/sources';

import type { Wilderness } from '@/world/wilderness/generator';
import { addPigmentFlowers } from './pigment-flowers';
import { addPigmentBerries } from './pigment-berries';
import { buildPigmentReeds } from './pigment-reeds';

// a drop stood on end makes a rounded crystal
const crystal = dropGeometry();

export function buildSource(src: PigmentSource, ground: Wilderness['heightAt']): THREE.BufferGeometry {
  const def = PIGMENT_SOURCES[src.kind]!;
  const rng = new Rng(hashString(src.id));
  if (def.key === 'reeds') return buildPigmentReeds(src, ground, rng);
  const g = new GeometryBuilder();
  const m = new THREE.Matrix4();
  const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rot = 0): THREE.Matrix4 =>
    m.compose(
      new THREE.Vector3(src.x + x, src.y + y, src.z + z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
      new THREE.Vector3(sx, sy, sz),
    );
  switch (def.key) {
    case 'flowers':
      addPigmentFlowers(g, src, ground, rng);
      break;
    case 'berries':
      addPigmentBerries(g, src, ground, rng);
      break;
    case 'ore':
      g.meshSmooth(
        lumpGeometry(hashString(src.id)),
        at(0, 0.6, 0, 1.5, 1.1, 1.3, rng.next()),
        def.base,
        ALWAYS_COLOR,
      );
      for (let i = 0; i < 4; i++) {
        const a = rng.range(0, Math.PI * 2);
        g.meshSmooth(
          crystal,
          at(Math.cos(a) * 0.9, 1 + rng.range(0, 0.6), Math.sin(a) * 0.9, 0.36, 0.9, 0.36, a),
          src.color,
          ALWAYS_COLOR,
        );
      }
      break;
    case 'shells':
      for (let i = 0; i < 7; i++) {
        const x = rng.range(-1.3, 1.3),
          z = rng.range(-1, 1),
          yaw = rng.next() * Math.PI * 2;
        const ox = src.x + x,
          oz = src.z + z,
          y = ground(ox, oz) + 0.04,
          size = rng.range(0.4, 0.78);
        const hinge = new THREE.Vector3(ox, y, oz);
        const rim = (rib: number) => {
          const a = yaw + (rib - 4) * 0.29;
          return new THREE.Vector3(
            ox + size * Math.sin(a),
            y + size * (rib % 2 ? 0.35 : 0.21),
            oz + size * Math.cos(a),
          );
        };
        for (let rib = 0; rib < 8; rib++) {
          const left = rim(rib),
            right = rim(rib + 1);
          const normal = left.clone().sub(hinge).cross(right.clone().sub(hinge)).normalize();
          g.quad(hinge, left, right, right, normal, rib % 2 ? src.color : def.base, ALWAYS_COLOR);
        }
      }
      break;
    default:
      g.meshSmooth(lumpGeometry(hashString(src.id)), at(0, 0.6, 0, 1, 1, 1), src.color, ALWAYS_COLOR);
  }
  return g.build();
}
