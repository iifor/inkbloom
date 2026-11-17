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
  // Give arching outer leaves an extra bend and use fewer joints on upright inner leaves.
  const stations = [
    [0, 0.83],
    [0, 0.43, 0.83],
    [0, 0.31, 0.6, 0.83],
  ] as const;
  const pos: number[] = [],
    normals: number[] = [],
    uv: number[] = [],
    bladePhases: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = i * 2.4 + rand() * 0.7;
    const dx = Math.cos(angle),
      dz = Math.sin(angle);
    const form = i === 9 ? 1 : i % 3;
    const openness = (form + rand()) / 3;
    const root = 0.026 + 0.075 * openness;
    const height = 0.3 + rand() * 0.32;
    const reach = 0.1 + openness * 0.33;
    const width = 0.017 + rand() * 0.016;
    const curl = (rand() - 0.5) * 0.15;
    const twist = (rand() - 0.5) * 1.7;
    const first = pos.length / 3;
    const point = (t: number, breadth: number, side: number) => {
      const along = root + reach * t * (0.2 + 0.8 * t);
      const roll = twist * t;
      const lateral = curl * t * t + side * width * breadth * Math.cos(roll);
      const y = height * t * (1.48 - (0.44 + 0.48 * openness) * t);
      pos.push(
        dx * along - dz * lateral,
        y + side * width * breadth * Math.sin(roll),
        dz * along + dx * lateral,
      );
      // Tilt the two edges away from a soft midrib. This keeps both faces readable at grazing angles.
      const nx = (0.4 - 0.22 * t) * dx - dz * side * 0.21;
      const nz = (0.4 - 0.22 * t) * dz + dx * side * 0.21;
      const length = Math.hypot(nx, 1, nz);
      normals.push(nx / length, 1 / length, nz / length);
      uv.push((side + 1) / 2, t);
    };
    const rows = stations[form]!;
    for (const t of rows) {
      const breadth = 0.23 * (1 - t) + 0.92 * Math.sin(Math.PI * t) ** 1.18;
      point(t, breadth, -1);
      point(t, breadth, 1);
    }
    point(1, 0, 0);
    for (let v = first; v < pos.length / 3; v++) bladePhases.push((angle / (2 * Math.PI)) % 1);
    for (let row = 0; row + 1 < rows.length; row++) {
      const a = first + 2 * row;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const tip = first + 2 * rows.length;
    indices.push(tip - 2, tip - 1, tip);
  }
  const count = pos.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aBladePhase', new THREE.Float32BufferAttribute(bladePhases, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1));
  return geo;
}
