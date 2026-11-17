import { expect, it } from 'vitest';
import { color } from '@/content/palette';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { buildSource } from '@/systems/wilderness/build-source';

it('anchors each harvest reed and its wind bend to its own planting site on a sloping bank', () => {
  const kind = PIGMENT_SOURCES.findIndex((source) => source.key === 'reeds');
  const ground = (x: number, z: number) => 5 + 0.5 * x - 0.25 * z;
  const geometry = buildSource(
    { id: '0,0:3', kind, x: 0, y: 5, z: 0, color: color('sky'), amount: 3, ink: 2 },
    ground,
  );
  const positions = geometry.getAttribute('position');
  const roots = geometry.getAttribute('aReedRoot');
  expect(roots.count).toBe(positions.count);
  const lowest = new Map<string, number>();
  for (let i = 0; i < roots.count; i++) {
    const x = roots.getX(i),
      z = roots.getZ(i);
    const key = `${x},${z}`;
    if (!lowest.has(key)) expect(roots.getY(i)).toBeCloseTo(ground(x, z) - 0.035, 5);
    lowest.set(key, Math.min(lowest.get(key) ?? Infinity, positions.getY(i) - ground(x, z)));
  }
  expect(lowest.size).toBe(12);
  for (const y of lowest.values()) {
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-0.06);
  }
  geometry.dispose();
});
