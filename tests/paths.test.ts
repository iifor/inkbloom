import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { townGates } from '@/world/city/layout';
import { color } from '@/content/palette';
import { buildChunkGeometry } from '@/systems/wilderness/build-chunk';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness, townDistance, WATER_LEVEL } from '@/world/wilderness/generator';
import { pathsOf, type Trail } from '@/world/wilderness/paths';

const w = createWilderness(4242);
const net = pathsOf(w);
const SIZE = TUNING.world.chunkSize;
const spawn = net.trailsNear(0, 0, SIZE, SIZE).find((t) => t.id === 'spawn')!;
const roads = net.trailsNear(-1500, -1500, 1500, 1500).filter((t) => t.id.startsWith('t'));
const point = (t: Trail, k: number): { x: number; z: number } => ({ x: t.pts[k * 2]!, z: t.pts[k * 2 + 1]! });
const end = (t: Trail): { x: number; z: number } => point(t, t.pts.length / 2 - 1);

describe('footpaths', () => {
  it('are the same for everyone with the same seed', () => {
    const again = pathsOf(createWilderness(4242))
      .trailsNear(0, 0, SIZE, SIZE)
      .find((t) => t.id === 'spawn')!;
    expect(again.pts).toEqual(spawn.pts);
  });

  it('lead from spawn to a gate of the first town, over the first river on a bridge', () => {
    expect(Math.hypot(spawn.pts[0]! - SIZE / 2, spawn.pts[1]! - SIZE / 2)).toBeLessThan(10);
    const [cx, cz] = TUNING.structures.firstCityChunk;
    const town = w.entrancesNear((cx + 0.5) * SIZE, (cz + 0.5) * SIZE, 0)[0]!;
    const gates = townGates(town, w);
    const e = end(spawn);
    expect(Math.min(...gates.map((g) => Math.hypot(g.x - e.x, g.z - e.z)))).toBeLessThan(5);
    expect(spawn.bridges.length).toBeGreaterThan(0);
  });

  it('link neighbouring towns gate to gate', () => {
    expect(roads.length).toBeGreaterThan(10);
    for (const t of roads) {
      for (const p of [point(t, 0), end(t)]) {
        const town = w.townAt(p.x, p.z, 8);
        expect(town, t.id).not.toBeNull();
        const near = Math.min(...townGates(town!, w).map((g) => Math.hypot(g.x - p.x, g.z - p.z)));
        expect(near, t.id).toBeLessThan(5);
      }
    }
  });

  it('go round towns on the way, not through them', () => {
    for (const t of roads) {
      const n = t.pts.length / 2;
      for (let k = 6; k < n - 6; k++) {
        const p = point(t, k);
        // a little way out of the gates (2.5 m a point) the path has room round every town
        const room = k > 20 && k < n - 20 ? 4 : 0;
        for (const e of w.entrancesNear(p.x, p.z, 1))
          expect(townDistance(e, p.x, p.z), t.id).toBeGreaterThan(room);
      }
    }
  });

  it('cross deep water on bridges from bank to bank, standing above it', () => {
    let bridges = 0;
    for (const t of [spawn, ...roads])
      for (const b of t.bridges) {
        bridges++;
        const mid = (b.x0 + b.x1) / 2;
        expect(b.x1 - b.x0).toBeLessThanOrEqual(70 + 6);
        // its ends on the banks (dry or shallow), the deck above the water
        expect(w.heightAt(b.x0, b.z)).toBeGreaterThan(WATER_LEVEL - 0.45);
        expect(w.heightAt(b.x1, b.z)).toBeGreaterThan(WATER_LEVEL - 0.45);
        expect(b.y).toBeGreaterThan(WATER_LEVEL + 0.5);
        // (two paths out of one gate may share a crossing: either bridge will do)
        expect(net.bridgeAt(mid, b.z)).not.toBeNull();
      }
    expect(bridges).toBeGreaterThan(0);
  });

  it('almost never leave you swimming: deep water off a bridge is rare and short', () => {
    let deep = 0;
    let all = 0;
    for (const t of roads)
      for (let k = 0; k < t.pts.length / 2; k++) {
        const p = point(t, k);
        all++;
        if (w.heightAt(p.x, p.z) < WATER_LEVEL - 0.45 && !net.bridgeAt(p.x, p.z)) deep++;
      }
    expect(deep / all).toBeLessThan(0.01);
  });

  it('measure distance to their edge, and trees keep off them', () => {
    const k = Math.floor(spawn.pts.length / 4);
    const mid = point(spawn, k);
    const next = point(spawn, k + 1);
    const l = Math.hypot(next.x - mid.x, next.z - mid.z);
    expect(net.edgeDistance(mid.x, mid.z)).toBeLessThan(0);
    // 3 m to the side: about 3 m less half the path's width
    const side = net.edgeDistance(mid.x - ((next.z - mid.z) / l) * 3, mid.z + ((next.x - mid.x) / l) * 3);
    expect(side).toBeGreaterThan(1);
    expect(side).toBeLessThan(3);
    for (let k = 0; k < spawn.pts.length / 2; k += 20) {
      const p = point(spawn, k);
      const chunk = generateWildChunk(w, Math.floor(p.x / SIZE), Math.floor(p.z / SIZE));
      for (const tree of chunk.trees) expect(net.edgeDistance(tree.x, tree.z)).toBeGreaterThan(2.4);
    }
  });

  it('give each bridge to exactly one chunk', () => {
    const b = spawn.bridges[0]!;
    let owners = 0;
    for (let cx = Math.floor(b.x0 / SIZE) - 1; cx <= Math.floor(b.x1 / SIZE) + 1; cx++)
      for (let cz = Math.floor(b.z / SIZE) - 1; cz <= Math.floor(b.z / SIZE) + 1; cz++)
        owners += generateWildChunk(w, cx, cz).bridges.filter((o) => o.x0 === b.x0 && o.z === b.z).length;
    expect(owners).toBe(1);
  });

  it('are laid face up on the ground, so they show from above', () => {
    const chunk = generateWildChunk(w, 0, 0);
    const mesh = buildChunkGeometry({ ...chunk, trees: [] }, w).build();
    const pos = mesh.getAttribute('position');
    const code = mesh.getAttribute('aColor');
    const index = mesh.getIndex()!;
    const earth = color('sand');
    let faces = 0;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (code.getX(a) !== earth || code.getX(b) !== earth || code.getX(c) !== earth) continue;
      const ab = [pos.getX(b) - pos.getX(a), pos.getZ(b) - pos.getZ(a)];
      const ac = [pos.getX(c) - pos.getX(a), pos.getZ(c) - pos.getZ(a)];
      // the y of (b - a) × (c - a): positive when the face looks up
      expect(ab[1]! * ac[0]! - ab[0]! * ac[1]!).toBeGreaterThan(0);
      faces++;
    }
    expect(faces).toBeGreaterThan(20);
    mesh.dispose();
  });
});
