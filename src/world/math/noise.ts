// Seeded 2D simplex noise plus the usual combinators. Pure arithmetic, so browser and Node
// produce identical values for the same seed.
import { Rng } from './rng';

export type Noise2D = (x: number, y: number) => number;

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Simplex noise in roughly [-1, 1]. */
export function createNoise2D(seed: number): Noise2D {
  const rng = new Rng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  const corner = (gi: number, x: number, y: number): number => {
    const t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    const g = GRAD[gi & 7]!;
    const t2 = t * t;
    return t2 * t2 * (g[0] * x + g[1] * y);
  };

  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const n0 = corner(perm[ii + perm[jj]!]!, x0, y0);
    const n1 = corner(perm[ii + i1 + perm[jj + j1]!]!, x1, y1);
    const n2 = corner(perm[ii + 1 + perm[jj + 1]!]!, x2, y2);
    return 70 * (n0 + n1 + n2);
  };
}

/** Fractal sum of octaves, normalised back to roughly [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 0 along ridges/valleys, rising to 1 away from them. Good for rivers. */
export const ridged = (noise: Noise2D, x: number, y: number): number => Math.abs(noise(x, y));

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
