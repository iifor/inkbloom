// Light through the day. A pure function of the hour (0..24) and the sun's declination (the
// time of year): where the sun is and the colours of sunlight, shade and sky, keyed like a
// painter's colour script: cool dawn, clear morning, bright noon, golden evening, a short violet
// dusk and a blue moonlit night. The keys are painted for an equinox day; summer stretches them
// over a longer day with a higher sun, winter squeezes them into a short one with a low sun.
// The renderer turns this into uniforms each frame; nothing in gameplay reads it.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';

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

const LATITUDE = (TUNING.season.latitude * Math.PI) / 180;

/** Hours from sunrise to sunset when the sun's declination is `dec` (radians). */
export function dayHours(dec: number): number {
  const c = THREE.MathUtils.clamp(-Math.tan(LATITUDE) * Math.tan(dec), -1, 1);
  return (24 * Math.acos(c)) / Math.PI;
}

/** How high the sun stands at noon, radians above the horizon. */
export function noonElevation(dec: number): number {
  return Math.PI / 2 - LATITUDE + dec;
}

/** The hour of an equinox day that looks like hour `h` of a day `len` hours long. Noon and
 * midnight stay put; the day half is stretched or squeezed to `len`, the night half to the rest. */
function equinoxHour(h: number, len: number): number {
  const half = THREE.MathUtils.clamp(len, 2, 22) / 2;
  const d = Math.abs(h - 12);
  const e = d <= half ? (d * 6) / half : 6 + ((d - half) * 6) / (12 - half);
  return 12 + Math.sign(h - 12) * e;
}

/** Where a body crossing the sky from east (+x) through south (+z) to west is at `t` 0..1,
 * peaking `elevation` radians above the southern horizon. */
function arc(t: number, elevation: number, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.PI * t;
  const up = Math.sin(a);
  const y = Math.max(MIN_HEIGHT, up * Math.sin(elevation));
  return out.set(Math.cos(a), y, 0.25 + up * (Math.cos(elevation) - 0.25)).normalize();
}

/** `declination` in radians (see `calendarAt`); 0 is an equinox. */
export function daylightAt(hour: number, declination = 0, out?: Daylight): Daylight {
  const h = equinoxHour(((hour % 24) + 24) % 24, dayHours(declination));
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
  // over when the light is dim, so the jump in shadow direction is hard to see. The moon is
  // drawn full, opposite the sun: high on winter nights, low in summer.
  const day = h >= SUNRISE && h <= SUNSET;
  if (day) arc((h - SUNRISE) / (SUNSET - SUNRISE), noonElevation(declination), d.dir);
  else arc(((h - SUNSET + 24) % 24) / (24 - SUNSET + SUNRISE), noonElevation(-declination), d.dir);
  // hours from noon: dark from about 20:00 to 04:00
  (d as { night: number }).night = THREE.MathUtils.smoothstep(Math.abs(h - 12), 6.5, 8.2);
  return d;
}
