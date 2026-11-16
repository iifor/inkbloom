// A wayside house marks the entrance to each village. The front door faces the first approach.
import * as THREE from 'three';
import { LANDMARKS } from '@/content/templates';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { Entrance } from '@/world/wilderness/generator';
import { buildCountryHouse } from '../city/country-house';

export function buildLandmark(e: Entrance, g: GeometryBuilder, physics: PhysicsWorld, group: string) {
  const tpl = LANDMARKS[e.landmark]!;
  const [dx, dz] = e.door;
  const hx = (dx ? tpl.depth : tpl.width) / 2,
    hz = (dz ? tpl.depth : tpl.width) / 2;
  buildCountryHouse(
    g,
    {
      x0: e.x - hx,
      x1: e.x + hx,
      z0: e.z - hz,
      z1: e.z + hz,
      base: e.y - 0.1,
      height: tpl.height,
      front: dx > 0 ? 'px' : dx < 0 ? 'nx' : dz > 0 ? 'pz' : 'nz',
      doorAt: dx ? e.z : e.x,
      style: tpl.style,
      plaster: tpl.plaster,
      tile: tpl.tile,
      doorColor: tpl.door,
    },
    (min, max) => physics.addBox(group, min, max),
  );
  const offset = tpl.depth / 2 + 2.5;
  return { doorPos: new THREE.Vector3(e.x + dx * offset, e.y, e.z + dz * offset) };
}
