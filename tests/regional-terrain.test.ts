import { describe, expect, it } from 'vitest';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { createDrainage, DRAINAGE_REACH } from '@/world/wilderness/drainage';
import { createLandforms } from '@/world/wilderness/landforms';
import { RIVER_LANE, RIVER_ORIGIN } from '@/world/wilderness/river-corridors';
import { createWorldState, deserializeWorld, serializeWorld } from '@/world/state';
import { townLayout } from '@/world/city/layout';
import { findArenaSite } from '@/world/arena/site';

describe('regional terrain and saved worlds', () => {
  it('keeps exact landform samples after cache eviction and never snaps fractional coordinates', () => {
    const land = createLandforms(4242);
    const expected = land(-1200, -600);
    const fractional = land(-1199.875, -600.125);
    expect(fractional).not.toEqual(expected);
    const copy = land(-1200, -600);
    copy.height = -999;
    expect(land(-1200, -600)).toEqual(expected);
    for (let i = 0; i < 140; i++) land(i * 128, 10000);
    expect(land(-1200, -600)).toEqual(expected);
    expect(land(-1199.875, -600.125)).toEqual(fractional);
  });
  it('keeps recorded old-world heights and town footprints exactly', () => {
    const samples = [
      {
        seed: 42,
        raw: [
          0.5692521126564223, 2.4898348374618786, -1.7598434304583521, 1.6513773106835206, 1.2710362595558267,
        ],
        ground: [1.25, -0.693229004740715, -1.2000000476837158, 2.469499349594116, 1.2710362672805786],
        town: [1656, 2580, 384, 1.8444040619837958],
      },
      {
        seed: 4242,
        raw: [1.6174797836649368, 4.795638394944348, 1.0202101587141255, 3.93275188672267, 1.994286074878105],
        ground: [
          1.6174798011779785, -1.134778618812561, 1.2810009717941284, 2.9466090202331543, 1.994286060333252,
        ],
        town: [1652, 2520, 384, 4.026147289391135],
      },
      {
        seed: 717,
        raw: [
          2.693144551109786, 10.886079744474248, 2.686430000822943, 2.3337089239585738, -0.209014669550443,
        ],
        ground: [
          2.6931445598602295, -1.1617974936962128, 2.686429977416992, 1.8109909296035767, -0.2090146690607071,
        ],
        town: [1604, 2544, 512, 5.032996241264982],
      },
    ];
    const points = [
      [64, 64],
      [126, 320],
      [-1472, -592],
      [2800, 1700],
      [-4400, 3200],
    ];
    for (const s of samples) {
      const w = createWilderness(s.seed, [], 1);
      expect(points.map(([x, z]) => w.rawHeightAt(x!, z!))).toEqual(s.raw);
      expect(points.map(([x, z]) => w.terrainHeightAt(x!, z!))).toEqual(s.ground);
      const t = w.entranceInCell(2, 3)!;
      expect([t.ox, t.oz, t.size, t.y]).toEqual(s.town);
    }
  });

  it('preserves older terrain versions and round-trips new worlds with the connected river network', () => {
    const state = createWorldState('terrain-qa', 4242);
    state.clock = 1234;
    state.harvested.set('test-source', 1230);
    state.discovered.push('c2_1');
    expect(deserializeWorld(serializeWorld(state)).terrainVersion).toBe(5);
    const json = JSON.parse(serializeWorld(state));
    for (const terrainVersion of [2, 3, 4]) {
      const surveyed = deserializeWorld(JSON.stringify({ ...json, terrainVersion }));
      expect(deserializeWorld(serializeWorld(surveyed)).terrainVersion).toBe(terrainVersion);
    }
    for (const version of [1, 2, 3, 4, 5]) {
      const old = deserializeWorld(JSON.stringify({ ...json, version, terrainVersion: undefined }));
      expect(old.terrainVersion).toBe(1);
      expect(old.clock).toBe(1234);
      expect(old.harvested.get('test-source')).toBe(1230);
      expect(old.discovered.includes('c2_1')).toBe(true);
      expect(deserializeWorld(serializeWorld(old)).terrainVersion).toBe(1);
    }
    for (const terrainVersion of [undefined, 0, 6, '2'])
      expect(() => deserializeWorld(JSON.stringify({ ...json, terrainVersion }))).toThrow('地形版本');
  });

  it('separates broad plains and ridges without a jump at the starter transition', () => {
    const w = createWilderness(4242),
      old = createWilderness(4242, [], 1);
    expect(w.entranceInCell(0, 0)).toEqual(old.entranceInCell(0, 0));
    expect(w.heightAt(64, 64)).toBe(old.heightAt(64, 64));
    let plains = 0,
      peaks = 0;
    const land = createLandforms(4242);
    for (let x = -4000; x <= 4000; x += 200)
      for (let z = -4000; z <= 4000; z += 200) {
        const h = land(x, z).height;
        if (h < 10) plains++;
        if (h > 45) peaks++;
        expect(Math.abs(h - land(x + 0.01, z).height)).toBeLessThan(0.1);
      }
    expect(plains).toBeGreaterThan(100);
    expect(peaks).toBeGreaterThan(100);
    for (const radius of [700, 1100])
      for (let a = 0; a < Math.PI * 2; a += 0.4) {
        const x = 64 + radius * Math.cos(a),
          z = 64 + radius * Math.sin(a);
        expect(Math.abs(w.rawHeightAt(x + 0.001, z) - w.rawHeightAt(x - 0.001, z))).toBeLessThan(0.01);
      }
  });

  it('routes a river toward the low corridor, joins reaches and survives cache eviction', () => {
    const elevation = (x: number, z: number) => 5 + Math.abs(x - (220 + 24 * Math.sin(z / 700))) * 0.2;
    const a = createDrainage(4242, elevation),
      b = createDrainage(4242, elevation);
    let chosen = 0,
      straight = 0;
    for (let z = -4096; z < 4096; z += 32) {
      const r = a.riverAt(0, z);
      chosen += elevation(r.x, z);
      straight += elevation(126, z);
      expect(a.riverGround(30, r.x, z)).toBeLessThan(WATER_LEVEL - 2);
    }
    expect(chosen).toBeLessThan(straight * 0.65);
    for (let row = -4; row <= 4; row++) {
      const z = row * DRAINAGE_REACH;
      expect(Math.abs(a.riverAt(0, z - 0.001).x - a.riverAt(0, z + 0.001).x)).toBeLessThan(0.01);
    }
    for (let i = 0; i < 270; i++) a.riverAt(i, 200);
    expect(a.riverAt(0, -33)).toEqual(b.riverAt(0, -33));
    for (const x of [-234, 486, 1206])
      for (let z = -1024; z < 2048; z += 37) {
        const ground = (x: number) => a.basinGround(a.riverGround(30, x, z), x, z);
        expect(Math.abs(ground(x - 0.001) - ground(x + 0.001))).toBeLessThan(0.02);
      }
  });

  it('connects adjacent main rivers with shallow water on the terrain grid and leaves ridges intact', () => {
    const seed = 4242;
    const elevation = createLandforms(seed);
    const drainage = createDrainage(seed, (x, z) => elevation(x, z).height, true);
    const world = createWilderness(seed);
    const old = createWilderness(seed, [], 2);
    const step = 4;
    const middle = Math.round((RIVER_ORIGIN + RIVER_LANE / 2) / step) * step;
    let connected = false;
    for (let row = 1; row < 8 && !connected; row++) {
      const minZ = row * DRAINAGE_REACH;
      const maxZ = minZ + DRAINAGE_REACH;
      for (let z = minZ; z < maxZ; z += step) {
        if (drainage.crossChannelGround(10, middle, z) >= WATER_LEVEL) continue;
        if (old.terrainHeightAt(middle, z) <= WATER_LEVEL) continue;
        expect(world.terrainHeightAt(middle, z)).toBeLessThan(WATER_LEVEL);
        expect(world.terrainHeightAt(middle, z)).toBeGreaterThan(WATER_LEVEL - 0.6);
        const queue = [{ x: middle, z }];
        const visited = new Set<string>();
        const joined = [false, false];
        for (let i = 0; i < queue.length && !joined.every(Boolean); i++) {
          const { x, z } = queue[i]!;
          const key = `${x},${z}`;
          if (visited.has(key) || z < minZ || z >= maxZ || Math.abs(x - middle) > RIVER_LANE) continue;
          visited.add(key);
          if (world.heightAt(x, z) >= WATER_LEVEL) continue;
          for (const lane of [0, 1]) {
            const river = world.riverAt(lane, z);
            if (Math.abs(x - river.x) < river.half / 2) joined[lane] = true;
          }
          queue.push({ x: x + step, z }, { x: x - step, z }, { x, z: z + step }, { x, z: z - step });
        }
        connected = joined.every(Boolean);
        break;
      }
    }
    expect(connected).toBe(true);

    const ridge = createDrainage(seed, (x) => (Math.abs(x - middle) < 40 ? 40 : 4), true);
    for (let z = DRAINAGE_REACH; z < 8 * DRAINAGE_REACH; z += step) {
      expect(ridge.crossChannelGround(40, middle, z)).toBe(40);
    }
  });

  it('rebuilds the same regional town layout in a separate worker-equivalent world', () => {
    const state = createWorldState('client-worker', 4242);
    const a = createWilderness(state.seed, state.legacyTowns, state.terrainVersion);
    const b = createWilderness(state.seed, state.legacyTowns, state.terrainVersion);
    const t = a.entranceInCell(2, 3)!;
    expect(b.entranceInCell(2, 3)).toEqual(t);
    expect(townLayout(t, a)).toEqual(townLayout(t, b));
    const old = createWilderness(state.seed, [], 1);
    expect(findArenaSite(a)).not.toBe(findArenaSite(old));
    for (const village of a.entrancesNear(3000, 2000, 1)) {
      expect(village.y).toBeGreaterThan(WATER_LEVEL);
      expect(village.size).toBeGreaterThan(0);
    }
  });
});
