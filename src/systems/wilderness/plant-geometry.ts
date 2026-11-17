import * as THREE from 'three';

// Render thin petals and leaves with the field's double-sided material, sharing
// the same vertices between adjoining folds and between front and back views.
export function sheet(
  rows: number,
  columns: number,
  point: (t: number, side: number) => THREE.Vector3,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const p = point(row / rows, (2 * col) / columns - 1);
      positions.push(p.x, p.y, p.z);
      if (row === rows || col === columns) continue;
      const a = row * (columns + 1) + col;
      const b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type Triple = [number, number, number];
export function place(position: Triple, rotation: Triple, scale: Triple) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, 'YXZ')),
    new THREE.Vector3(...scale),
  );
}
