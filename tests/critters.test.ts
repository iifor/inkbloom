import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Critters } from '@/engine/render/critters';

/** The critters' point attributes (positions, glow, wing beat), read back for the test. */
const points = (
  c: Critters,
): { glow: Float32Array; flap: Float32Array; fly: Float32Array; bfly: Float32Array } => {
  const inner = c as unknown as {
    flyGlow: Float32Array;
    bflyFlap: Float32Array;
    flyPos: Float32Array;
    bflyPos: Float32Array;
  };
  return { glow: inner.flyGlow, flap: inner.bflyFlap, fly: inner.flyPos, bfly: inner.bflyPos };
};
const flat = (): number => 0;

describe('critters', () => {
  it('none are out when the levels are zero, some when they are up', () => {
    const c = new Critters(new THREE.Texture());
    const calm = { windX: 0, windZ: 0 };
    for (let i = 0; i < 60; i++) c.update(1 / 30, 0, 0, flat, { fireflies: 0, butterflies: 0, ...calm });
    expect(points(c).glow.every((g) => g === 0)).toBe(true);
    expect(points(c).flap.every((f) => f < 0)).toBe(true);
    for (let i = 0; i < 120; i++) c.update(1 / 30, 0, 0, flat, { fireflies: 1, butterflies: 0.5, ...calm });
    expect(points(c).glow.some((g) => g > 0.5)).toBe(true);
    const out = points(c).flap.filter((f) => f >= 0).length;
    expect(out).toBeGreaterThan(5);
    expect(out).toBeLessThan(points(c).flap.length);
  });

  it('keep up with a walker: none are left far behind', () => {
    const c = new Critters(new THREE.Texture());
    const levels = { fireflies: 1, butterflies: 1, windX: 2, windZ: 0 };
    let x = 0;
    for (let i = 0; i < 30 * 40; i++) {
      x += 5 / 30;
      c.update(1 / 30, x, 0, flat, levels);
    }
    const { fly, bfly } = points(c);
    for (const pos of [fly, bfly])
      for (let i = 0; i < pos.length; i += 3) expect(Math.hypot(pos[i]! - x, pos[i + 2]!)).toBeLessThan(40);
  });

  it('float above the ground they are over', () => {
    const c = new Critters(new THREE.Texture());
    const hill = (): number => 12;
    c.update(1 / 30, 0, 0, hill, { fireflies: 1, butterflies: 1, windX: 0, windZ: 0 });
    const { fly, bfly } = points(c);
    for (const pos of [fly, bfly])
      for (let i = 1; i < pos.length; i += 3) {
        expect(pos[i]).toBeGreaterThan(12.1);
        expect(pos[i]).toBeLessThan(15);
      }
  });
});
