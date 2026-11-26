import { smoothstep } from '../math/noise';
import { type ChannelGuide, riverBankWidth, riverPool } from './drainage';
import type { Wilderness } from './generator';
import { RIVER_LANE, RIVER_ORIGIN } from './river-corridors';
import { WATER_LEVEL } from './water-level';

export const CURRENT_STEP = 6;
const CACHE_LIMIT = 48_000;
const STILL = { x: 0, z: 0 };
const fields = new WeakMap<Wilderness, WaterCurrents>();
type Velocity = Readonly<typeof STILL>;

/** Manning's open-channel relation, with depth as a proxy for hydraulic radius. */
export function channelSpeed(depth: number, slope: number): number {
  return Math.min(3.6, (Math.min(2.4, Math.max(0, depth)) ** (2 / 3) * Math.sqrt(Math.max(0, slope - 0.0006))) / 0.095);
}

export function currentSound(speed: number): number {
  return smoothstep(0.42, 2.8, speed) ** 1.5;
}

export function waterCurrentsOf(world: Wilderness): WaterCurrents {
  let field = fields.get(world);
  if (!field) {
    field = new WaterCurrents(world);
    fields.set(world, field);
  }
  return field;
}

export class WaterCurrents {
  private readonly samples = new Map<string, Velocity>();
  private readonly surfaceSamples = new Map<string, Velocity>();

  constructor(private readonly world: Wilderness) {}

  /** Physical current used by ambience, river debris and splashes. */
  at(x: number, z: number): Velocity {
    return this.sample(this.samples, x, z, false);
  }

  /** Readable surface motion, including low-gradient reaches and channels through pools. */
  surfaceAt(x: number, z: number): Velocity {
    return this.sample(this.surfaceSamples, x, z, true);
  }

  private sample(cache: Map<string, Velocity>, x: number, z: number, surface: boolean): Velocity {
    const key = `${x},${z}`;
    let result = cache.get(key);
    if (!result) {
      result = this.compute(x, z, surface);
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
    }
    return result;
  }

  private compute(x: number, z: number, surface: boolean): Velocity {
    const { world } = this;
    const lane = Math.round((x - RIVER_ORIGIN) / RIVER_LANE);
    const river = world.riverAt(lane, z);
    const { basin, branch } = world.waterGuidesAt(x, z);
    if ((!surface && basin >= 1) || (!branch && Math.abs(x - river.x) > river.half * 2.5 + 6)) return STILL;
    const tangent = (at: number) => {
      const dx = world.riverAt(lane, at + 8).x - world.riverAt(lane, at - 8).x;
      const length = Math.hypot(dx, 16);
      return { dx: dx / length, dz: 16 / length };
    };
    const initial = tangent(z);
    const centerZ = z + (x - river.x) * initial.dx * initial.dz;
    const center = world.riverAt(lane, centerZ);
    const distance = Math.hypot(x - center.x, z - centerZ);
    const half = world.terrainVersion >= 6
      ? riverBankWidth(center.half, lane, centerZ, Math.sign(x - center.x))
      : center.half;
    if (!branch && distance >= half + 3) return STILL;
    const depth = WATER_LEVEL - world.terrainHeightAt(x, z);
    if (depth <= 0.025) return STILL;

    const channelWidth = half + 3;
    // Maintain a slow through-channel in a widened pool and leave its side pockets quiet.
    const mainWidth = surface ? channelWidth * (1 - 0.24 * basin) : channelWidth;
    const mainWeight = 1 - smoothstep(0.32, 1, distance / mainWidth);
    const branchWeight = branch ? 1 - smoothstep(0.38, 1, branch.distance / branch.half) : 0;
    const main: ChannelGuide = { x: center.x, z: centerZ, ...tangent(centerZ), distance, half };
    const velocity = (
      guide: ChannelGuide, weight: number, offset: number,
      startX: number, startZ: number, endX: number, endZ: number,
    ) => {
      if (!weight) return STILL;
      // The level water mesh and carved beds do not retain the valley's incline.
      // Average the uncarved shoulders and measure their fall along the channel.
      const height = (cx: number, cz: number) => {
        const nx = guide.dz * offset, nz = -guide.dx * offset;
        return (world.rawHeightAt(cx + nx, cz + nz) + world.rawHeightAt(cx - nx, cz - nz)) * 0.5;
      };
      const fall = height(startX, startZ) - height(endX, endZ);
      const slope = fall / Math.hypot(endX - startX, endZ - startZ);
      let speed: number;
      if (guide === main) {
        // Use the broader valley to orient the reach and local grade to rate it.
        // A gravel bar or a pool's uphill lip must not reverse the surface current.
        const span = 210;
        const head = (height(world.riverAt(lane, centerZ - span).x, centerZ - span) -
          height(world.riverAt(lane, centerZ + span).x, centerZ + span)) / (span * 2);
        // Use a wider survey to choose a direction on nearly level sections.
        const reachFall = surface && Math.abs(head) < 0.001
          ? height(world.riverAt(lane, centerZ - 540).x, centerZ - 540) -
            height(world.riverAt(lane, centerZ + 540).x, centerZ + 540)
          : 0;
        const direction = Math.sign(surface && reachFall !== 0 ? reachFall : head) || (surface ? 1 : 0);
        const grade = 0.7 * Math.abs(head) + 0.3 * Math.max(0, direction * slope);
        const reachSpeed = channelSpeed(depth, grade) * (1.38 - 0.99 * riverPool(lane, centerZ)) *
          (surface ? 1 - basin * 0.8 : 1);
        const minimum = surface ? (0.48 - basin * 0.12) * smoothstep(0.035, 0.38, depth) : 0;
        speed = direction * Math.min(3.6, Math.max(minimum, reachSpeed)) * weight;
      } else {
        const minimum = surface ? 0.37 * smoothstep(0.035, 0.22, depth) : 0;
        speed = (Math.sign(slope) || (surface ? 1 : 0)) * Math.max(minimum, channelSpeed(depth, Math.abs(slope))) * weight;
      }
      if (!speed) return STILL;
      // A low spot beside a channel can be wet without belonging to it. Require
      // a wet path to the channel and a wet reach in both directions.
      const wet = (px: number, pz: number) => world.terrainHeightAt(px, pz) < WATER_LEVEL - 0.025;
      for (const t of [0.25, 0.5, 0.75, 1]) {
        if (!wet(x + (guide.x - x) * t, z + (guide.z - z) * t)) return STILL;
      }
      for (const step of [-16, -8, 8, 16]) {
        if (guide === main) {
          if (!wet(world.riverAt(lane, centerZ + step).x, centerZ + step)) return STILL;
        } else {
          if (!wet(guide.x + guide.dx * step, guide.z + guide.dz * step)) return STILL;
        }
      }
      return { x: guide.dx * speed, z: guide.dz * speed };
    };
    const along = 48;
    const riverVelocity = velocity(
      main, mainWeight, center.half + 28,
      world.riverAt(lane, centerZ - along).x, centerZ - along,
      world.riverAt(lane, centerZ + along).x, centerZ + along,
    );
    const branchVelocity = branch
      ? velocity(
          branch, branchWeight * (1 - mainWeight), 24,
          branch.x - branch.dx * 24, branch.z - branch.dz * 24,
          branch.x + branch.dx * 24, branch.z + branch.dz * 24,
        )
      : STILL;
    const mainFade = surface ? 1 : 1 - basin;
    const branchFade = 1 - basin;
    return { x: riverVelocity.x * mainFade + branchVelocity.x * branchFade,
      z: riverVelocity.z * mainFade + branchVelocity.z * branchFade };
  }
}
