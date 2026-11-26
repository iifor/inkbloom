// Terrain-guided lowland drainage, not a hydraulic erosion simulation. River reaches are
// searched on the uncarved terrain, independently of generation order. Shared endpoint
// anchors join reaches. Elevated tributaries are dry gullies until they reach water level.
import { hashAt, unit } from '../math/hash';
import { lerp, smoothstep } from '../math/noise';
import { WATER_LEVEL } from './water-level';
import { RIVER_LANE as LANE, RIVER_ORIGIN as ORIGIN, RIVER_X } from './river-corridors';

export const DRAINAGE_REACH = 1024;

/** Alternating shallow riffles and pools along a reach, shared with the current model. */
export function riverPool(lane: number, z: number): number {
  const reach = 0.68 * Math.sin(z / 36 + lane * 2.1) + 0.32 * Math.sin(z / 17 - lane * 1.7);
  return smoothstep(-0.7, 0.72, reach);
}

/** Pools spread out, riffles contract, and each bank has its own gradual bends. */
export function riverBankWidth(half: number, lane: number, z: number, side: number): number {
  const spread = lerp(0.8, 1.21, riverPool(lane, z));
  const bends = 0.10 * Math.sin(z / 27 + side * 1.5 + lane) + 0.06 * Math.sin(z / 11 + side * 1.9);
  return half * (spread + bends);
}
const STEP = 64,
  COLUMNS = 13,
  SPACING = 32,
  HALF = 6;
