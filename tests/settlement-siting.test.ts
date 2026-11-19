import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { createWilderness, type Entrance } from '@/world/wilderness/generator';
import { createSettlementSiting } from '@/world/wilderness/settlement-siting';
import { createSettlementLinks } from '@/world/wilderness/settlement-links';

const span = TUNING.structures.cityGrid * TUNING.world.chunkSize;
const cells = Array.from({ length: 81 }, (_, i) => [(i % 9) - 4, Math.floor(i / 9) - 4] as const);

describe('irregular settlement sites', () => {
  it('keeps recorded version 4 sites and the starter village unchanged', () => {
    const old = createWilderness(4242, [], 4);
    const town = old.entranceInCell(2, 3)!;
    expect([town.cityId, town.ox, town.oz, town.size, town.y]).toEqual([
      'c15_20',
      1664,
      2364,
      384,
      4.59260353278759,
    ]);
    expect(createWilderness(4242).entranceInCell(0, 0)).toEqual(old.entranceInCell(0, 0));
  });

  it.each([42, 4242, 717])('leaves gaps, varies positions and separates footprints for seed %i', (seed) => {
    const w = createWilderness(seed);
    const towns = cells.flatMap(([gx, gz]) => {
      const e = w.entranceInCell(gx, gz);
      if (!e) return [];
      if (gx || gz) {
        const limit = (span - e.size) / 2 - TUNING.structures.townSkirt;
        expect(Math.abs(e.x - (gx * span + 64))).toBeLessThanOrEqual(limit);
        expect(Math.abs(e.z - (gz * span + 64))).toBeLessThanOrEqual(limit);
      }
      expect(w.townAt(e.x, e.z)?.cityId).toBe(e.cityId);
      return [e];
    });
    expect(towns.length).toBeGreaterThan(81 * 0.4);
    expect(towns.length).toBeLessThan(81 * 0.9);
    expect(new Set(towns.map((t) => (((t.x - 64) % span) + span) % span)).size).toBeGreaterThan(15);
    for (let i = 0; i < towns.length; i++)
      for (const b of towns.slice(i + 1)) {
        const a = towns[i]!;
        const gap = Math.hypot(
          Math.max(a.ox - b.ox - b.size, b.ox - a.ox - a.size, 0),
          Math.max(a.oz - b.oz - b.size, b.oz - a.oz - a.size, 0),
        );
        expect(gap).toBeGreaterThanOrEqual(120);
      }
  });

  it('does not depend on chunk visitation order, including empty cells', () => {
    const a = createWilderness(4242),
      b = createWilderness(4242);
    const expected = new Map(cells.map(([x, z]) => [`${x},${z}`, a.entranceInCell(x, z)]));
    for (const [x, z] of [...cells].reverse())
      expect(b.entranceInCell(x, z)).toEqual(expected.get(`${x},${z}`));
  });

  it('rejects submerged and steep sites, but accepts level dry land within a bounded survey', () => {
    let samples = 0;
    const dry = createSettlementSiting(4242, () => {
      samples++;
      return 4;
    });
    const wet = createSettlementSiting(4242, () => -3);
    const cliff = createSettlementSiting(4242, (x) => x * 2 + 10000);
    let placed = 0;
    for (const [x, z] of cells) {
      if (dry(x, z, 256)) placed++;
      expect(wet(x, z, 256)).toBeNull();
      expect(cliff(x, z, 256)).toBeNull();
    }
    expect(placed).toBeGreaterThan(40);
    expect(samples).toBeLessThanOrEqual(cells.length * 12 * 13);
  });

  it('connects diagonal neighbours and bridges vacant cells symmetrically without duplicates', () => {
    const w = createWilderness(4242);
    const links = createSettlementLinks(w);
    let diagonal = false,
      gap = false,
      total = 0;
    const cell = (e: Entrance) => [
      Math.floor((e.x - 64 + span / 2) / span),
      Math.floor((e.z - 64 + span / 2) / span),
    ];
    for (const [gx, gz] of cells) {
      const a = w.entranceInCell(gx, gz);
      if (!a) continue;
      const edges = links(a);
      expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
      for (const edge of edges) {
        total++;
        const b = edge.a === a ? edge.b : edge.a;
        expect(links(b).map((e) => e.id)).toContain(edge.id);
        const [bx, bz] = cell(b);
        if (bx !== gx && bz !== gz) diagonal = true;
        if (Math.abs(bx! - gx) > 1 || Math.abs(bz! - gz) > 1) gap = true;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThanOrEqual(span * 1.8);
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(diagonal).toBe(true);
    expect(gap).toBe(true);
  });
});
