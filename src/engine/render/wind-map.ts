import * as THREE from 'three';
import { lerp, smoothstep } from '@/world/math/noise';
import { Rng } from '@/world/math/rng';

/** Bilinearly sample a smooth, periodic lattice. Adjacent wind tiles share their edges. */
function noiseLayer(cells: number, rng: Rng) {
  const grid = Float32Array.from({ length: cells * cells }, () => rng.next());
  const at = (x: number, z: number) => grid[(z % cells) * cells + (x % cells)]!;
  return (u: number, v: number) => {
    const x = u * cells,
      z = v * cells;
    const i = Math.floor(x),
      j = Math.floor(z);
    const tx = smoothstep(0, 1, x - i),
      tz = smoothstep(0, 1, z - j);
    return lerp(lerp(at(i, j), at(i + 1, j), tx), lerp(at(i, j + 1), at(i + 1, j + 1), tx), tz);
  };
}

/** One 96 m tile. Red is gust strength and green is lateral wind variation. */
export function makeWindMap(seed: number): THREE.DataTexture {
  const size = 128;
  const rng = new Rng(seed);
  const broad = noiseLayer(9, rng),
    small = noiseLayer(25, rng),
    crosswind = noiseLayer(17, rng);
  const data = new Uint8Array(size * size * 2);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (z + 0.5) / size;
      const i = 2 * (z * size + x);
      data[i] = Math.round(255 * lerp(broad(u, v), small(u, v), 0.27));
      data[i + 1] = Math.round(255 * crosswind(u, v));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** CPU counterpart of the grass shader's repeating, linear-filtered RG wind sample. */
export function sampleWindMap(texture: THREE.DataTexture, x: number, z: number, out: THREE.Vector2): void {
  const { data, width, height } = texture.image;
  const px = (x / 96 - Math.floor(x / 96)) * width - 0.5;
  const pz = (z / 96 - Math.floor(z / 96)) * height - 0.5;
  const ix = Math.floor(px),
    iz = Math.floor(pz);
  const at = (dx: number, dz: number, c: number) =>
    data[(((iz + dz + height) % height) * width + ((ix + dx + width) % width)) * 2 + c]! / 255;
  const channel = (c: number) =>
    lerp(lerp(at(0, 0, c), at(1, 0, c), px - ix), lerp(at(0, 1, c), at(1, 1, c), px - ix), pz - iz);
  out.set(channel(0), channel(1));
}
