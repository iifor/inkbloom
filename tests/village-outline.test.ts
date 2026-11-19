import { expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { generateCity, placeCity, groundAt, groundSurfaceAt } from '@/world/city/layout';
import { boundarySpans } from '@/world/city/boundary';
import { villageOutline, villageGroundEdge } from '@/world/city/outline';
import { cityNav } from '@/world/nav/grids';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { buildCity } from '@/systems/city/build-city';

it.each([1, 2, 3, 5])('gives %i-chunk villages an irregular border with safe road crossings', (chunks) => {
  const city = generateCity('outline', 77, chunks);
  const outline = villageOutline(city);
  let twiceArea = 0;
  for (let i = 0; i < outline.points.length; i++) {
    const a = outline.points[i]!,
      b = outline.points[(i + 1) % outline.points.length]!;
    twiceArea += a.x * b.z - b.x * a.z;
  }
  expect(Math.abs(twiceArea) / 2).toBeLessThan(city.size ** 2 * 0.94);
  const spans = boundarySpans({ ...city, boundary: 'fence' });
  expect(spans.filter((s) => Math.abs(s.tx) > 0.1 && Math.abs(s.tz) > 0.1).length).toBeGreaterThan(
    spans.length * 0.55,
  );
  const nav = cityNav({ ...city, boundary: 'fence' });
  for (let i = 0; i < city.roads.length; i++)
    if (city.roads[i]) expect(nav.walkable(i % city.n, Math.floor(i / city.n))).toBe(true);
  for (const span of spans) {
    expect(city.buildingOf[span.iz * city.n + span.ix]).toBe(0);
    expect(city.water[span.iz * city.n + span.ix]).toBe(0);
    expect(nav.walkable(span.ix, span.iz)).toBe(false);
  }
});

it('is seeded and translation invariant without mutating buildings, paint ids or generated features', () => {
  const city = generateCity('outline', 19, 2);
  const before = structuredClone(city);
  const a = villageOutline(city);
  const translated = placeCity(city, { x: 1500, z: -700 });
  const b = villageOutline(translated);
  a.points.forEach((p, i) => {
    expect(b.points[i]!.x - p.x).toBeCloseTo(1500, 6);
    expect(b.points[i]!.z - p.z).toBeCloseTo(-700, 6);
  });
  expect(villageOutline(generateCity('outline', 19, 2)).points).toEqual(a.points);
  expect(villageOutline(generateCity('outline', 20, 2)).points).not.toEqual(a.points);
  expect(city).toEqual(before);
});

it('keeps every courtyard paintable and removes the rigid corner apron from the rendered ground', () => {
  const city = generateCity('outline', 37, 2);
  const outline = villageOutline(city);
  for (let id = 0; id < city.surfaces.length; id++) {
    if (city.surfaces[id]!.kind !== 'ground') continue;
    const p = outline.patches.get(id)!;
    expect(p).toBeDefined();
    expect(groundSurfaceAt(city, p.x, p.z)).toBe(id);
    // The entire centre cell is uncut, not just a subpixel spot.
    for (const dx of [-2, 2])
      for (const dz of [-2, 2]) expect(villageGroundEdge(city, id, p.x + dx, p.z + dz)).toBeLessThan(0.5);
  }
  const tiles = buildCity(city, { addBox() {} });
  const merged = new GeometryBuilder();
  for (const t of tiles) merged.append(t.full, new Matrix4());
  const geometry = merged.build();
  const pane = geometry.getAttribute('aPane');
  const pos = geometry.getAttribute('position');
  let clipped = 0;
  let softSides = 0;
  for (let i = 0; i < pane.count; i++) {
    if (pane.getX(i) === -3 && pane.getY(i) > 1) clipped++;
    if (pane.getX(i) >= -4) continue;
    softSides++;
    expect(pos.getY(i) - groundAt(city, pos.getX(i), pos.getZ(i))).toBeCloseTo(0.024, 4);
  }
  expect(clipped).toBeGreaterThan(100);
  expect(softSides).toBeGreaterThan(0);
  geometry.dispose();
});
