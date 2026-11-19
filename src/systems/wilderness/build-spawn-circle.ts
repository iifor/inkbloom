import { color } from '@/content/palette';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Wilderness } from '@/world/wilderness/generator';
import { SPAWN_CENTER, SPAWN_STONE_RADIUS } from '@/world/wilderness/spawn-circle';

/** Low paving with concentric stone courses and a central compass rose. */
export function appendSpawnCircle(world: Wilderness, g: GeometryBuilder): void {
  const stone = color('stone');
  const rock = color('rock');
  const dark = color('bark');
  const up = { x: 0, y: 1, z: 0 };
  const rings = [0, 0.45, 1.25, 1.49, 2.34, 3.16, 3.79, 4.16, SPAWN_STONE_RADIUS];
  const count = 48;
  const point = (r: number, i: number) => {
    const a = (i / count) * Math.PI * 2;
    const x = SPAWN_CENTER + r * Math.cos(a);
    const z = SPAWN_CENTER + r * Math.sin(a);
    return { x, y: world.heightAt(x, z) + (r === SPAWN_STONE_RADIUS ? 0.075 : 0.13), z };
  };
  for (let j = 0; j < rings.length - 1; j++) {
    const r0 = rings[j]!;
    const r1 = rings[j + 1]!;
    for (let i = 0; i < count; i++) {
      const a = point(r0, i);
      const b = point(r0, i + 1);
      const c = point(r1, i + 1);
      const d = point(r1, i);
      const tint = j === 2 || j === 6 ? dark : (i * 7 + j * 11) % 13 < 4 ? rock : stone;
      if (j === 0) g.quad(a, c, d, a, up, stone);
      else g.quad(a, b, c, d, up, tint);
    }
  }
  for (let i = 0; i < count; i += 6) {
    const mark = (r: number, k: number) => {
      const p = point(r, k);
      return { ...p, y: p.y + 0.025 };
    };
    const a = mark(0.23, i);
    const b = mark(0.55, i + 1.5);
    const c = mark(i % 12 === 0 ? 1.15 : 0.89, i);
    const d = mark(0.55, i - 1.5);
    g.quad(a, b, c, d, up, i % 12 === 0 ? dark : rock);
  }
}
