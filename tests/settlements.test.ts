import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { buildBoundary } from '@/systems/city/build-boundary';
import { boundarySpans } from '@/world/city/boundary';
import { generateCity, groundAt, townLayout } from '@/world/city/layout';
import { settlementBoundary, settlementChunks, type BoundaryKind } from '@/world/city/settlement';
import { cityNav } from '@/world/nav/grids';
import { layoutCache } from '@/world/net/patch-context';
import { cityStates, createWorldState, deserializeWorld, serializeWorld } from '@/world/state';
import { createWilderness } from '@/world/wilderness/generator';

describe('varied settlements', () => {
  it('generates all five sizes reproducibly, independently of visit order', () => {
    const sizes = new Set<number>();
    const w = createWilderness(4242);
    const cells: [number, number][] = [];
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) cells.push([x, z]);
    const towns = cells.map(([x, z]) => w.entranceInCell(x, z));
    const other = createWilderness(4242);
    expect(
      [...cells]
        .reverse()
        .map(([x, z]) => other.entranceInCell(x, z))
        .reverse(),
    ).toEqual(towns);
    for (const e of towns)
      if (e) {
        sizes.add(e.chunks);
        expect(e.size).toBe(e.chunks * TUNING.world.chunkSize);
        expect(e.size).toBeLessThan(
          TUNING.structures.cityGrid * TUNING.world.chunkSize - 2 * TUNING.structures.townJitter,
        );
      }
    expect([...sizes].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(w.entranceInCell(0, 0)!.chunks).toBe(TUNING.city.firstCityChunks);
    expect(settlementChunks(42, -4, 6)).toBe(settlementChunks(42, -4, 6));
  });

  it.each([
    [1, 'fence'],
    [2, 'fence'],
    [3, 'wall'],
    [4, 'stone'],
    [5, 'stone'],
  ] as const)('uses the usual boundary about 85 percent of the time for size %i', (chunks, typical) => {
    const counts = { fence: 0, wall: 0, stone: 0, none: 0 };
    for (let seed = 0; seed < 5000; seed++) counts[settlementBoundary(seed, chunks)]++;
    expect(counts[typical] / 5000).toBeGreaterThan(0.8);
    expect(counts[typical] / 5000).toBeLessThan(0.9);
    for (const [kind, count] of Object.entries(counts))
      if (kind !== typical) {
        expect(count / 5000).toBeGreaterThan(0.03);
        expect(count / 5000).toBeLessThan(0.07);
      }
  });

  it('migrates existing towns without moving houses or resetting paint, while new towns vary', () => {
    const seed = 4242;
    const candidate = createWilderness(seed)
      .entrancesNear(1200, 1200, 2)
      .find((e) => e.chunks < 5)!;
    const legacyW = createWilderness(seed, [candidate.cityId]);
    const original = layoutCache(legacyW)(candidate.cityId)!;
    expect(original.chunks).toBe(5);
    const state = createWorldState('old', seed);
    cityStates(state, candidate.cityId, original).states[10] = 3;
    const json = JSON.parse(serializeWorld(state));
    json.version = 3;
    delete json.legacyTowns;
    const migrated = deserializeWorld(JSON.stringify(json));
    expect(migrated.legacyTowns).toEqual([candidate.cityId]);
    const client = createWilderness(seed, migrated.legacyTowns);
    const server = createWilderness(seed, deserializeWorld(serializeWorld(migrated)).legacyTowns);
    const e = client.entrancesNear(candidate.x, candidate.z, 1).find((t) => t.cityId === candidate.cityId)!;
    const local = townLayout(e, client);
    expect(local.buildings).toEqual(original.buildings);
    expect(cityStates(migrated, candidate.cityId, local).reset).toBe(false);
    expect(migrated.cities.get(candidate.cityId)!.states[10]).toBe(3);
    expect(layoutCache(server)(candidate.cityId)).toEqual(local);
    // A worker reconstructs the land from the same seed + preserved town list.
    expect(townLayout(e, createWilderness(seed, client.legacyTowns))).toEqual(local);
    const unexplored = client.entrancesNear(-2000, 2000, 2);
    expect(unexplored.some((t) => t.chunks < 5)).toBe(true);
  });
});

describe('settlement boundaries', () => {
  const city = generateCity('boundary-test', 77, 1, 'pz', (x, z) => 2 + x * 0.005 + z * 0.01);
  it.each(['fence', 'wall', 'stone', 'none'] as const)(
    '%s keeps gates open and has matching geometry and collisions',
    (boundary) => {
      const layout = { ...city, boundary };
      const full = new GeometryBuilder();
      const far = new GeometryBuilder();
      const physics = new PhysicsWorld(8);
      buildBoundary(layout, () => ({ full, far }), physics);
      for (const gate of layout.gates) {
        const x = layout.ox + (gate.ix + 0.5) * layout.cell;
        const z = layout.oz + (gate.iz + 0.5) * layout.cell;
        expect(physics.raycast({ x, y: groundAt(layout, x, z) + 4, z }, { x: 0, y: -1, z: 0 }, 6)).toBeNull();
        expect(cityNav(layout).walkable(gate.ix, gate.iz)).toBe(true);
      }
      if (boundary === 'none') {
        expect(full.vertexCount).toBe(0);
        expect(far.vertexCount).toBe(0);
        expect(physics.boxCount).toBe(0);
        expect(cityNav(layout).walkable(0, 0)).toBe(true);
        return;
      }
      const spans = boundarySpans(layout);
      expect(full.vertexCount).toBeGreaterThan(0);
      expect(far.vertexCount).toBeGreaterThan(0);
      expect(physics.boxCount).toBe(spans.length);
      for (const span of spans) {
        const y = groundAt(layout, span.x, span.z) + 0.8;
        const hit = physics.raycast(
          { x: span.x + span.tz * 2, y, z: span.z - span.tx * 2 },
          { x: -span.tz, y: 0, z: span.tx },
          4,
        );
        expect(hit).not.toBeNull();
        expect(hit!.dist).toBeGreaterThanOrEqual(1.49);
      }
      // LODs keep the same overall silhouette; the stone joints alone simplify far away.
      const nearGeometry = full.build();
      const farGeometry = far.build();
      nearGeometry.computeBoundingBox();
      farGeometry.computeBoundingBox();
      expect(farGeometry.boundingBox).toEqual(nearGeometry.boundingBox);
      nearGeometry.dispose();
      farGeometry.dispose();
    },
  );

  it('leaves river mouths clear for every boundary material', () => {
    const water = city.water.slice();
    for (let x = 10; x <= 14; x++) water[x] = 1;
    for (const boundary of ['fence', 'wall', 'stone'] as BoundaryKind[]) {
      const layout = { ...city, boundary, water };
      expect(boundarySpans(layout).some((s) => s.iz === 0 && s.ix >= 10 && s.ix <= 14)).toBe(false);
    }
  });
});
