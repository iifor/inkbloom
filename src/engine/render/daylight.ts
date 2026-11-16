// Light through the day. A pure function of the hour (0..24): where the sun is and the colours
// of sunlight, shade and sky, keyed like a painter's colour script: cool dawn, clear morning,
// bright noon, golden evening, a short violet dusk and a blue moonlit night. The renderer turns
// this into uniforms each frame; nothing in gameplay reads it.
import * as THREE from 'three';

type RGB = readonly [number, number, number];

interface Key {
  readonly hour: number;
  /** Colour and strength of the direct light (sun, or moon at night). */
  readonly sun: RGB;
  /** Colour shade takes on: the sky's fill light. */
  readonly shade: RGB;
  readonly zenith: RGB;
  readonly horizon: RGB;
}

const KEYS: readonly Key[] = [
  {
    hour: 0,
    sun: [0.42, 0.5, 0.72],
    shade: [0.2, 0.25, 0.42],
    zenith: [0.04, 0.07, 0.18],
    horizon: [0.16, 0.22, 0.36],
  },
  {
    hour: 4.5,
    sun: [0.42, 0.5, 0.72],
    shade: [0.2, 0.25, 0.42],
    zenith: [0.05, 0.08, 0.2],
    horizon: [0.2, 0.25, 0.4],
  },
  {
    hour: 5.8,
    sun: [0.95, 0.6, 0.5],
    shade: [0.42, 0.44, 0.66],
    zenith: [0.3, 0.42, 0.66],
    horizon: [0.98, 0.72, 0.6],
  },
  {
    hour: 8,
    sun: [1.06, 0.98, 0.86],
    shade: [0.52, 0.6, 0.82],
    zenith: [0.2, 0.55, 0.82],
    horizon: [0.86, 0.92, 0.95],
  },
  {
    hour: 12,
    sun: [1.1, 1.05, 0.95],
    shade: [0.56, 0.64, 0.85],
    zenith: [0.17, 0.57, 0.8],
    horizon: [0.84, 0.93, 0.95],
  },
  {
    hour: 16,
    sun: [1.1, 0.99, 0.84],
    shade: [0.53, 0.59, 0.8],
    zenith: [0.19, 0.55, 0.8],
    horizon: [0.9, 0.91, 0.88],
  },
  {
    hour: 18.3,
    sun: [1.18, 0.76, 0.46],
    shade: [0.46, 0.43, 0.68],
    zenith: [0.3, 0.46, 0.72],
    horizon: [1.0, 0.74, 0.52],
  },
  {
    hour: 19.6,
    sun: [0.7, 0.42, 0.48],
    shade: [0.32, 0.32, 0.55],
    zenith: [0.14, 0.2, 0.42],
    horizon: [0.7, 0.46, 0.52],
  },
  {
    hour: 20.8,
    sun: [0.42, 0.5, 0.72],
    shade: [0.2, 0.25, 0.42],
    zenith: [0.04, 0.07, 0.18],
    horizon: [0.16, 0.22, 0.36],
  },
  {
    hour: 24,
    sun: [0.42, 0.5, 0.72],
    shade: [0.2, 0.25, 0.42],
    zenith: [0.04, 0.07, 0.18],
    horizon: [0.16, 0.22, 0.36],
  },
];

export interface Daylight {
  /** Towards the light that casts shadows (the sun by day, the moon by night). */
  readonly dir: THREE.Vector3;
  readonly sun: THREE.Vector3;
  readonly shade: THREE.Vector3;
  readonly zenith: THREE.Vector3;
  readonly horizon: THREE.Vector3;
  /** 0 by day, 1 in the dead of night: stars come out and windows light up. */
  readonly night: number;
}

const lerp3 = (a: RGB, b: RGB, t: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

const SUNRISE = 4.6;
const SUNSET = 19.8;

/** Lowest the light gets, so shading never flattens and shadows stay a sensible length. */
const MIN_HEIGHT = 0.2;

/** Where a body crossing the sky from east (+x) through south (+z) to west is at `t` 0..1. */
function arc(t: number, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.PI * t;
  const up = Math.sin(a);
  return out.set(Math.cos(a), Math.max(MIN_HEIGHT, up * 0.95), 0.25 + 0.45 * up).normalize();
}

export function daylightAt(hour: number, out?: Daylight): Daylight {
  const h = ((hour % 24) + 24) % 24;
  const d: Daylight = out ?? {
    dir: new THREE.Vector3(),
    sun: new THREE.Vector3(),
    shade: new THREE.Vector3(),
    zenith: new THREE.Vector3(),
    horizon: new THREE.Vector3(),
    night: 0,
  };
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.hour <= h) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = THREE.MathUtils.smoothstep(h, a.hour, b.hour);
  lerp3(a.sun, b.sun, t, d.sun);
  lerp3(a.shade, b.shade, t, d.shade);
  lerp3(a.zenith, b.zenith, t, d.zenith);
  lerp3(a.horizon, b.horizon, t, d.horizon);
  // the sun is up from dawn until dusk has faded, the moon the rest of the night; they hand
  // over when the light is dim, so the jump in shadow direction is hard to see
  const day = h >= SUNRISE && h <= SUNSET;
  arc(day ? (h - SUNRISE) / (SUNSET - SUNRISE) : ((h - SUNSET + 24) % 24) / (24 - SUNSET + SUNRISE), d.dir);
  // hours from noon: dark from about 20:00 to 04:00
  (d as { night: number }).night = THREE.MathUtils.smoothstep(Math.abs(h - 12), 6.5, 8.2);
  return d;
}
