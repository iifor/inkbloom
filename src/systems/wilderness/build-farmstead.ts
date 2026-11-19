import { color } from '@/content/palette';
import { BUILDINGS } from '@/content/templates';
import type { ColliderData, Vec3Like } from '@/engine/physics/world';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import { hashInts } from '@/world/math/hash';
import type { Farmstead } from '@/world/wilderness/farmsteads';
import type { Wilderness } from '@/world/wilderness/generator';
import { buildCountryHouse } from '@/systems/city/country-house';
import { appendClosedFarmDoor, type FarmDoor } from './farm-door';

type BoxSink = (min: Vec3Like, max: Vec3Like, data?: ColliderData) => void;
const rock = color('rock');
const wood = color('bark');
const rail = color('brown');
const v = (x: number, y: number, z: number) => ({ x, y, z });
const faces = (c: number) => ({ px: c, nx: c, py: c, ny: c, pz: c, nz: c });

export function buildFarmstead(
  g: GeometryBuilder,
  w: Pick<Wilderness, 'heightAt'>,
  yard: Farmstead,
  collide: BoxSink,
  addDoor: (door: FarmDoor) => void = (door) => appendClosedFarmDoor(g, door),
): void {
  const solid = (min: Vec3Like, max: Vec3Like, tint: number): void => {
    g.box(min, max, faces(tint));
    collide(min, max);
  };
  for (const [i, b] of yard.buildings.entries()) {
    const template = b.barn ? BUILDINGS[2] : BUILDINGS[0];
    const pick = (values: readonly number[], salt: number) =>
      values[hashInts(yard.seed, i, salt) % values.length]!;
    const x0 = b.x - b.hw,
      x1 = b.x + b.hw;
    const z0 = b.z - b.hd,
      z1 = b.z + b.hd;
    const doorColor = pick(template.doors, 3);
    solid(v(x0 - 0.2, b.foot, z0 - 0.2), v(x1 + 0.2, b.base, z1 + 0.2), rock);
    buildCountryHouse(
      g,
      {
        x0,
        x1,
        z0,
        z1,
        base: b.base,
        foot: b.foot,
        enterable: true,
        height: b.height,
        front: yard.front === 1 ? 'pz' : 'nz',
        doorAt: b.x,
        style: template.key,
        plaster: b.barn ? rail : pick(template.walls, 1),
        tile: pick(template.roofs, 2),
        doorColor,
      },
      collide,
    );
    const frontZ = b.z + yard.front * b.hd;
    addDoor({ x: b.x, y: b.base, z: frontZ, front: yard.front, tint: doorColor });
    g.box(v(x0 + 0.19, b.base - 0.025, z0 + 0.19), v(x1 - 0.19, b.base + 0.025, z1 - 0.19), faces(rail));
    for (let k = 1; k < Math.floor((x1 - x0 - 0.38) / 0.34); k++) {
      const seam = x0 + 0.19 + k * 0.34;
      g.box(v(seam, b.base + 0.024, z0 + 0.19), v(seam + 0.01, b.base + 0.027, z1 - 0.19), faces(wood));
    }
    // A bench or a pair of crates beside the back wall leaves the entrance clear.
    const back = b.z - yard.front * (b.hd - 0.65);
    if (b.barn) {
      for (const offset of [-0.85, 0.85])
        solid(
          v(b.x + offset - 0.46, b.base, back - 0.39),
          v(b.x + offset + 0.46, b.base + (offset < 0 ? 0.78 : 0.59), back + 0.39),
          rail,
        );
    } else {
      solid(v(b.x - 1.04, b.base + 0.43, back - 0.28), v(b.x + 1.04, b.base + 0.54, back + 0.28), rail);
      for (const x of [b.x - 0.88, b.x + 0.73])
        g.box(v(x, b.base, back - 0.23), v(x + 0.15, b.base + 0.43, back + 0.23), faces(wood));
    }
    const soil = (d: number) =>
      Math.min(...[-1, 0, 1].map((offset) => w.heightAt(b.x + offset, frontZ + yard.front * d)));
    let near = 0.2;
    let far = 0.88;
    let top = b.base - 0.02;
    for (let k = 0; k < 6; k++) {
      const floor = Math.min(b.foot, soil(near), soil(far)) - 0.12;
      const a = frontZ + yard.front * near;
      const edge = frontZ + yard.front * far;
      solid(v(b.x - 1.1, floor, Math.min(a, edge)), v(b.x + 1.1, top, Math.max(a, edge)), rock);
      if (top - soil(far + 0.38) <= 0.28) break;
      near = far;
      far += 0.38;
      top -= 0.22;
    }
  }

  const { x, z, hw, hd, front } = yard;
  const entry = z + front * hd;
  const back = z - front * hd;
  // Timber at the gateway, low fieldstone on the other sides of some yards.
  const run = (ax: number, az: number, bx: number, bz: number, wall: boolean): void => {
    const bays = Math.ceil(Math.hypot(bx - ax, bz - az) / 2.25);
    const height = wall ? 0.86 : 1.08;
    const thickness = wall ? 0.24 : 0.08;
    const padX = ax === bx ? thickness : 0;
    const padZ = az === bz ? thickness : 0;
    let px = ax,
      pz = az,
      py = w.heightAt(ax, az);
    for (let i = 1; i <= bays; i++) {
      const t = i / bays;
      const nx = ax + (bx - ax) * t;
      const nz = az + (bz - az) * t;
      const ny = w.heightAt(nx, nz);
      const lo = Math.min(py, ny) - 0.24;
      const mid = (py + ny) / 2;
      const x0 = Math.min(px, nx) - padX,
        x1 = Math.max(px, nx) + padX;
      const z0 = Math.min(pz, nz) - padZ,
        z1 = Math.max(pz, nz) + padZ;
      if (wall) {
        solid(v(x0, lo, z0), v(x1, mid + height, z1), i % 4 === 1 ? color('stone') : rock);
      } else {
        for (const y of [mid + 0.4, mid + 0.78]) g.box(v(x0, y, z0), v(x1, y + 0.11, z1), faces(rail));
        collide(v(x0, lo, z0), v(x1, mid + height, z1));
        if (i === 1)
          g.box(v(px - 0.12, py - 0.16, pz - 0.12), v(px + 0.12, py + height, pz + 0.12), faces(wood));
        g.box(v(nx - 0.12, ny - 0.16, nz - 0.12), v(nx + 0.12, ny + height, nz + 0.12), faces(wood));
      }
      [px, pz, py] = [nx, nz, ny];
    }
  };
  run(x - hw, entry, x - 1.55, entry, false);
  run(x + 1.55, entry, x + hw, entry, false);
  run(x - hw, entry, x - hw, back, yard.stoneWall);
  run(x + hw, entry, x + hw, back, yard.stoneWall);
  run(x - hw, back, x + hw, back, yard.stoneWall);
}
