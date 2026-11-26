import type { GameContext } from '@/game/types';
import { hashAt, unit } from '@/world/math/hash';
import { smoothstep } from '@/world/math/noise';
import { waterCurrentsOf } from '@/world/wilderness/water-current';
import { WATER_LEVEL } from '@/world/wilderness/water-level';
import { BANK_CREST_PHASE, BANK_LAP_RATE, bankWavePhase } from '@/world/wilderness/water-waves';

interface Breaker {
  x: number;
  z: number;
  dx: number;
  dz: number;
  strength: number;
  phaseOffset: number;
  bankNormal?: { x: number; z: number };
}

type SpraySite = Breaker & { phase: number };
type SurveyTile = { bank: Breaker[]; channel?: Breaker };

const STEP = 4;
const RANGE = 22;
const SURVEY_RADIUS = RANGE + 6;
const GRID_EDGES = [[STEP, 0], [0, STEP]] as const;
const CACHE_LIMIT = 2048;

function phaseAt(site: Breaker, clock: number): number {
  const phase = clock + site.phaseOffset;
  return phase - Math.floor(phase);
}

/** Keep the shoreline's own emitters even when the middle of the river is faster. */
function nearestBreakers(sites: Breaker[], x: number, z: number, limit: number): Breaker[] {
  const ranked = sites.map((site) => ({ site, score: site.strength - Math.hypot(site.x - x, site.z - z) * 0.025 }));
  const selected: Breaker[] = [];
  for (const { site } of ranked.sort((a, b) => b.score - a.score)) {
    if (selected.some((other) => Math.hypot(other.x - site.x, other.z - site.z) < 3.0)) continue;
    selected.push(site);
    if (selected.length === limit) break;
  }
  return selected;
}

/** Local breaking crests, with the same survey and clock as the moving water. */
export class RiverSpray {
  private sites: SpraySite[] = [];
  private readonly heights = new Map<string, number>();
  private readonly tiles = new Map<string, SurveyTile>();
  private cellX = NaN;
  private cellZ = NaN;

  constructor(private readonly ctx: GameContext) {}

  private bankSite(wetX: number, wetZ: number, dryX: number, dryZ: number): Breaker | undefined {
    const world = this.ctx.wilderness;
    const field = waterCurrentsOf(world);
    // Follow the terrain between the wet and dry samples to put the burst at their boundary.
    let wet = 0, dry = 1;
    const ax = dryX - wetX, az = dryZ - wetZ;
    for (let i = 0; i < 5; i++) {
      const mid = (wet + dry) * 0.5;
      if (world.heightAt(wetX + ax * mid, wetZ + az * mid) < WATER_LEVEL) wet = mid;
      else dry = mid;
    }
    let launch = Math.max(0, wet - 0.065);
    if (world.heightAt(wetX + ax * launch, wetZ + az * launch) >= WATER_LEVEL) launch = wet;
    const x = wetX + ax * launch;
    const z = wetZ + az * launch;
    const bx = world.heightAt(x + 0.6, z) - world.heightAt(x - 0.6, z);
    const bz = world.heightAt(x, z + 0.6) - world.heightAt(x, z - 0.6);
    const slope = Math.hypot(bx, bz);
    const bankNormal = slope > 0.025 && bx * ax + bz * az > 0
      ? { x: bx / slope, z: bz / slope }
      : { x: ax / STEP, z: az / STEP };
    const v = field.surfaceAt(wetX, wetZ);
    const inward = field.surfaceAt(x - bankNormal.x * 3.2, z - bankNormal.z * 3.2);
    const flow = Math.hypot(v.x, v.z) > Math.hypot(inward.x, inward.z) ? v : inward;
    const speed = Math.hypot(flow.x, flow.z);
    if (speed < 0.07) return undefined;
    const strength = 0.28 + smoothstep(0.07, 1.35, speed) * 0.60;
    return { x, z, dx: flow.x, dz: flow.z, strength, bankNormal, phaseOffset: bankWavePhase(x, z, 0) };
  }

  private gridHeight(x: number, z: number): number {
    const key = `${x},${z}`;
    const cached = this.heights.get(key);
    if (cached !== undefined) return cached;
    const height = this.ctx.wilderness.heightAt(x, z);
    this.heights.set(key, height);
    return height;
  }

  private surveyTile(gx: number, gz: number): SurveyTile {
    const key = `${gx},${gz}`;
    const cached = this.tiles.get(key);
    if (cached) return cached;
    const world = this.ctx.wilderness;
    const tile: SurveyTile = { bank: [] };
    const wet = this.gridHeight(gx, gz) < WATER_LEVEL;
    for (const [offsetX, offsetZ] of GRID_EDGES) {
      const x = gx + offsetX, z = gz + offsetZ;
      if (wet === (this.gridHeight(x, z) < WATER_LEVEL)) continue;
      const site = wet ? this.bankSite(gx, gz, x, z) : this.bankSite(x, z, gx, gz);
      if (site) tile.bank.push(site);
    }
    const x = gx + (unit(hashAt(world.seed, 'spray-x', gx, gz)) - 0.5) * STEP;
    const z = gz + (unit(hashAt(world.seed, 'spray-z', gx, gz)) - 0.5) * STEP;
    const depth = WATER_LEVEL - world.heightAt(x, z);
    if (depth >= 0.58 && depth <= 2.1) {
      const v = waterCurrentsOf(world).at(x, z);
      const strength = smoothstep(1.25, 2.7, Math.hypot(v.x, v.z)) * 0.73;
      if (strength >= 0.16) tile.channel = { x, z, dx: v.x, dz: v.z, strength, phaseOffset: bankWavePhase(x, z, 0) };
    }
    this.tiles.set(key, tile);
    return tile;
  }

  private survey(cx: number, cz: number, clock: number): void {
    const bank: Breaker[] = [];
    const channel: Breaker[] = [];
    for (let z = cz - SURVEY_RADIUS; z < cz + SURVEY_RADIUS; z += STEP) {
      for (let x = cx - SURVEY_RADIUS; x < cx + SURVEY_RADIUS; x += STEP) {
        const tile = this.surveyTile(x, z);
        bank.push(...tile.bank);
        if (tile.channel) channel.push(tile.channel);
      }
    }
    // Evict old cells incrementally so long walks do not invalidate the current survey.
    while (this.tiles.size > CACHE_LIMIT) this.tiles.delete(this.tiles.keys().next().value!);
    while (this.heights.size > CACHE_LIMIT) this.heights.delete(this.heights.keys().next().value!);
    this.sites = [...nearestBreakers(bank, cx, cz, 6), ...nearestBreakers(channel, cx, cz, 4)]
      .map((site) => ({ ...site, phase: phaseAt(site, clock) }));
  }

  update(): void {
    const { x, z } = this.ctx.player.position;
    const clock = performance.now() / 1000 * BANK_LAP_RATE;
    const cx = Math.round(x / 8) * 8, cz = Math.round(z / 8) * 8;
    if (cx !== this.cellX || cz !== this.cellZ) {
      this.cellX = cx;
      this.cellZ = cz;
      this.survey(cx, cz, clock);
    }
    for (const site of this.sites) {
      const phase = phaseAt(site, clock);
      const trigger = site.bankNormal ? BANK_CREST_PHASE - 0.08 : 0.68;
      if (site.phase < trigger && phase >= trigger && Math.hypot(x - site.x, z - site.z) < RANGE)
        this.ctx.renderer.waterSplash(site.x, site.z, site.strength, site.dx, site.dz, site.bankNormal);
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
