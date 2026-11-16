import { DataUtils } from 'three';
import { expect, it } from 'vitest';
import { MAX_COLORS } from '@/content/palette';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { buildSource } from '@/systems/wilderness/build-source';

it('keeps each petal wash inside its harvest pigment after half-float G-buffer quantization', () => {
  const kind = PIGMENT_SOURCES.findIndex((def) => def.key === 'flowers');
  for (const color of PIGMENT_SOURCES[kind]!.colors) {
    const geometry = buildSource({ id: '-1,0:0', kind, x: 0, y: 0, z: 0, color, amount: 3, ink: 2 }, () => 0);
    const codes = Array.from(geometry.getAttribute('aColor').array).filter((value) => value >= MAX_COLORS);
    const stored = codes.map((value) => DataUtils.fromHalfFloat(DataUtils.toHalfFloat(value)));
    expect(new Set(stored.map((value) => Math.floor(value) - MAX_COLORS))).toEqual(new Set([color]));
    expect(Math.max(...stored) - Math.min(...stored)).toBeGreaterThan(0.5);
    geometry.dispose();
  }
});
