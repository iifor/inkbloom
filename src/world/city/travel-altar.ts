import { hashAt, unit } from '../math/hash';
import { WATER_LEVEL } from '../wilderness/water-level';
import { type CityLayout, groundAt } from './layout';
import { settlementSize } from './settlement';

export const ALTAR_RADIUS = 2.3;
export interface AltarSite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}
const cache = new WeakMap<CityLayout, AltarSite | null>();

/** A separate hash stream: adding travel never changes houses or saved paint surfaces. */
export function hasTravelAltar(seed: number, chunks: number): boolean {
  const chance = { small: 0.05, medium: 0.8, town: 0.9 }[settlementSize(chunks)];
  return unit(hashAt(seed, 'travel-altar')) < chance;
}

/** A clear, dry corner of the square, away from the well and front doors. */
export function travelAltar(l: CityLayout): AltarSite | null {
  if (cache.has(l)) return cache.get(l)!;
  let best: AltarSite | null = null;
  let score = Infinity;
  if (hasTravelAltar(l.seed, l.chunks)) {
    const phase = unit(hashAt(l.seed, 'travel-altar-side')) * Math.PI * 2;
    for (let i = 0; i < 16; i++) {
      const a = phase + (i * Math.PI) / 8;
      const x = l.square.x + Math.cos(a) * 6.1;
      const z = l.square.z + Math.sin(a) * 6.1;
      const clear = ALTAR_RADIUS + 0.8;
      if (
        l.buildings.some((b) => {
          const dx = x - b.x,
            dz = z - b.z;
          const u = Math.cos(b.angle) * dx - Math.sin(b.angle) * dz;
          const v = Math.sin(b.angle) * dx + Math.cos(b.angle) * dz;
          return Math.abs(u) < b.hw + clear && Math.abs(v) < b.hd + b.garden + clear;
        })
      )
        continue;
      if (l.trees.some((t) => Math.hypot(t.x - x, t.z - z) < clear + 1)) continue;
      let lo = Infinity,
        hi = -Infinity,
        dry = true;
      for (let k = 0; k <= 8; k++) {
        const r = k === 8 ? 0 : clear;
        const sx = x + Math.cos((k * Math.PI) / 4) * r;
        const sz = z + Math.sin((k * Math.PI) / 4) * r;
        const ix = Math.floor((sx - l.ox) / l.cell),
          iz = Math.floor((sz - l.oz) / l.cell);
        if (ix < 1 || iz < 1 || ix >= l.n - 1 || iz >= l.n - 1 || l.water[iz * l.n + ix]) dry = false;
        const y = groundAt(l, sx, sz);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      if (!dry || lo <= WATER_LEVEL + 0.1 || hi - lo > 0.65) continue;
      const cost = hi - lo + i * 0.001;
      if (cost < score) {
        score = cost;
        best = { x, y: hi + 0.07, z, yaw: Math.atan2(x - l.square.x, z - l.square.z) };
      }
    }
  }
  cache.set(l, best);
  return best;
}
