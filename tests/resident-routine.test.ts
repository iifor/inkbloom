import { expect, it } from 'vitest';
import { townResidents } from '@/systems/city/residents';
import { generateCity } from '@/world/city/layout';
import {
  outingTime,
  planOuting,
  residentPose,
  type Neighbourhood,
  type Occupation,
} from '@/world/city/resident-routine';
import { farmActivities, villageActivities } from '@/world/city/resident-sites';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { farmsteadInChunk } from '@/world/wilderness/farmsteads';
import { createWilderness } from '@/world/wilderness/generator';

const roles = ['guard', 'woodcutter', 'mage', 'villager'] as const;
const home = { x: 0.5, z: 0.5, angle: 0, seed: 12, since: 100 };
const sites = {
  guard: [{ x: 40.5, z: 0.5 }],
  woodcutter: [{ x: 30.5, z: 0.5 }],
  mage: [{ x: 20.5, z: 0.5 }],
  villager: [{ x: 10.5, z: 0.5 }],
};
const area: Neighbourhood = { grid: { cell: 1, walkable: () => true }, ground: () => 0, sites, streets: [] };

it('starts returned residents at their new home, works at the occupational site, then walks back', () => {
  expect(outingTime(home, 100)).toEqual({ shift: 0, phase: 0 });
  expect(outingTime(home, 340)).toEqual({ shift: 1, phase: 0 });
  for (const role of roles) {
    const trip = planOuting(area, home, role, 0);
    expect(trip.points.at(-1)).toEqual(sites[role][0]);
    const poses = Array.from({ length: 240 }, (_, t) => residentPose(home, role, trip, t));
    expect(poses[0]).toMatchObject({ x: home.x, z: home.z, motion: 'idle' });
    expect(poses[239]).toEqual(poses[0]);
    const jobMotion = { guard: 'idle', woodcutter: 'slash', mage: 'interact', villager: 'interact' }[role];
    const working = poses.findIndex((p) => p.x === sites[role][0]!.x && p.motion === jobMotion);
    expect(working).toBeGreaterThan(4);
    expect(poses.slice(working + 1).some((p) => p.motion === 'walk' && p.angle > Math.PI)).toBe(true);
    const restored = planOuting(area, { ...home }, role, 0);
    expect(residentPose(home, role, restored, 15)).toEqual(poses[15]);
  }
});

it('takes a local walk when a workplace is unreachable and stays home when there is no open route', () => {
  const blocked = {
    ...area,
    grid: { cell: 1, walkable: (x: number, z: number) => x < 8 && x >= 0 && z === 0 },
  };
  expect(planOuting(blocked, home, 'woodcutter', 0).distance).toBe(0);
  const stroll = planOuting({ ...blocked, streets: [{ x: 5.5, z: 0.5 }] }, home, 'woodcutter', 0);
  expect(stroll).toMatchObject({ distance: 5, working: false });
  expect(residentPose(home, 'woodcutter', stroll, 8).motion).toBe('idle');
});

it('routes the four professions through walkable cells in a generated village', () => {
  const layout = generateCity('test', 4242, 3);
  const area = villageActivities(layout);
  const homes = townResidents(layout);
  const limits: Record<Occupation, number> = { guard: 180, woodcutter: 140, mage: 120, villager: 90 };
  for (const role of roles) {
    let furthest = 0;
    for (const h of homes.filter((_, i) => i % 5 === 0).slice(0, 35)) {
      const outing = planOuting(area, h, role, 0);
      if (!outing.working) continue;
      furthest = Math.max(furthest, outing.distance);
      expect(outing.distance).toBeLessThanOrEqual(limits[role]);
      const g = area.grid;
      for (let i = 1; i < outing.points.length; i++) {
        const a = outing.points[i - 1]!,
          b = outing.points[i]!;
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const ix = Math.floor((a.x + t * (b.x - a.x) - g.ox!) / g.cell);
          const iz = Math.floor((a.z + t * (b.z - a.z) - g.oz!) / g.cell);
          if (!g.walkable(ix, iz))
            throw new Error(
              `Blocked ${role} route at ${ix},${iz} (segment ${i}, step ${s}/${steps}, ${JSON.stringify([h, a, b])})`,
            );
        }
      }
    }
    expect(furthest).toBeGreaterThan(limits[role] / 3);
  }
});

it('lets a farm household leave its fenced yard through the gate', () => {
  const w = createWilderness(4242);
  for (let cz = -3; cz <= 3; cz++)
    for (let cx = -3; cx <= 3; cx++) {
      if (!farmsteadInChunk(w, cx, cz, [])) continue;
      const chunk = generateWildChunk(w, cx, cz);
      const farm = chunk.farmstead;
      if (!farm) continue;
      const building = farm.buildings.find((b) => b.residents > 0)!;
      const h = { ...home, x: building.x + 1.8, z: building.z + farm.front * (building.hd + 1.3) };
      const area = farmActivities(w, chunk, farm);
      const gate = area.streets[0]!;
      const trip = planOuting({ ...area, sites: { ...area.sites, guard: [gate] } }, h, 'guard', 0);
      expect(trip.working).toBe(true);
      expect(trip.points.at(-1)).toEqual(gate);
      return;
    }
  throw new Error('Expected a farm');
});
