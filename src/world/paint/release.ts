// Colour that comes back without the brush: when a stronghold monster falls or a resident's
// wish is granted, the drained surfaces nearest that spot return to their original colour.
// Pure, so the patch rules and the scene that shows the bloom agree on which surfaces.
import { DRAINED, type SurfaceInfo } from './surfaces';

/** Drained surfaces within `radius` of (x, z), nearest first, at most `max`. */
export function releaseAround(
  surfaces: readonly SurfaceInfo[],
  states: Uint8Array,
  x: number,
  z: number,
  rule: { readonly radius: number; readonly max: number },
): number[] {
  const r2 = rule.radius * rule.radius;
  const near: { i: number; d2: number }[] = [];
  surfaces.forEach((s, i) => {
    if (states[i] !== DRAINED) return;
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 <= r2) near.push({ i, d2 });
  });
  near.sort((a, b) => a.d2 - b.d2 || a.i - b.i);
  return near.slice(0, rule.max).map((n) => n.i);
}
