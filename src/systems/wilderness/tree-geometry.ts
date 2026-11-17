// Closed, smooth foliage volumes. Their silhouettes also go into the sun's depth pass.
// The live wilderness instances the same indexed templates throughout the streamed world.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Tree } from '@/world/wilderness/chunk';

const TAU = Math.PI * 2;

class TreeMesh {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly indices: number[] = [];

  point(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    const length = Math.hypot(nx, ny, nz);
    this.normals.push(nx / length, ny / length, nz / length);
    return index;
  }

  join(lower: number[], upper: number[]): void {
    for (let i = 0; i < lower.length; i++) {
      const j = (i + 1) % lower.length;
      this.indices.push(lower[i]!, upper[i]!, lower[j]!, lower[j]!, upper[i]!, upper[j]!);
    }
  }

  cap(ring: number[], pole: number, top: boolean): void {
    for (let i = 0; i < ring.length; i++) {
      const next = ring[(i + 1) % ring.length]!;
      this.indices.push(pole, top ? next : ring[i]!, top ? ring[i]! : next);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setIndex(this.indices);
    return g;
  }
}

/** A spray at the edge of a bough. The slender folded leaves share its light and cast real shadows. */
function leafSprig(
  mesh: TreeMesh,
  x: number,
  y: number,
  z: number,
  angle: number,
  size: number,
  cedar: boolean,
): void {
  const dx = Math.cos(angle),
    dz = Math.sin(angle);
  const point = (along: number, side: number, lift: number, ny: number) =>
    mesh.point(
      x + size * (dx * along - dz * side),
      y + size * lift,
      z + size * (dz * along + dx * side),
      dx,
      ny,
      dz,
    );
  if (cedar) {
    const triangle = (a: number, b: number, c: number) => mesh.indices.push(a, b, c, a, c, b);
    const end = point(1, 0, -0.32, 0.3);
    triangle(point(0, -0.03, 0, 0.4), point(0, 0.03, 0, 0.4), end);
    // Four pairs of needles attach to the same drooping shoot, with shorter tips near the bud.
    for (let i = 0; i < 4; i++) {
      const t = i * 0.21;
      for (const side of [-1, 1]) {
        const reach = t + (1 - t) * 0.42;
        const spread = side * (0.34 - 0.23 * t);
        triangle(
          point(t, 0, -0.32 * t, 0.42),
          point(t + 0.14, spread * 0.2, -0.32 * t + 0.025, 0.88),
          point(reach, spread, -0.32 * reach - 0.13, 0.31),
        );
      }
    }
    return;
  }
  for (let i = 0; i < 5; i++) {
    const sign = i % 2 ? 1 : -1;
    const t = i * 0.12;
    const end = t + 0.46 + 0.1 * Math.sin(i * 2.2);
    const curl = sign * (0.31 - t * 0.25);
    const width = 0.12;
    const root = point(t, 0, -t * 0.44, 0.1);
    const left = point((t + end) * 0.5, curl * 0.58 - width, -t * 0.42 + 0.05, 0.65);
    const right = point((t + end) * 0.5, curl * 0.58 + width, -t * 0.42 + 0.09, 0.88);
    const tip = point(end, curl, -t * 0.44 - 0.19, 0.42);
    mesh.indices.push(root, right, left, left, right, tip, root, left, right, left, tip, right);
  }
}

function broadleafCrown(distant: boolean): THREE.BufferGeometry {
  const mesh = new TreeMesh();
  // Each fork carries its own bank of foliage. Lower limbs spread further on one side.
  const clusters = [
    [-0.65, 0.43, 0.17, 0.85, 0.54],
    [0.64, 0.6, 0.18, 0.97, 0.68],
    [0.12, 0.55, -0.68, 0.91, 0.66],
    [-0.09, 0.75, 0.68, 0.81, 0.59],
    [-0.42, 1.13, -0.13, 0.91, 0.73],
    [0.41, 1.34, -0.06, 0.77, 0.69],
  ] as const;
  clusters.forEach(([x, y, z, width, height], k) => {
    const bottom = mesh.point(x, y - height, z, x * 0.3, -1, z * 0.3);
    let previous: number[] = [];
    const sides = distant ? 8 : 26;
    for (const latitude of distant ? [-0.55, 0.59] : [-1.04, -0.69, -0.32, 0.08, 0.48, 0.85, 1.19]) {
      const ring: number[] = [];
      for (let i = 0; i < sides; i++) {
        const a = (TAU * i) / sides + k * 1.7 + 0.12 * Math.sin(latitude * 2 + k);
        const nx = Math.cos(a) * Math.cos(latitude),
          nz = Math.sin(a) * Math.cos(latitude);
        const scallop =
          1 +
          0.094 * Math.cos(5 * a + k - latitude) +
          0.066 * Math.sin(3 * a + latitude * 3) +
          0.036 * Math.sin(9 * a + 5 * latitude + k);
        const ny = Math.sin(latitude);
        ring.push(
          mesh.point(
            x + width * nx * scallop,
            y + height * (ny + 0.13 * Math.sin(4 * a + k) * Math.cos(latitude)),
            z + width * nz * scallop,
            nx + 0.22 * x,
            ny + 0.12 * Math.cos(5 * a + k),
            nz + 0.22 * z,
          ),
        );
        if (!distant && Math.abs(latitude) < 0.85 && (i + k) % 4 === 0 && nx * x + nz * z > 0.18) {
          const p = ring[ring.length - 1]! * 3;
          leafSprig(
            mesh,
            mesh.positions[p]! - nx * 0.04,
            mesh.positions[p + 1]!,
            mesh.positions[p + 2]! - nz * 0.04,
            a + 0.45 * Math.sin(i + k),
            0.16 + 0.06 * Math.sin(3 * a + k),
            false,
          );
        }
      }
      if (previous.length) mesh.join(previous, ring);
      else mesh.cap(ring, bottom, false);
      previous = ring;
    }
    mesh.cap(previous, mesh.point(x, y + height, z, x * 0.15, 1, z * 0.15), true);
  });
  return mesh.geometry();
}

// Outline of a cedar spray in branch coordinates (reach, breadth). Three unequal tips
// let the sky show between neighbouring sprays even from directly under the tree.
const SPRAY = [
  [0.03, 0],
  [0.22, -0.32],
  [0.53, -0.53],
  [0.83, -0.51],
  [0.72, -0.27],
  [0.99, -0.24],
  [0.91, -0.09],
  [1.14, 0.05],
  [0.82, 0.17],
  [0.92, 0.38],
  [0.65, 0.33],
  [0.65, 0.53],
  [0.37, 0.44],
  [0.16, 0.23],
] as const;
// Clip each sharp corner to a pair of rounded shoulders, keeping the notches between tips.
const sprayRim = SPRAY.flatMap(([x, z], i) => {
  const [ex, ez] = SPRAY[(i + 1) % SPRAY.length]!;
  return [
    [x * 0.88 + ex * 0.12, z * 0.88 + ez * 0.12],
    [x * 0.15 + ex * 0.85, z * 0.15 + ez * 0.85],
  ] as const;
});

function cedarCrown(distant: boolean): THREE.BufferGeometry {
  const mesh = new TreeMesh();
  const tiers = [
    [0.35, 1.16, 7],
    [0.95, 1.02, 6],
    [1.55, 0.91, 6],
    [2.1, 0.73, 5],
    [2.59, 0.54, 4],
    [2.99, 0.37, 3],
    [3.28, 0.2, 3],
  ] as const;
  tiers.forEach(([y, spread, count], tier) => {
    const outer: number[] = [];
    for (let b = 0; b < count; b++) {
      const phase = b * 7.13 + tier * 2.19;
      const angle = (b / count) * TAU + tier * 2.38 + 0.13 * Math.sin(phase);
      const dx = Math.cos(angle),
        dz = Math.sin(angle);
      const reach = spread * (1 + 0.12 * Math.sin(phase + 2));
      const root = y + 0.12 * Math.cos(phase);
      const lean = 0.14 * Math.sin(tier * 0.8);
      const vertex = (along: number, side: number, lift: number, nx: number, ny: number, nz: number) =>
        mesh.point(
          lean + reach * (dx * along - dz * side),
          root - spread * (0.48 * along + 0.16 * Math.sin(Math.PI * along)) + lift,
          reach * (dz * along + dx * side),
          dx * nx - dz * nz,
          ny,
          dz * nx + dx * nz,
        );
      if (distant) {
        outer.push(vertex(1.08, 0, 0.06, 1, 0.1, 0), vertex(0.75, 0.36, 0.03, 0.8, 0.18, 0.4));
        continue;
      }
      const rim = sprayRim.map(([along, side]) =>
        vertex(
          along,
          side * 0.84,
          spread * (0.1 * along * along - Math.abs(side) * 0.4 + 0.07 * Math.sin(phase + 9 * side)),
          along - 0.32,
          0.03,
          side * 1.8,
        ),
      );
      const shoulder = SPRAY.map(([along, side]) =>
        vertex(
          0.15 + along * 0.6,
          side * 0.64,
          spread * (0.25 - Math.abs(side) * 0.31 + 0.03 * Math.sin(phase + side * 8)),
          along * 0.67,
          0.68,
          side * 0.94,
        ),
      );
      for (let i = 0; i < shoulder.length; i++) {
        const j = (i + 1) % shoulder.length;
        mesh.indices.push(
          rim[i * 2]!,
          shoulder[i]!,
          rim[i * 2 + 1]!,
          rim[i * 2 + 1]!,
          shoulder[i]!,
          shoulder[j]!,
          rim[i * 2 + 1]!,
          shoulder[j]!,
          rim[j * 2]!,
        );
      }
      mesh.cap(shoulder, vertex(0.38, -0.04, 0.3 * spread + 0.025, 0.45, 1, -0.1), true);
      // Roll the underside in towards the branch, following the notched rim even from below.
      const underside = SPRAY.filter((_, i) => i % 2 === 0).map(([along, side]) =>
        vertex(
          0.16 + along * 0.66,
          side * 0.46,
          -spread * (0.13 + 0.1 * Math.abs(side)),
          along - 0.35,
          -0.68,
          side * 1.48,
        ),
      );
      for (let i = 0; i < underside.length; i++) {
        const k = i * 4;
        const next = underside[(i + 1) % underside.length]!;
        mesh.indices.push(
          underside[i]!,
          rim[k]!,
          rim[k + 1]!,
          underside[i]!,
          rim[k + 1]!,
          rim[k + 2]!,
          underside[i]!,
          rim[k + 2]!,
          next,
          next,
          rim[k + 2]!,
          rim[k + 3]!,
          next,
          rim[k + 3]!,
          rim[(k + 4) % rim.length]!,
        );
      }
      mesh.cap(underside, vertex(0.41, -0.02, -0.21 * spread, 0.1, -1, 0), false);
      for (const i of [2, 3, 5, 7, 9, 11]) {
        const p = rim[i * 2]! * 3;
        leafSprig(
          mesh,
          mesh.positions[p]! - dx * 0.045,
          mesh.positions[p + 1]!,
          mesh.positions[p + 2]! - dz * 0.045,
          angle + 1.3 * SPRAY[i]![1],
          0.32 * spread,
          true,
        );
      }
    }
    if (distant) {
      mesh.cap(outer, mesh.point(0, y + spread * 0.46, 0, 0, 1, 0), true);
      mesh.cap(outer, mesh.point(0, y - spread * 0.24, 0, 0, -1, 0), false);
    }
  });
  // Inner needles keep the sunlit sprays attached to a continuous, tapering spire.
  let inner: number[] = [];
  for (const [y, radius] of [
    [0.2, 0.32],
    [1.2, 0.37],
    [2.15, 0.27],
    [2.9, 0.19],
    [3.34, 0.08],
  ] as const) {
    const next = Array.from({ length: 7 }, (_, i) => {
      const a = (TAU * i) / 7;
      return mesh.point(
        0.035 * Math.sin(y * 2) + radius * Math.cos(a),
        y + 0.06 * Math.sin(3 * a),
        radius * Math.sin(a),
        Math.cos(a),
        0.3,
        Math.sin(a),
      );
    });
    if (inner.length) mesh.join(inner, next);
    inner = next;
  }
  mesh.cap(inner, mesh.point(0.02, 3.52, 0.02, 0, 1, 0), true);
  // A slender, slightly bent new leader above the last whorl.
  const ring = Array.from({ length: 7 }, (_, i) => {
    const a = (TAU * i) / 7;
    return mesh.point(
      -0.05 + 0.14 * Math.cos(a),
      3.19 + 0.08 * Math.sin(3 * a),
      0.14 * Math.sin(a),
      Math.cos(a),
      0.4,
      Math.sin(a),
    );
  });
  mesh.cap(ring, mesh.point(0.06, 3.57, 0.04, 0, 1, 0), true);
  mesh.cap(ring, mesh.point(-0.05, 2.91, 0, 0, -1, 0), false);
  return mesh.geometry();
}

type Section = readonly [x: number, y: number, z: number, radius: number];
function treeWood(cedar: boolean, distant: boolean): THREE.BufferGeometry {
  const mesh = new TreeMesh();
  const limb = (sections: readonly Section[], sides: number) => {
    let previous: number[] = [];
    for (const [x, y, z, radius] of sections) {
      const ring = Array.from({ length: sides }, (_, i) => {
        const a = (TAU * i) / sides;
        return mesh.point(
          x + radius * Math.cos(a),
          y,
          z + radius * Math.sin(a),
          Math.cos(a),
          0.08,
          Math.sin(a),
        );
      });
      if (previous.length) mesh.join(previous, ring);
      previous = ring;
    }
    const [x, y, z] = sections[sections.length - 1]!;
    mesh.cap(previous, mesh.point(x, y, z, 0, 1, 0), true);
  };
  if (cedar) {
    limb(
      [
        [0, 0, 0, 0.22],
        [0.02, 0.25, 0, 0.14],
        [-0.04, 0.76, 0, 0.12],
        [0.03, 1.9, -0.02, 0.073],
        [0.05, 3.2, 0.01, 0.036],
        [0.05, 4.13, 0.025, 0.009],
      ],
      distant ? 4 : 9,
    );
  } else {
    limb(
      [
        [0, 0, 0, 0.25],
        [-0.035, 0.23, 0, 0.16],
        [0.04, 0.69, 0.03, 0.13],
        [0.3, 0.93, 0.08, 0.1],
        [0.53, 1.36, 0.12, 0.035],
      ],
      distant ? 5 : 9,
    );
    limb(
      [
        [0.02, 0.62, 0.03, 0.11],
        [-0.24, 0.88, 0.09, 0.09],
        [-0.65, 1.25, 0.17, 0.025],
      ],
      distant ? 4 : 7,
    );
    if (!distant)
      limb(
        [
          [0.12, 0.77, 0.02, 0.08],
          [0.03, 1.02, -0.27, 0.065],
          [0.12, 1.29, -0.58, 0.02],
        ],
        6,
      );
  }
  return mesh.geometry();
}

const cedar = {
  crown: cedarCrown(false),
  far: cedarCrown(true),
  wood: treeWood(true, false),
  farWood: treeWood(true, true),
};
const broadleaf = {
  crown: broadleafCrown(false),
  far: broadleafCrown(true),
  wood: treeWood(false, false),
  farWood: treeWood(false, true),
};
const roll = (x: number, z: number) =>
  THREE.MathUtils.euclideanModulo(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453, 1);
const up = new THREE.Vector3(0, 1, 0),
  rotation = new THREE.Quaternion();
const position = new THREE.Vector3(),
  scale = new THREE.Vector3();

export function treePalette(t: Tree): number {
  return roll(t.x, t.z) < (t.color === color('canopy') ? 0.4 : 0.12) ? color('cedar') : t.color;
}

export function treeMatrix(t: Tree): THREE.Matrix4 {
  rotation.setFromAxisAngle(up, TAU * roll(t.z, t.x));
  position.set(t.x, t.y, t.z);
  const width = t.crown * (0.9 + 0.23 * roll(t.z + 1, t.x));
  return new THREE.Matrix4().compose(position, rotation, scale.set(width, t.height, width));
}

export function appendTree(
  g: GeometryBuilder,
  palette: number,
  transform: THREE.Matrix4,
  distant: boolean,
): void {
  const evergreen = palette === color('cedar');
  const tree = evergreen ? cedar : broadleaf;
  const trunkTop = evergreen ? 0.45 : 0.6;
  const wood = new THREE.Matrix4().makeScale(1, trunkTop, 1).premultiply(transform);
  const leaves = new THREE.Matrix4().makeScale(1, 0.4, 1).setPosition(0, trunkTop, 0).premultiply(transform);
  g.meshSmooth(distant ? tree.farWood : tree.wood, wood, color('bark'));
  g.meshSmooth(distant ? tree.far : tree.crown, leaves, palette);
}
