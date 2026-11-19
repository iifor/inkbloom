import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR } from '@/engine/render/geometry-builder';
import { FISH_SPECIES, type FishSpecies } from '@/content/fish';

// Nose points along +X. Each station describes the half-width, half-height and
// centre of a cross section, from the narrow tail wrist to the rounded snout.
const sections = [
  [-0.47, 0.011, 0.023, 0.006],
  [-0.39, 0.027, 0.035, 0.006],
  [-0.29, 0.045, 0.067, 0.009],
  [-0.17, 0.072, 0.104, 0.012],
  [-0.04, 0.094, 0.132, 0.011],
  [0.09, 0.104, 0.142, 0.005],
  [0.18, 0.1, 0.133, 0.002],
  [0.27, 0.088, 0.11, 0],
  [0.35, 0.063, 0.08, -0.006],
  [0.414, 0.039, 0.044, -0.015],
  [0.446, 0.014, 0.016, -0.016],
] as const;
type Point = readonly [number, number, number];

export function fishShape(
  species: FishSpecies = FISH_SPECIES[3]!,
  atlasSlot = 0,
  atlasSlots = 1,
): THREE.BufferGeometry {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const point = (x: number, y: number, z: number, u: number, v: number) => {
    // Keep the longitudinal stations for the tail shader; length is set per instance.
    // Fins change independently of the body, rather than merely scaling the whole fish.
    if (v > 0.77) {
      if (x < -0.48) y *= species.tail;
      else if (y > 0.145 && Math.abs(z) < 0.03) y = 0.14 + (y - 0.14) * species.dorsal;
    }
    y *= species.height;
    z *= species.width;
    positions.push(x, y, z);
    uv.push((atlasSlot + 0.005 + u * 0.99) / atlasSlots, v);
    return positions.length / 3 - 1;
  };
  const sides = 16;
  for (const [x, width, height, cy] of sections) {
    for (let j = 0; j < sides; j++) {
      const a = (j * 2 * Math.PI) / sides;
      const latitude = Math.asin(Math.sin(a)) / Math.PI + 0.5;
      point(x, cy + height * Math.sin(a), width * Math.cos(a), (x + 0.48) / 0.94, 0.02 + 0.72 * latitude);
    }
  }
  const tail = point(-0.482, 0.006, 0, 0, 0.38),
    nose = point(0.46, -0.016, 0, 1, 0.38);
  for (let j = 0; j < sides; j++) {
    const next = (j + 1) % sides;
    indices.push(tail, j, next);
    for (let i = 1; i < sections.length; i++) {
      const prev = (i - 1) * sides,
        cur = i * sides;
      indices.push(prev + j, cur + j, prev + next, prev + next, cur + j, cur + next);
    }
    const last = (sections.length - 1) * sides;
    indices.push(last + j, nose, last + next);
  }

  // Each pair runs along a fin ray from its insertion to its free edge. The fins
  // share the skin atlas and the body draw call, and are visible from either side.
  function membrane(rays: readonly (readonly [Point, Point])[]) {
    const start = positions.length / 3;
    rays.forEach(([base, edge], i) => {
      const v = 0.8 + (0.18 * i) / (rays.length - 1);
      point(...base, 0.02, v);
      point(...edge, 0.98, v);
      if (i > 0) {
        const k = start + i * 2;
        indices.push(k - 2, k - 1, k, k, k - 1, k + 1);
      }
    });
  }
  // A fork with two rounded lobes and a shallow scoop where the rays meet.
  membrane([
    [
      [-0.435, -0.018, 0],
      [-0.619, -0.139, 0.014],
    ],
    [
      [-0.45, -0.014, 0],
      [-0.654, -0.143, 0.022],
    ],
    [
      [-0.458, -0.007, 0],
      [-0.629, -0.103, 0.013],
    ],
    [
      [-0.468, 0, 0],
      [-0.575, -0.039, 0.006],
    ],
    [
      [-0.473, 0.006, 0],
      [-0.554, 0.006, 0],
    ],
    [
      [-0.467, 0.012, 0],
      [-0.584, 0.054, -0.005],
    ],
    [
      [-0.46, 0.021, 0],
      [-0.643, 0.13, -0.012],
    ],
    [
      [-0.448, 0.026, 0],
      [-0.655, 0.157, -0.016],
    ],
    [
      [-0.432, 0.029, 0],
      [-0.617, 0.15, -0.011],
    ],
  ]);
  membrane([
    [
      [0.072, 0.139, 0],
      [0.061, 0.157, 0],
    ],
    [
      [0.036, 0.141, 0],
      [-0.025, 0.209, 0.007],
    ],
    [
      [-0.008, 0.14, 0],
      [-0.052, 0.217, 0.012],
    ],
    [
      [-0.065, 0.13, 0],
      [-0.097, 0.181, 0.015],
    ],
    [
      [-0.13, 0.116, 0],
      [-0.17, 0.144, 0.012],
    ],
    [
      [-0.165, 0.109, 0],
      [-0.18, 0.117, 0.005],
    ],
  ]);
  for (const side of [-1, 1]) {
    membrane([
      [
        [0.18, -0.028, 0.09 * side],
        [0.13, -0.044, 0.131 * side],
      ],
      [
        [0.163, -0.036, 0.093 * side],
        [0.045, -0.073, 0.173 * side],
      ],
      [
        [0.15, -0.045, 0.091 * side],
        [0.023, -0.08, 0.168 * side],
      ],
      [
        [0.139, -0.055, 0.09 * side],
        [0.037, -0.085, 0.141 * side],
      ],
      [
        [0.13, -0.062, 0.085 * side],
        [0.081, -0.076, 0.105 * side],
      ],
    ]);
  }
  membrane([
    [
      [-0.16, -0.087, 0],
      [-0.19, -0.132, 0.006],
    ],
    [
      [-0.19, -0.083, 0],
      [-0.255, -0.132, 0.009],
    ],
    [
      [-0.24, -0.067, 0],
      [-0.273, -0.097, 0.004],
    ],
  ]);
  const mesh = new THREE.BufferGeometry();
  mesh.setIndex(indices);
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  mesh.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const count = positions.length / 3;
  mesh.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count).fill(color('teal')), 1));
  mesh.setAttribute('aSurface', new THREE.BufferAttribute(new Float32Array(count).fill(ALWAYS_COLOR), 1));
  mesh.computeVertexNormals();
  mesh.computeBoundingSphere();
  return mesh;
}
