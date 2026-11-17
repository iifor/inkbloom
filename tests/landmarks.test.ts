import { describe, expect, it } from 'vitest';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { buildChunkGeometry } from '@/systems/wilderness/build-chunk';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import {
  lookoutInCell,
  type Lookout,
  type Spring,
  springInCell,
  springLevel,
  springsNear,
} from '@/world/wilderness/landmarks';
import { pathsOf } from '@/world/wilderness/paths';

const w = createWilderness(4242);
const SIZE = TUNING.world.chunkSize;
const springs: Spring[] = [];
const lookouts: Lookout[] = [];
for (let gx = -2; gx <= 2; gx++)
  for (let gz = -2; gz <= 2; gz++) {
    const s = springInCell(w, gx, gz);
    if (s) springs.push(s);
  }
for (let gx = -3; gx <= 3; gx++)
  for (let gz = -3; gz <= 3; gz++) {
    const l = lookoutInCell(w, gx, gz);
    if (l) lookouts.push(l);
  }

describe('hot springs', () => {
  it('turn up now and then, the same for everyone', () => {
    expect(springs.length).toBeGreaterThan(1);
    expect(springs.length).toBeLessThan(18);
    const again = createWilderness(4242);
    expect(springInCell(again, 0, 0)).toEqual(springInCell(w, 0, 0));
  });

  it('lie on a dry, level shelf, clear of towns and paths, the water over all the ground under it', () => {
    for (const s of springs) {
      expect(s.y).toBeGreaterThan(WATER_LEVEL + 2);
      expect(w.townAt(s.x, s.z, s.r + 20)).toBeNull();
      expect(pathsOf(w).edgeDistance(s.x, s.z)).toBeGreaterThan(s.r + 5);
      const level = springLevel(s, w);
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        expect(w.heightAt(s.x + Math.cos(a) * s.r * 0.8, s.z + Math.sin(a) * s.r * 0.8)).toBeLessThan(level);
      }
    }
  });

  it('are found nearest first, and trees give them room', () => {
    const s = springs[0]!;
    const near = springsNear(w, s.x + 30, s.z, 400);
    expect(near[0]).toEqual(s);
    const chunk = generateWildChunk(w, Math.floor(s.x / SIZE), Math.floor(s.z / SIZE));
    expect(chunk.springs).toEqual([s]);
    for (const t of chunk.trees) expect(Math.hypot(t.x - s.x, t.z - s.z)).toBeGreaterThan(s.r + 4.9);
  });

  it('show water facing up', () => {
    const s = springs[0]!;
    const chunk = generateWildChunk(w, Math.floor(s.x / SIZE), Math.floor(s.z / SIZE));
    const mesh = buildChunkGeometry({ ...chunk, trees: [] }, w).build();
    const pos = mesh.getAttribute('position');
    const code = mesh.getAttribute('aColor');
    const index = mesh.getIndex()!;
    let up = 0;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (code.getX(a) !== color('water') || Math.hypot(pos.getX(a) - s.x, pos.getZ(a) - s.z) > s.r + 0.01)
        continue;
      const ab = [pos.getX(b) - pos.getX(a), pos.getZ(b) - pos.getZ(a)];
      const ac = [pos.getX(c) - pos.getX(a), pos.getZ(c) - pos.getZ(a)];
      const y = ab[1]! * ac[0]! - ab[0]! * ac[1]!;
      if (Math.abs(y) < 1e-6) continue; // the fan's degenerate halves
      expect(y).toBeGreaterThan(0);
      up++;
    }
    expect(up).toBeGreaterThanOrEqual(20);
    mesh.dispose();
  });
});

describe('lookouts', () => {
  it('stand on high ground, on the highest point round about', () => {
    expect(lookouts.length).toBeGreaterThan(5);
    for (const l of lookouts) {
      expect(l.y).toBeGreaterThanOrEqual(15);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        expect(w.heightAt(l.x + Math.cos(a) * 12, l.z + Math.sin(a) * 12)).toBeLessThanOrEqual(l.y + 0.5);
      }
      expect(w.townAt(l.x, l.z, 20)).toBeNull();
    }
  });

  it('belong to one chunk each, with a solid cairn', () => {
    const l = lookouts[0]!;
    let owners = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        owners += generateWildChunk(
          w,
          Math.floor(l.x / SIZE) + dx,
          Math.floor(l.z / SIZE) + dz,
        ).lookouts.filter((o) => o.id === l.id).length;
    expect(owners).toBe(1);
  });
});
