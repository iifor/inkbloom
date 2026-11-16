import * as THREE from 'three';

/** A small deterministic random sequence, so every run builds the same tuft. */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One arching meadow tuft at every viewing distance, including directly overhead. */
export function makeBladeClump(): THREE.BufferGeometry {
  const rand = sequence(0x30a9);
  const pos: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = i * 2.4 + rand() * 0.7;
    const dx = Math.cos(angle),
      dz = Math.sin(angle);
    const root = 0.035 + rand() * 0.14;
    const height = 0.31 + rand() * 0.32;
    const reach = 0.18 + rand() * 0.26;
    const width = 0.024 + rand() * 0.017;
    const curl = (rand() - 0.5) * 0.22;
    const first = pos.length / 3;
    for (const [t, breadth] of [
      [0, 0.3],
      [0.43, 1],
      [0.83, 0.49],
    ] as const) {
      const along = root + reach * t * t;
      const bend = curl * t * (1.8 - 1.7 * t);
      for (const side of [-1, 1]) {
        const lateral = bend + side * width * breadth;
        pos.push(dx * along - dz * lateral, height * t * (1.72 - 0.88 * t), dz * along + dx * lateral);
        uv.push((side + 1) / 2, t);
      }
    }
    pos.push(dx * (root + reach) - dz * curl * 0.1, height * 0.84, dz * (root + reach) + dx * curl * 0.1);
    uv.push(0.5, 1);
    for (let row = 0; row < 2; row++) {
      const a = first + 2 * row;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    indices.push(first + 4, first + 5, first + 6);
  }
  const count = pos.length / 3;
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1));
  return geo;
}