interface Channel<Point> {
  points: Point[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
interface Point {
  x: number;
  z: number;
}
export interface ChannelGuide {
  x: number;
  z: number;
  dx: number;
  dz: number;
  distance: number;
  half: number;
}

function projectChannel(channel: Channel<Point>, x: number, z: number, half: number): ChannelGuide | null {
  if (x < channel.minX || x > channel.maxX || z < channel.minZ || z > channel.maxZ) return null;
  let best: ChannelGuide | null = null;
  for (let i = 0; i + 1 < channel.points.length; i++) {
    const a = channel.points[i]!, b = channel.points[i + 1]!;
    if (x < Math.min(a.x, b.x) - half || x > Math.max(a.x, b.x) + half ||
        z < Math.min(a.z, b.z) - half || z > Math.max(a.z, b.z) + half) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    const t = Math.max(0, Math.min(length, (x - a.x) * dx + (z - a.z) * dz));
    const px = a.x + dx * t, pz = a.z + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < (best?.distance ?? half)) best = { x: px, z: pz, dx, dz, distance, half };
  }
  return best;
}
type Tributary = Channel<Point & { y: number }>;
const CROSS_BANK = 24;
const STARTER_CENTER = ORIGIN - RIVER_X;
interface Lake {
  x: number;
  z: number;
  rx: number;
  rz: number;
}
interface Reach {
  xs: Float64Array;
  lake: Lake | null;
  tributary: Tributary;
}

export interface Drainage {
  riverAt(lane: number, z: number): { x: number; half: number };
  /** Valley and main channel only; used to grade towns without moving river courses. */
  riverGround(h: number, x: number, z: number, course?: Drainage['riverAt'], valleyStrength?: number): number;
  /** Tributary gullies, connected basin lakes and cross channels. */
  basinGround(h: number, x: number, z: number): number;
  crossChannelGround(h: number, x: number, z: number): number;
  waterGuidesAt(x: number, z: number): { basin: number; branch: ChannelGuide | null };
}

export function createDrainage(
  seed: number,
  elevation: (x: number, z: number) => number,
  connected = false,
  shapedBed = false,
): Drainage {
  const reaches = new Map<string, Reach>();
  const anchors = new Map<string, number>();
  const crossChannels = new Map<string, Channel<Point> | null>();
  const xpos = (lane: number, column: number) => ORIGIN + lane * LANE + (column - HALF) * SPACING;
  const anchor = (lane: number, row: number): number => {
    const key = `${lane},${row}`;
    const known = anchors.get(key);
    if (known !== undefined) return known;
    let best = HALF,
      score = Infinity;
    for (let c = 0; c < COLUMNS; c++) {
      const h = elevation(xpos(lane, c), row * DRAINAGE_REACH);
      const cost = h + Math.abs(c - HALF) * 0.45;
      if (cost < score) {
        score = cost;
        best = c;
      }
    }
    if (anchors.size > 512) anchors.clear();
    anchors.set(key, best);
    return best;
  };
  const reach = (lane: number, row: number): Reach => {
    const key = `${lane},${row}`;
    const known = reaches.get(key);
    if (known) return known;
    const rows = DRAINAGE_REACH / STEP;
    const start = anchor(lane, row),
      end = anchor(lane, row + 1);
    const costs = new Float64Array((rows + 1) * COLUMNS).fill(Infinity);
    const parents = new Int8Array(costs.length).fill(-1);
    costs[start] = 0;
    for (let r = 1; r <= rows; r++)
      for (let c = 0; c < COLUMNS; c++) {
        const x = xpos(lane, c),
          z = row * DRAINAGE_REACH + r * STEP;
        const h = elevation(x, z);
        const cut = h + Math.max(0, h - 12) * 1.8;
        for (let prev = Math.max(0, c - 1); prev <= Math.min(COLUMNS - 1, c + 1); prev++) {
          const cost =
            costs[(r - 1) * COLUMNS + prev]! + cut + 4 * (c - prev) ** 2 + 0.15 * Math.abs(c - HALF);
          if (cost < costs[r * COLUMNS + c]!) {
            costs[r * COLUMNS + c] = cost;
            parents[r * COLUMNS + c] = prev;
          }
        }
      }
    const xs = new Float64Array(rows + 1);
    for (let r = rows, c = end; r >= 0; r--) {
      xs[r] = xpos(lane, c);
      if (r) c = parents[r * COLUMNS + c]!;
    }
    // A short smoothing pass preserves the shared reach anchors and bounds the river turn.
    const raw = xs.slice();
    for (let r = 1; r < rows; r++) xs[r] = (raw[r - 1]! + 2 * raw[r]! + raw[r + 1]!) / 4;
    const roll = hashAt(seed, 'drainage-basin', lane, row);
    let lake: Lake | null = null;
    if (unit(roll) < 0.58) {
      let at = 4,
        best = Infinity;
      for (const r of [4, 8, 12]) {
        const x = xs[r]!,
          z = row * DRAINAGE_REACH + r * STEP;
        const h = elevation(x, z);
        const rough = Math.abs(elevation(x - 64, z) - elevation(x + 64, z));
        if (h + rough < best) {
          best = h + rough;
          at = r;
        }
      }
      // Don't hollow out a mountain summit just to satisfy a lake quota.
      if (best < 22)
        lake = {
          x: xs[at]! + (unit(hashAt(roll, 'side')) < 0.5 ? -22 : 22),
          z: row * DRAINAGE_REACH + at * STEP,
          rx: 55 + 32 * unit(hashAt(roll, 'width')),
          rz: 65 + 55 * unit(hashAt(roll, 'length')),
        };
    }
    // A feeder valley converges on the main channel. Its bed never climbs downstream.
    const side = unit(hashAt(roll, 'feeder-side')) < 0.5 ? -1 : 1;
    const join = 8 + Math.floor(unit(hashAt(roll, 'join')) * 5);
    const points: Tributary['points'] = [];
    let bed = Infinity;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6,
        z = row * DRAINAGE_REACH + (join - 4 * (1 - t)) * STEP;
      const r = Math.max(0, Math.min(rows - 1, Math.floor((z - row * DRAINAGE_REACH) / STEP)));
      const centre = lerp(xs[r]!, xs[r + 1]!, (z - row * DRAINAGE_REACH) / STEP - r);
      const x = centre + side * 210 * (1 - t);
      bed = Math.min(bed, elevation(x, z) - 0.6);
      points.push({ x, z, y: lerp(bed, WATER_LEVEL - 2.4, t * t) });
    }
    // The interpolation toward the outlet also respects every preceding bed elevation.
    for (let i = 1; i < points.length; i++) points[i]!.y = Math.min(points[i]!.y, points[i - 1]!.y);
    const built = {
      xs,
      lake,
      tributary: {
        points,
        minX: Math.min(...points.map((p) => p.x)) - 44,
        maxX: Math.max(...points.map((p) => p.x)) + 44,
        minZ: Math.min(...points.map((p) => p.z)) - 44,
        maxZ: Math.max(...points.map((p) => p.z)) + 44,
      },
    };
    if (reaches.size >= 256) reaches.delete(reaches.keys().next().value!);
    reaches.set(key, built);
    return built;
  };
  const riverAt = (lane: number, z: number) => {
    const row = Math.floor(z / DRAINAGE_REACH),
      local = (z - row * DRAINAGE_REACH) / STEP;
    const xs = reach(lane, row).xs,
      i = Math.floor(local),
      t = local - i;
    // Smooth interpolation never overshoots the surveyed corridor; zero tangents join reaches.
    const x = lerp(xs[i]!, xs[i + 1]!, smoothstep(0, 1, t));
    const half = 12 + 6 * (0.5 + 0.5 * Math.sin(z / 280 + lane * 1.7));
    return { x, half };
  };
  const surveyCrossChannel = (lane: number, row: number, roll: number): Channel<Point> | null => {
    const baseZ = row * DRAINAGE_REACH;
    const midZ = baseZ + 330 + 360 * unit(hashAt(roll, 'position'));
    const direction = unit(hashAt(roll, 'turn')) < 0.5 ? -1 : 1;
    const skew = direction * (110 + 230 * unit(hashAt(roll, 'angle')));
    const bend = 45 + 55 * unit(hashAt(roll, 'bend'));
    let best: Point[] | undefined;
    let bestCost = Infinity;
    for (const offset of [0, -112, 112]) {
      const startZ = midZ + offset - skew / 2;
      const endZ = midZ + offset + skew / 2;
      const startX = riverAt(lane, startZ).x;
      const endX = riverAt(lane + 1, endZ).x;
      for (const curve of [direction, -direction]) {
        const points: Point[] = [];
        let peak = -Infinity;
        let total = 0;
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const x = lerp(startX, endX, t);
          const z = lerp(startZ, endZ, t) + curve * bend * Math.sin(Math.PI * t) * (1.4 - 0.8 * t);
          const height = elevation(x, z);
          peak = Math.max(peak, height);
          total += Math.max(0, height);
          points.push({ x, z });
        }
        // Keep both joins in surveyed terrain and the entire creek within its reach.
        if (
          peak > 19 ||
          points.some(
            ({ x, z }) =>
              z < baseZ + CROSS_BANK ||
              z > baseZ + DRAINAGE_REACH - CROSS_BANK ||
              Math.hypot(x - STARTER_CENTER, z - STARTER_CENTER) < 1180,
          ) ||
          Math.hypot(xpos(lane, HALF) - STARTER_CENTER, startZ - STARTER_CENTER) < 1100 ||
          Math.hypot(xpos(lane + 1, HALF) - STARTER_CENTER, endZ - STARTER_CENTER) < 1100
        )
          continue;
        const cost = total / points.length + peak * 0.5 + Math.abs(offset) / 100;
        if (cost < bestCost) {
          bestCost = cost;
          best = points;
        }
      }
    }
    if (!best) return null;
    return {
      points: best,
      minX: best[0]!.x - CROSS_BANK,
      maxX: best[best.length - 1]!.x + CROSS_BANK,
      minZ: Math.min(...best.map(({ z }) => z)) - CROSS_BANK,
      maxZ: Math.max(...best.map(({ z }) => z)) + CROSS_BANK,
    };
  };
  const crossChannel = (lane: number, row: number): Channel<Point> | null => {
    const key = `${lane},${row}`;
    const cached = crossChannels.get(key);
    if (cached !== undefined) return cached;
    const roll = hashAt(seed, 'cross-channel', lane, row);
    const channel = unit(roll) < 0.68 ? surveyCrossChannel(lane, row, roll) : null;
    if (crossChannels.size >= 256) crossChannels.delete(crossChannels.keys().next().value!);
    crossChannels.set(key, channel);
    return channel;
  };
  const crossChannelGround = (h: number, x: number, z: number): number => {
    if (!connected) return h;
    const nearest = Math.round((x - ORIGIN) / LANE);
    const row = Math.floor(z / DRAINAGE_REACH);
    for (const lane of [nearest - 1, nearest]) {
      const channel = crossChannel(lane, row);
      if (!channel || x < channel.minX || x > channel.maxX || z < channel.minZ || z > channel.maxZ) continue;
      let distance = CROSS_BANK;
      for (let i = 0; i + 1 < channel.points.length; i++) {
        const a = channel.points[i]!;
        const b = channel.points[i + 1]!;
        if (x < a.x - distance || x > b.x + distance) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
        distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
      }
      const bed = WATER_LEVEL - 0.45 + Math.max(0, distance - 6) * 0.19;
      h = lerp(h, Math.min(h, bed), 1 - smoothstep(8, CROSS_BANK, distance));
    }
    return h;
  };
  return {
    riverAt,
    crossChannelGround,
    waterGuidesAt(x, z) {
      const nearest = Math.round((x - ORIGIN) / LANE);
      const row = Math.floor(z / DRAINAGE_REACH);
      let basin = 0;
      let branch: ChannelGuide | null = null;
      const consider = (guide: ChannelGuide | null) => {
        if (guide && guide.distance / guide.half < (branch ? branch.distance / branch.half : 1))
          branch = guide;
      };
      for (let lane = nearest - 1; lane <= nearest + 1; lane++) {
        if (Math.abs(x - xpos(lane, HALF)) > 450) continue;
        const { lake, tributary } = reach(lane, row);
        if (lake) {
          const d = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
          basin = Math.max(basin, 1 - smoothstep(0.75, 1.18, d));
        }
        consider(projectChannel(tributary, x, z, 12));
      }
      if (connected) {
        for (const lane of [nearest - 1, nearest]) {
          const channel = crossChannel(lane, row);
          if (channel) consider(projectChannel(channel, x, z, 10));
        }
      }
      return { basin, branch };
    },
    riverGround(h, x, z, course = riverAt, valleyStrength = 1) {
      const nearest = Math.round((x - ORIGIN) / LANE);
      for (let lane = nearest - 1; lane <= nearest + 1; lane++) {
        if (Math.abs(x - xpos(lane, HALF)) > 400) continue;
        const river = course(lane, z);
        const offset = x - river.x;
        const distance = Math.abs(offset);
        // A broad floodplain/valley leads to a shelf, then the deep channel. No sheer cut at its edge.
        const valley = WATER_LEVEL + 1.2 + Math.max(0, distance - river.half) * 0.025;
        h = lerp(
          h,
          Math.min(h, valley),
          valleyStrength * (1 - smoothstep(river.half + 20, river.half + 180, distance)),
        );
        if (shapedBed && distance > river.half * 1.4 + 17) continue;
        const half = shapedBed ? riverBankWidth(river.half, lane, z, Math.sign(offset)) : river.half;
        let channel = lerp(WATER_LEVEL - 2.8, WATER_LEVEL, smoothstep(0, half, distance));
        if (shapedBed && distance < half) {
          const pool = riverPool(lane, z);
          const across = offset / half;
          const thalweg = 0.24 * Math.sin(z / 55 + lane * 2.3);
          const sideWidth = across < thalweg ? 1 + thalweg : 1 - thalweg;
          const shelf = smoothstep(0.09, 1, Math.abs(across - thalweg) / sideWidth);
          const bedDepth = lerp(1.25, 3.9, pool) * (1 - shelf);
          // Uneven submerged bars taper to zero before the old shoreline.
          const bars = 0.16 * Math.sin(z * 0.21 + across * 7) * Math.sin(across * 10 - z * 0.08);
          channel = WATER_LEVEL - bedDepth * (1 + bars);
        }
        h = lerp(Math.min(h, channel), h, smoothstep(half * 0.8, half + 17, distance));
      }
      return h;
    },
    basinGround(h, x, z) {
      const nearest = Math.round((x - ORIGIN) / LANE),
        row = Math.floor(z / DRAINAGE_REACH);
      for (let lane = nearest - 1; lane <= nearest + 1; lane++) {
        if (Math.abs(x - xpos(lane, HALF)) > 450) continue;
        // Lakes are centred at rows 4/8/12 with <=180 m influence. Feeders occupy
        // rows 4..12 plus <=44 m shoulders: both stay strictly inside this reach.
        const { lake, tributary } = reach(lane, row);
        if (lake) {
          const d = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
          if (d < 1.5) {
            const bed = WATER_LEVEL - 4 * (1 - smoothstep(0.25, 1.05, d));
            h = lerp(Math.min(h, bed), h, smoothstep(0.9, 1.5, d));
          }
        }
        if (x < tributary.minX || x > tributary.maxX || z < tributary.minZ || z > tributary.maxZ) continue;
        for (let i = 0; i + 1 < tributary.points.length; i++) {
          const a = tributary.points[i]!,
            b = tributary.points[i + 1]!;
          const dx = b.x - a.x,
            dz = b.z - a.z;
          if (
            x < Math.min(a.x, b.x) - 44 ||
            x > Math.max(a.x, b.x) + 44 ||
            z < Math.min(a.z, b.z) - 44 ||
            z > Math.max(a.z, b.z) + 44
          )
            continue;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
          const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
          const downstream = (i + t) / (tributary.points.length - 1);
          const width = 3 + 6 * downstream;
          if (d >= width + 35) continue;
          const bed = lerp(a.y, b.y, t) + Math.max(0, d - width) * 0.2;
          h = lerp(
            h,
            Math.min(h, bed),
            (1 - smoothstep(width, width + 35, d)) * smoothstep(0, 0.2, downstream),
          );
        }
      }
      return crossChannelGround(h, x, z);
    },
  };
}
