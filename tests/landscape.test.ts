import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { TUNING } from '@/content/tuning';
import { landscapeTiles, type LandscapeTile } from '@/world/wilderness/landscape';
import { createWilderness } from '@/world/wilderness/generator';
import { DistantTerrain, landscapeGeometry } from '@/systems/wilderness/distant-terrain';

const geometry = (tile: LandscapeTile) => {
  const steps = landscapeGeometry(createWilderness(42), tile);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
};
it('covers the midground through the haze without overlapping tiles, also at negative coordinates', () => {
  for (const [x, z] of [
    [64, 64],
    [-129, 1023],
    [1025, -1025],
  ]) {
    const tiles = landscapeTiles(x!, z!);
    expect(tiles.length).toBeLessThan(600);
    const side = TUNING.world.landscape.rootSize * (2 * TUNING.world.landscape.radius + 1);
    expect(tiles.reduce((n, t) => n + t.size * t.size, 0)).toBe(side * side);
    for (let i = 0; i < tiles.length; i++)
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i]!,
          b = tiles[j]!;
        expect(a.x >= b.x + b.size || b.x >= a.x + a.size || a.z >= b.z + b.size || b.z >= a.z + a.size).toBe(
          true,
        );
      }
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        const tx = (Math.floor(x! / 128) + dx) * 128,
          tz = (Math.floor(z! / 128) + dz) * 128;
        expect(tiles.some((t) => t.x === tx && t.z === tz && t.size === 128)).toBe(true);
      }
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      const px = x! + 3000 * Math.cos(angle),
        pz = z! + 3000 * Math.sin(angle);
      expect(tiles.some((t) => px >= t.x && px <= t.x + t.size && pz >= t.z && pz <= t.z + t.size)).toBe(
        true,
      );
    }
  }
});

it('stitches different terrain resolutions to the exact same world edge with upward faces', () => {
  const a = geometry({ x: 0, z: 0, size: 128, key: 'a' }),
    b = geometry({ x: 128, z: 0, size: 256, key: 'b' });
  const edge = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal'),
      out = new Map<number, number[]>();
    for (let i = 0; i < p.count; i++)
      if (p.getX(i) === 128 && p.getZ(i) <= 128 && n.getY(i) > 0)
        out.set(p.getZ(i), [p.getY(i), n.getX(i), n.getY(i), n.getZ(i)]);
    return out;
  };
  const ea = edge(a),
    eb = edge(b);
  expect(ea.size).toBe(33);
  for (const [z, v] of ea) expect(eb.get(z)).toEqual(v);
  for (const g of [a, b]) {
    const p = g.getAttribute('position'),
      idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const x = idx.getX(i),
        y = idx.getX(i + 1),
        z = idx.getX(i + 2);
      expect(
        (p.getZ(y) - p.getZ(x)) * (p.getX(z) - p.getX(x)) - (p.getX(y) - p.getX(x)) * (p.getZ(z) - p.getZ(x)),
      ).toBeGreaterThanOrEqual(0); // Vertical skirts have zero projected area.
    }
    g.dispose();
  }
});

it('hands off loaded chunks, keeps old coverage during rebuild, and releases obsolete GPU geometry', () => {
  // A synthetic clock gives a reproducible per-update construction budget.
  let time = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (time += 0.01));
  try {
    const root = new THREE.Group(),
      land = new DistantTerrain(createWilderness(42), root);
    const detail = new Map<string, unknown>([['0,0', {}]]);
    const p = new THREE.Vector3(64, 30, 64);
    const ready = () => root.children.filter((o) => o.visible).length;
    for (let i = 0; i < 400; i++) land.update(p, detail);
    const expected = 49;
    expect(root.children.length).toBe(expected);
    expect(ready()).toBe(expected);
    // A published stationary landscape must not rebuild its batches or upload indices.
    const versions = root.children.map((o) => (o as THREE.Mesh).geometry.index!.version);
    for (let i = 0; i < 10; i++) land.update(p, detail);
    expect(root.children.map((o) => (o as THREE.Mesh).geometry.index!.version)).toEqual(versions);
    // Replacing a loaded chunk with another keeps the map identity and size unchanged.
    detail.delete('0,0');
    detail.set('1,0', {});
    land.update(p, detail);
    expect(root.children.map((o) => (o as THREE.Mesh).geometry.index!.version)).not.toEqual(versions);
    detail.delete('1,0');
    detail.set('0,0', {});
    land.update(p, detail);
    const triangles = () =>
      root.children.reduce((sum, o) => {
        const index = (o as THREE.Mesh).geometry.index!;
        let count = 0;
        for (let i = 0; i < index.count; i += 3) if (index.getX(i) !== index.getX(i + 1)) count++;
        return sum + count;
      }, 0);
    const hidden = triangles();
    const old = [...root.children];
    const disposed = vi.fn();
    for (const mesh of old) (mesh as THREE.Mesh).geometry.addEventListener('dispose', disposed);
    detail.clear();
    land.update(p, detail);
    expect(triangles()).toBeGreaterThan(hidden);
    p.x = 2048;
    land.update(p, detail);
    expect(old.filter((o) => o.visible).length).toBe(expected);
    for (let i = 0; i < 400; i++) land.update(p, detail);
    expect(root.children.length).toBe(expected);
    expect(disposed).toHaveBeenCalled();
    land.dispose();
    expect(root.children).toHaveLength(0);
  } finally {
    vi.restoreAllMocks();
  }
});
