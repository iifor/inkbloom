import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '@/game/types';
import { RiverSpray } from '@/systems/wilderness/river-spray';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { RIVER_ORIGIN } from '@/world/wilderness/river-corridors';

describe('riverbank spray', () => {
  afterEach(() => vi.restoreAllMocks());

  function simulate(playerX: number) {
    const waterSplash = vi.fn<GameContext['renderer']['waterSplash']>();
    const heightAt = vi.fn((x: number, z: number) => {
      const riverBank = (Math.abs(x - RIVER_ORIGIN) - 14) * 0.33;
      const pondBank = (Math.hypot(x - RIVER_ORIGIN - 50, z) - 5.3) * 0.25;
      return WATER_LEVEL + Math.min(riverBank, pondBank);
    });
    const ctx = {
      wilderness: {
        ...createWilderness(7),
        riverAt: () => ({ x: RIVER_ORIGIN, half: 16 }),
        rawHeightAt: (_x: number, z: number) => -z * 0.06,
        terrainVersion: 5,
        heightAt,
        terrainHeightAt: heightAt,
        waterGuidesAt: () => ({ basin: 0, branch: null }),
      },
      player: { position: { x: playerX, z: 0 } },
      renderer: { waterSplash },
    } as unknown as GameContext;
    const clock = vi.spyOn(performance, 'now');
    const spray = new RiverSpray(ctx);
    for (let ms = 0; ms <= 1700; ms += 25) {
      clock.mockReturnValue(ms);
      spray.update();
    }
    const moveTo = (z: number) => {
      ctx.player.position.z = z;
      spray.update();
    };
    return { calls: waterSplash.mock.calls, heightAt, moveTo };
  }

  it('emits at the wet edge and aims the spray toward land', () => {
    const { calls, heightAt } = simulate(RIVER_ORIGIN + 13);
    const bankBursts = calls.filter((call) => call[5]);
    expect(bankBursts.length).toBeGreaterThan(1);
    for (const [x, z, strength, , , normal] of bankBursts) {
      expect(WATER_LEVEL - heightAt(x, z)).toBeGreaterThan(0);
      expect(WATER_LEVEL - heightAt(x, z)).toBeLessThan(0.17);
      expect(heightAt(x + normal!.x, z + normal!.z)).toBeGreaterThan(WATER_LEVEL);
      expect(strength).toBeGreaterThan(0.28);
    }
  });

  it('keeps disconnected still water free of automatic spray', () => {
    expect(simulate(RIVER_ORIGIN + 50).calls).toHaveLength(0);
  });

  it('surveys only newly entered grid cells and reuses the survey when backtracking', () => {
    const { heightAt, moveTo } = simulate(RIVER_ORIGIN + 13);
    const first = heightAt.mock.calls.length;
    heightAt.mockClear();
    moveTo(8);
    const next = heightAt.mock.calls.length;
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(first / 4);
    heightAt.mockClear();
    moveTo(0);
    expect(heightAt).not.toHaveBeenCalled();
  });
});
