import type { GameContext } from '@/game/types';
import { hashAt, unit } from '@/world/math/hash';
import { smoothstep } from '@/world/math/noise';
import { waterCurrentsOf } from '@/world/wilderness/water-current';
import { WATER_LEVEL } from '@/world/wilderness/water-level';
import { bankWavePhase } from '@/world/wilderness/water-waves';

interface SpraySite {
  x: number;
  z: number;
  dx: number;
  dz: number;
  strength: number;
  phase: number;
}

const STEP = 4;
const RANGE = 22;

/** Local breaking crests, with the same survey and clock as the moving water. */
export class RiverSpray {
  private sites: SpraySite[] = [];
  private cellX = NaN;
  private cellZ = NaN;

  constructor(private readonly ctx: GameContext) {}

  private survey(cx: number, cz: number, time: number): void {
    const world = this.ctx.wilderness;
    const field = waterCurrentsOf(world);
    const sites: SpraySite[] = [];
    for (let dz = -RANGE; dz <= RANGE; dz += STEP) {
      for (let dx = -RANGE; dx <= RANGE; dx += STEP) {
        const gx = cx + dx, gz = cz + dz;
        const x = gx + (unit(hashAt(world.seed, 'spray-x', gx, gz)) - 0.5) * STEP;
        const z = gz + (unit(hashAt(world.seed, 'spray-z', gx, gz)) - 0.5) * STEP;
        const depth = WATER_LEVEL - world.heightAt(x, z);
        if (depth < 0.12 || depth > 2.1) continue;
        const v = field.at(x, z);
        const speed = Math.hypot(v.x, v.z);
        const atBank = depth < 0.58;
        const strength = atBank
          ? smoothstep(0.08, 0.85, speed) * 0.44
          : smoothstep(1.25, 2.7, speed) * 0.73;
        if (strength < 0.16) continue;
        // Surface flow carries a breaker forward. At the bank it also runs up the local slope.
        const bx = atBank ? world.heightAt(x + 1, z) - world.heightAt(x - 1, z) : 0;
        const bz = atBank ? world.heightAt(x, z + 1) - world.heightAt(x, z - 1) : 0;
        sites.push({ x, z, dx: v.x + bx * 2.5, dz: v.z + bz * 2.5, strength, phase: bankWavePhase(x, z, time) });
      }
    }
    this.sites = sites.sort((a, b) => b.strength - a.strength).slice(0, 9);
  }

  update(): void {
    const { x, z } = this.ctx.player.position;
    const time = performance.now() / 1000;
    const cx = Math.floor(x / 12) * 12, cz = Math.floor(z / 12) * 12;
    if (cx !== this.cellX || cz !== this.cellZ) {
      this.cellX = cx;
      this.cellZ = cz;
      this.survey(cx, cz, time);
    }
    for (const site of this.sites) {
      const phase = bankWavePhase(site.x, site.z, time);
      if (site.phase < 0.68 && phase >= 0.68 && Math.hypot(x - site.x, z - site.z) < RANGE)
        this.ctx.renderer.waterSplash(site.x, site.z, site.strength, site.dx, site.dz);
      site.phase = phase;
    }
  }

  impact(x: number, z: number, strength: number): void {
    if (this.ctx.wilderness.heightAt(x, z) >= WATER_LEVEL - 0.04) return;
    const v = waterCurrentsOf(this.ctx.wilderness).at(x, z);
    this.ctx.renderer.ripple(x, z, true, Math.min(1, 0.45 + strength));
    this.ctx.renderer.waterSplash(x, z, strength, v.x, v.z);
  }
}
