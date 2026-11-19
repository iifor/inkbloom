import { smoothstep } from '../math/noise';
import type { ChannelGuide } from './drainage';
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
  return smoothstep(0.25, 2.35, speed);
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

  constructor(private readonly world: Wilderness) {}

  /** World-aligned samples shared by the shader and the spatial audio survey. */
  at(x: number, z: number): Velocity {
    const key = `${x},${z}`;
    let result = this.samples.get(key);
    if (!result) {
      result = this.compute(x, z);
      if (this.samples.size >= CACHE_LIMIT) this.samples.delete(this.samples.keys().next().value!);
      this.samples.set(key, result);
    }
    return result;
  }

  private compute(x: number, z: number): Velocity {
    const { world } = this;
    const lane = Math.round((x - RIVER_ORIGIN) / RIVER_LANE);
    const river = world.riverAt(lane, z);
    const distance = Math.abs(x - river.x);
    const { basin, branch } = world.waterGuidesAt(x, z);
    if (basin >= 1 || (!branch && distance >= river.half + 3)) return STILL;
    const depth = WATER_LEVEL - world.terrainHeightAt(x, z);
    if (depth <= 0.025) return STILL;

    const mainWeight = 1 - smoothstep(0.48, 1, distance / (river.half + 3));
    const branchWeight = branch ? 1 - smoothstep(0.38, 1, branch.distance / branch.half) : 0;
    const along = 48;
    const a = world.riverAt(lane, z - along).x;
    const b = world.riverAt(lane, z + along).x;
    const length = Math.hypot(b - a, along * 2);
    const dx = (b - a) / length, dz = (along * 2) / length;
    const main: ChannelGuide = { x: river.x, z, dx, dz, distance, half: river.half };
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
      const speed = Math.sign(slope) * channelSpeed(depth, Math.abs(slope)) * weight;
      if (!speed) return STILL;
      // A low spot beside a channel can be wet without belonging to it. Require
      // a wet path to the channel and a wet reach in both directions.
      const wet = (px: number, pz: number) => world.terrainHeightAt(px, pz) < WATER_LEVEL - 0.025;
      for (const t of [0.25, 0.5, 0.75, 1]) {
        if (!wet(x + (guide.x - x) * t, z + (guide.z - z) * t)) return STILL;
      }
      for (const step of [-16, -8, 8, 16]) {
        if (guide === main) {
          if (!wet(world.riverAt(lane, z + step).x, z + step)) return STILL;
        } else {
          if (!wet(guide.x + guide.dx * step, guide.z + guide.dz * step)) return STILL;
        }
      }
      return { x: guide.dx * speed, z: guide.dz * speed };
    };
    const riverVelocity = velocity(main, mainWeight, river.half + 28, a, z - along, b, z + along);
    const branchVelocity = branch
      ? velocity(
          branch, branchWeight * (1 - mainWeight), 24,
          branch.x - branch.dx * 24, branch.z - branch.dz * 24,
          branch.x + branch.dx * 24, branch.z + branch.dz * 24,
        )
      : STILL;
    return {
      x: (riverVelocity.x + branchVelocity.x) * (1 - basin),
      z: (riverVelocity.z + branchVelocity.z) * (1 - basin),
    };
  }
}
