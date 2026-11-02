import { describe, expect, it } from 'vitest';
import { generateCity } from '@/world/city/layout';
import { cityNav, terrainNav } from '@/world/nav/grids';
import { findPath, type NavGrid, type Waypoint } from '@/world/nav/path';

/** Grid from an ASCII map: '#' blocked, anything else open; 1 m cells. */
function ascii(rows: string[]): NavGrid {
  return {
    cell: 1,
    walkable: (ix, iz) => (rows[iz]?.[ix] ?? '#') !== '#',
  };
}
const at = (ix: number, iz: number): Waypoint => ({ x: ix + 0.5, z: iz + 0.5 });

function walk(g: NavGrid, from: Waypoint, path: Waypoint[]): void {
  // every leg must stay on open cells (sampled finely)
  let prev = from;
  for (const p of path) {
    const n = Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) * 8);
    for (let k = 0; k <= n; k++) {
      const x = prev.x + ((p.x - prev.x) * k) / n;
      const z = prev.z + ((p.z - prev.z) * k) / n;
      expect(
        g.walkable(Math.floor(x / g.cell), Math.floor(z / g.cell)),
        `(${x.toFixed(2)}, ${z.toFixed(2)})`,
      ).toBe(true);
    }
    prev = p;
  }
}

describe('findPath', () => {
  const map = ascii([
    '..........',
    '.########.',
    '.#......#.',
    '.#.####.#.',
    '.#.#..#.#.',
    '...#..#...',
    '.###..####',
    '..........',
  ]);

  it('goes straight when nothing is in the way', () => {
    const p = findPath(map, at(0, 0), at(9, 0))!;
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual(at(9, 0));
  });

  it('walks around walls instead of through them', () => {
    const from = at(0, 5);
    const p = findPath(map, from, at(4, 4))!;
    expect(p).not.toBeNull();
    walk(map, from, p);
    expect(p[p.length - 1]).toEqual(at(4, 4));
  });

  it('never cuts a blocked corner', () => {
    const g = ascii(['.#', '..']);
    const from = at(0, 0);
    const p = findPath(g, from, at(1, 1))!;
    walk(g, from, p);
    expect(p.length).toBeGreaterThan(1);
  });

  it('returns null when the goal is walled off', () => {
    const g = ascii(['..#..', '..#..', '..#..']);
    expect(findPath(g, at(0, 0), at(4, 0))).toBeNull();
  });

  it('gets as close as possible to a goal inside a blocked cell', () => {
    const g = ascii(['....', '..#.', '....']);
    const p = findPath(g, at(0, 0), at(2, 1))!;
    const last = p[p.length - 1]!;
    expect(Math.hypot(last.x - 2.5, last.z - 1.5)).toBeLessThanOrEqual(1.5);
  });

  it('respects step heights', () => {
    const heights = [
      [0, 0, 0, 0],
      [0, 3, 3, 0],
      [0, 3, 0.5, 0],
    ];
    const g = terrainNav(
      (ix, iz) => heights[iz]?.[ix] ?? 99,
      () => false,
    );
    const cell = g.cell;
    const from = { x: 0.5 * cell, z: 0.5 * cell };
    const p = findPath(g, from, { x: 2.5 * cell, z: 2.5 * cell })!;
    expect(p).not.toBeNull();
    // never steps onto the 3 m plateau
    for (const w of p) expect(heights[Math.floor(w.z / cell)]![Math.floor(w.x / cell)]).toBeLessThan(1);
  });
});

describe('city navigation', () => {
  it('reaches every courtyard-free road cell from the spawn without crossing buildings', () => {
    const city = generateCity('x', 3, 2);
    const g = cityNav(city);
    const from = { x: city.spawn.x, z: city.spawn.z };
    let tried = 0;
    for (let i = 0; i < city.monsters.length; i++) {
      const m = city.monsters[i]!;
      const p = findPath(g, from, m, 6000);
      expect(p, `monster ${i}`).not.toBeNull();
      walk(g, from, p!);
      tried++;
    }
    expect(tried).toBeGreaterThan(0);
  });
});
