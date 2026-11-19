import type { Rig } from './player-rig';

// Entry, catch, pull, push, bent-elbow recovery, and entry again. Shoulder angles
// unwrap through a full revolution so recovery cannot reverse the underwater stroke.
const STROKE = [
  [0, 2.9, 0.1, 0.16, 1.4],
  [0.18, 2.5, 0.45, 0.22, 1.4],
  [0.42, 1.25, 1.0, 0.25, 1.4],
  [0.6, 0.25, 0.25, 0.18, 1.35],
  [0.78, -1.1, 1.25, 0.48, 0.8],
  [1, 2.9 - Math.PI * 2, 0.1, 0.16, 1.4],
] as const;

/** Alternating crawl: the hands stay beyond the wrists and cup the water, rather than
 * swinging two straight arms back and forth along the same path. */
export function swimArms(r: Rig, phase: number): void {
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'R' ? 1 : -1;
    const cycle = (((phase / (Math.PI * 2) + (side === 'R' ? 0.5 : 0)) % 1) + 1) % 1;
    let i = 0;
    while (i < STROKE.length - 2 && cycle > STROKE[i + 1]![0]) i++;
    const a = STROKE[i]!,
      b = STROKE[i + 1]!;
    const t = (cycle - a[0]) / (b[0] - a[0]);
    const w = t * t * (3 - 2 * t);
    const value = (k: 1 | 2 | 3 | 4) => a[k] + (b[k] - a[k]) * w;
    r[`arm${side}`].rotation.set(value(1), 0, sign * value(3));
    r[`fore${side}`].rotation.set(value(2), sign * value(4), 0);
  }
}
