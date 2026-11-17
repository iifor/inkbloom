import { expect, it } from 'vitest';
import { color } from '@/content/palette';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { buildSource } from '@/systems/wilderness/build-source';

const kind = PIGMENT_SOURCES.findIndex((def) => def.key === 'ore');

it.each(PIGMENT_SOURCES[kind]!.colors)('builds ore in colour %i as faceted rock with a seam of it', (pigment) => {
  for (const id of ['-2,0:2', '4,1:2', '-3,-1:2']) {
    const geometry = buildSource({ id, kind, x: 0, y: 0, z: 0, color: pigment, amount: 4, ink: 4 }, (x) => x * 0.2);
    expect(new Set(geometry.getAttribute('aColor').array)).toEqual(new Set([color('rock'), pigment]));
    // flat shaded: every triangle's corners share one normal, so the light lies on it in planes
    const normal = geometry.getAttribute('normal');
    expect(geometry.index).toBeNull();
    for (let a = 0; a < normal.count; a += 3) {
      for (const k of [a + 1, a + 2]) {
        expect(normal.getX(k)).toBeCloseTo(normal.getX(a), 4);
        expect(normal.getY(k)).toBeCloseTo(normal.getY(a), 4);
      }
    }
    // small enough to stand where it was placed, on the slope it was placed on
    const box = geometry.boundingBox!;
    expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)).toBeLessThan(2.6);
    expect(box.min.y).toBeGreaterThan(-1);
    expect(box.max.y).toBeGreaterThan(1);
    geometry.dispose();
  }
});
