// Lit windows and smoking chimneys. The house builder marks both in the geometry itself
// (GeometryBuilder.pane and .chimney write the aPane attribute), so they survive merging and
// the trip back from the city worker; a scene hands each mesh's geometry here as it loads and
// the renderer asks every few frames for windows near the camera and chimneys near the player.
import * as THREE from 'three';

/** Lit windows that shine on their surroundings at once (the nearest). */
export const LAMP_COUNT = 8;
/** A window's lamp is lit when its room number (0..15) is below this (paint-shader.ts agrees). */
export const LIT_ROOMS = 10;
/** Metres a window's light reaches. */
export const LAMP_REACH = 7;
/** Beyond this from the eye a lamp has faded out, so one dropping out of the nearest few is
 * not seen to go. */
const LAMP_FADE = [32, 46] as const;
const SMOKE_FADE = [72, 90] as const;

interface Marks {
  /** x, y, z of each lit window's lamp, a little out from the glass. */
  readonly lamps: Float32Array;
  /** x, y, z of each chimney's top. */
  readonly chimneys: Float32Array;
}

/** The lit windows and chimney tops marked in a geometry (in its own coordinates). */
function marksOf(geometry: THREE.BufferGeometry): Marks {
  const pane = geometry.getAttribute('aPane');
  const lamps: number[] = [];
  const chimneys: number[] = [];
  if (pane) {
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    for (let i = 0; i + 3 < pane.count; i++) {
      const mark = pane.getX(i);
      if (mark > -0.5 && mark < 0.5) continue;
      // a pane or a chimney mark is one quad: four vertices in a row
      let x = 0,
        y = 0,
        z = 0;
      for (let k = 0; k < 4; k++) {
        x += p.getX(i + k) / 4;
        y += p.getY(i + k) / 4;
        z += p.getZ(i + k) / 4;
      }
      // (a path's edge is marked too, further below zero: neither window nor chimney)
      if (mark < -1.5) continue;
      if (mark < 0) chimneys.push(x, y, z);
      else if (Math.floor(pane.getY(i)) < LIT_ROOMS) lamps.push(x + n.getX(i) * 0.6, y, z + n.getZ(i) * 0.6);
      i += 3;
    }
  }
  return { lamps: new Float32Array(lamps), chimneys: new Float32Array(chimneys) };
}

export class Lamps {
  private readonly sets = new Set<Marks>();
  private readonly near: { d: number; x: number; y: number; z: number }[] = [];

  /** Take a loaded mesh's lit windows and chimneys (its geometry is in world coordinates);
   * returns the call that forgets them again. */
  add(geometry: THREE.BufferGeometry): () => void {
    const marks = marksOf(geometry);
    if (!marks.lamps.length && !marks.chimneys.length) return () => {};
    this.sets.add(marks);
    return () => this.sets.delete(marks);
  }

  private nearest(of: 'lamps' | 'chimneys', origin: THREE.Vector3Like, count: number, reach: number): void {
    const near = this.near;
    near.length = 0;
    for (const set of this.sets) {
      const a = set[of];
      for (let i = 0; i < a.length; i += 3) {
        const d = Math.hypot(a[i]! - origin.x, a[i + 1]! - origin.y, a[i + 2]! - origin.z);
        if (d < reach) near.push({ d, x: a[i]!, y: a[i + 1]!, z: a[i + 2]! });
      }
    }
    near.sort((p, q) => p.d - q.d);
    near.length = Math.min(near.length, count);
  }

  /** The lit windows nearest `eye`, into `out` (x, y, z, strength 0..1; strength 0 for none). */
  lampsNear(eye: THREE.Vector3, out: readonly THREE.Vector4[]): void {
    this.nearest('lamps', eye, out.length, LAMP_FADE[1]);
    out.forEach((v, i) => {
      const l = this.near[i];
      if (l) v.set(l.x, l.y, l.z, 1 - THREE.MathUtils.smoothstep(l.d, LAMP_FADE[0], LAMP_FADE[1]));
      else v.set(0, 0, 0, 0);
    });
  }

  /** Smoke sources follow the player's location, even when the camera orbits them. */
  chimneysNear(player: THREE.Vector3Like, count: number) {
    this.nearest('chimneys', player, count, SMOKE_FADE[1]);
    return this.near.map(({ x, y, z, d }) => ({ x, y, z, r: 0.3, opacity: 1 - THREE.MathUtils.smoothstep(d, ...SMOKE_FADE) }));
  }
}
