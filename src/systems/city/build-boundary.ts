import { color } from '@/content/palette';
import * as THREE from 'three';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { boundarySpans } from '@/world/city/boundary';
import { groundAt, type CityLayout } from '@/world/city/layout';
import { hashAt, unit } from '@/world/math/hash';
import type { CityTile, ColliderSink } from './build-city';

/** Merged into the existing district meshes; no materials, meshes or per-frame work added. */
export function buildBoundary(
  city: CityLayout,
  tileAt: (x: number, z: number) => CityTile,
  physics: ColliderSink,
): void {
  for (const span of boundarySpans(city)) {
    const { x, z, tx, tz, length, ix, iz } = span;
    const tile = tileAt(x, z);
    const angle = Math.atan2(-tz, tx);
    const transform = new THREE.Matrix4().makeRotationY(angle).setPosition(x, 0, z);
    const point = (u: number, v: number, y: number) => ({
      x: x + tx * u - tz * v,
      y,
      z: z + tz * u + tx * v,
    });
    const ground = (u: number) => {
      const p = point(u, 0, 0);
      return groundAt(city, p.x, p.z);
    };
    const box = (
      g: GeometryBuilder,
      u0: number,
      u1: number,
      half: number,
      y0: number,
      y1: number,
      tint: number,
    ) => {
      const part = new GeometryBuilder();
      part.box(
        { x: u0, y: y0, z: -half },
        { x: u1, y: y1, z: half },
        { px: tint, nx: tint, py: tint, ny: tint, pz: tint, nz: tint },
      );
      g.append(part, transform);
    };
    const both = (u0: number, u1: number, half: number, y0: number, y1: number, tint: number) => {
      box(tile.full, u0, u1, half, y0, y1, tint);
      box(tile.far, u0, u1, half, y0, y1, tint);
    };
    const lo = -length / 2;
    const hi = length / 2;
    const collider = (half: number, y0: number, y1: number) =>
      physics.addBox(
        `city:${city.id}`,
        { x: x + lo, y: y0, z: z - half },
        { x: x + hi, y: y1, z: z + half },
        {},
        angle,
      );
    const base = Math.min(ground(lo), ground(0), ground(hi));
    const topGround = Math.max(ground(lo), ground(0), ground(hi));
    const h = unit(hashAt(city.seed, 'boundary-detail', ix, iz));
    if (city.boundary === 'fence') {
      // Weathered timber, two rails and upright posts; open space between them remains visible.
      const timber = color('bark');
      for (const u of [lo, 0, hi]) {
        const y = ground(u);
        both(u - 0.085, u + 0.085, 0.1, y - 0.25, y + 1.22 + h * 0.08, timber);
      }
      // Short stepped rails follow slopes instead of stretching a tall solid slab across them.
      for (const [a, b] of [
        [lo, 0],
        [0, hi],
      ]) {
        const y = ground((a! + b!) / 2);
        for (const lift of [0.48, 0.96])
          both(a!, b!, 0.065, y + lift - 0.065, y + lift + 0.065, color('brown'));
      }
      // One thin collider per span keeps walking/camera collision cheap and aligned with the rails.
      collider(0.1, base - 0.25, topGround + 1.25);
    } else if (city.boundary === 'wall') {
      // Warm limewash, a stone footing and a dark coping: distinct from exposed masonry.
      const top = topGround + 1.8;
      both(lo, hi, 0.28, base - 0.35, topGround + 0.3, color('rock'));
      both(lo, hi, 0.24, topGround + 0.22, top, color('limewash'));
      both(lo, hi, 0.34, top, top + 0.12, color('slateTile'));
      if ((ix + iz) % 2 === 0) {
        both(-0.21, 0.21, 0.36, base - 0.25, top + 0.12, color('limewash'));
        both(-0.27, 0.27, 0.4, top + 0.12, top + 0.24, color('slateTile'));
      }
      collider(0.4, base - 0.35, top + 0.24);
    } else {
      // Low dry-stone courses, with offset joints and slight depth/colour differences.
      const top = topGround + 1.55;
      box(tile.far, lo, hi, 0.48, base - 0.35, top, color('rock'));
      for (let row = 0; row < 3; row++) {
        const bottom = row === 0 ? base - 0.35 : topGround + row * 0.5;
        const endY = topGround + (row + 1) * 0.5;
        const width = 1.35;
        for (let u = lo - (row % 2) * width * 0.5; u < hi; u += width) {
          const a = Math.max(lo, u);
          const b = Math.min(hi, u + width);
          if (b - a < 0.05) continue;
          const stone = unit(hashAt(city.seed, 'boundary-stone', ix, iz, row, Math.round(u * 100)));
          box(
            tile.full,
            a + 0.012,
            b - 0.012,
            0.43 + stone * 0.05,
            bottom,
            endY - 0.012,
            color(stone < 0.2 ? 'stone' : 'rock'),
          );
        }
      }
      both(lo, hi, 0.5, top - 0.05, top + 0.08, color('rock'));
      collider(0.5, base - 0.35, top + 0.08);
    }
  }
}
