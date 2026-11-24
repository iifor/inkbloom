import { expect, it } from 'vitest';
import { createWilderness } from '@/world/wilderness/generator';
import { pathsOf, type Trail } from '@/world/wilderness/paths';
import { journeyOn, travellerPose } from '@/world/wilderness/travellers';

it('walks the full trail at walking speed, rests, and retraces its bends', () => {
  const trail: Trail = {
    id: 'town-road',
    width: 2,
    pts: [0, 0, 0, 0, 0, 20, 0, 20, 30, 20, 30, 20],
    bridges: [],
    minX: 0,
    maxX: 30,
    minZ: 0,
    maxZ: 20,
  };
  const j = { ...journeyOn(12, trail)!, offset: 0 };
  const seconds = 50 / j.speed;
  expect(travellerPose(j, 0)).toMatchObject({ x: 0, z: 0, motion: 'walk' });
  expect(travellerPose(j, 30 / j.speed)).toMatchObject({ x: 10, z: 20, angle: Math.PI / 2 });
  expect(travellerPose(j, seconds + 3)).toMatchObject({ x: 30, z: 20, motion: 'idle' });
  const returning = travellerPose(j, seconds + j.rest + 10 / j.speed);
  expect(returning.x).toBeCloseTo(20);
  expect(returning).toMatchObject({ z: 20, angle: -Math.PI / 2, motion: 'walk' });
  expect(travellerPose(j, 2 * seconds + j.rest + 3)).toMatchObject({ x: 0, z: 0, motion: 'idle' });
  expect(journeyOn(12, { ...trail, pts: [0, 0, 0, 0] })).toBeNull();
  const tracks = Array.from({ length: 40 }, (_, i) => journeyOn(12, { ...trail, id: 'r' + i }));
  expect(tracks.some(Boolean) && tracks.some((x) => !x)).toBe(true);
});

it('keeps one itinerary across streamed chunks and clients, and walks along the actual spawn bridge', () => {
  const w = createWilderness(4242);
  const net = pathsOf(w);
  const trail = net.trailsNear(0, 0, 128, 128).find((t) => t.id === 'spawn')!;
  const j = journeyOn(w.seed, trail)!;
  const start = travellerPose(j, 0);
  expect(Math.hypot(start.x - trail.pts[0]!, start.z - trail.pts[1]!)).toBeLessThan(47);
  const b = trail.bridges[0]!;
  const bridgeRoad = net.trailsNear(b.x0, b.z, b.x1, b.z).find((t) => t.id === 'spawn');
  expect(bridgeRoad).toBe(trail);
  const i = trail.pts.findIndex(
    (v, k) => k % 2 === 0 && (v === b.x0 || v === b.x1) && trail.pts[k + 1] === b.z,
  );
  expect(i).toBeGreaterThan(0);
  const time = (j.lengths[i / 2]! + (b.x1 - b.x0) / 2) / j.speed - j.offset;
  const middle = travellerPose(j, time);
  expect(middle.x).toBeCloseTo((b.x0 + b.x1) / 2);
  expect(middle.z).toBeCloseTo(b.z);
  expect(net.bridgeAt(middle.x, middle.z)?.y).toBe(b.y);
  const other = createWilderness(w.seed);
  const otherTrail = pathsOf(other)
    .trailsNear(b.x0, b.z, b.x1, b.z)
    .find((t) => t.id === trail.id)!;
  expect(travellerPose(journeyOn(other.seed, otherTrail)!, time)).toEqual(middle);
});
