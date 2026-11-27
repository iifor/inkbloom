import { DataUtils } from 'three';
import { expect, it, vi } from 'vitest';
import { RIVER_SAMPLES, RiverTable } from '@/engine/render/water-paint';
import { CURRENT_STEP } from '@/world/wilderness/water-current';

const flow = (x: number, z: number) => ({ x: Math.sin(x / 20), z: Math.cos(z / 30) });
function finish(table: RiverTable): void {
  for (let frame = 0; frame < 2000 && !table.ready; frame++) table.update(1);
  expect(table.ready).toBe(true);
}
function matches(table: RiverTable, x: number, z: number): void {
  expect([table.grid.x, table.grid.y]).toEqual([x, z]);
  const expected = new Uint16Array(RIVER_SAMPLES ** 2 * 2);
  for (let row = 0; row < RIVER_SAMPLES; row++)
    for (let col = 0; col < RIVER_SAMPLES; col++) {
      const v = flow(x + col * CURRENT_STEP, z + row * CURRENT_STEP);
      const i = (row * RIVER_SAMPLES + col) * 2;
      expected[i] = DataUtils.toHalfFloat(v.x);
      expected[i + 1] = DataUtils.toHalfFloat(v.z);
    }
  expect(table.texture.image.data).toEqual(expected);
}

it('publishes complete current fields atomically and reuses the overlapping samples', () => {
  const table = new RiverTable();
  const sample = vi.fn(flow);
  table.request(0, 0, sample);
  finish(table);
  matches(table, 0, 0);
  expect(sample).toHaveBeenCalledTimes(RIVER_SAMPLES ** 2);
  sample.mockClear();
  const old = table.texture.image.data.slice();
  const version = table.texture.version;
  table.request(192, -192, sample);
  let time = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => (time += 0.5));
  try {
    table.update(0.8);
  } finally {
    clock.mockRestore();
  }
  expect(table.ready).toBe(false);
  expect(table.texture.image.data).toEqual(old);
  expect(table.texture.version).toBe(version);
  expect([table.grid.x, table.grid.y]).toEqual([0, 0]);
  finish(table);
  matches(table, 192, -192);
  expect(sample).toHaveBeenCalledTimes(RIVER_SAMPLES ** 2 - (RIVER_SAMPLES - 32) ** 2);
  table.request(192, -192, sample);
  expect(table.ready).toBe(true);
  table.dispose();
});

it('replaces obsolete requests during a teleport and cancels pending work on disposal', () => {
  const table = new RiverTable();
  table.request(0, 0, flow);
  finish(table);
  table.request(192, 0, flow);
  table.request(-1920, 1920, flow);
  finish(table);
  matches(table, -1920, 1920);
  const sample = vi.fn(flow);
  table.request(9000, 9000, sample);
  table.dispose();
  table.update(100);
  expect(sample).not.toHaveBeenCalled();
  expect(table.ready).toBe(true);
});
