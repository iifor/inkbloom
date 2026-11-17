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

/** A bank of foliage: centre x, y, z, then width (x and z) and height. */
type Lump = readonly [x: number, y: number, z: number, width: number, height: number];

/**
 * Foliage lumps, closed and smooth. Their normals are bent towards the direction out from
 * `centre` (normal transfer, by `transfer`): light then falls on the crown as one soft volume,
 * lit on the sun's side and shaded on the other, with only a little variation from lump to
 * lump, the way a painted tree reads; each lump's own normals alone make a cluster of balls.
 */
/** How finely foliage is built: near by, from a field away (a great tree), or far off. */
type Detail = 'near' | 'mid' | 'far';
const RINGS: Record<Detail, { sides: number; latitudes: readonly number[] }> = {
  near: { sides: 26, latitudes: [-1.04, -0.69, -0.32, 0.08, 0.48, 0.85, 1.19] },
  mid: { sides: 14, latitudes: [-0.95, -0.42, 0.12, 0.62, 1.08] },
  far: { sides: 8, latitudes: [-0.55, 0.59] },
};

function foliage(
  mesh: TreeMesh,
  lumps: readonly Lump[],
  detail: Detail,
  centre: readonly [number, number, number],
  transfer: number,
  sprigs: boolean,
): void {
  const [cx, cy, cz] = centre;
  /** A point on a lump with its own normal (nx, ny, nz), bent towards the crown's. */
  const point = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    const own = Math.hypot(nx, ny, nz) || 1;
    const ox = x - cx;
    const oy = y - cy;
    const oz = z - cz;
    const out = Math.hypot(ox, oy, oz) || 1;
    return mesh.point(
      x,
      y,
      z,
      (nx / own) * (1 - transfer) + (ox / out) * transfer,
      (ny / own) * (1 - transfer) + (oy / out) * transfer,
      (nz / own) * (1 - transfer) + (oz / out) * transfer,
    );
  };
  lumps.forEach(([x, y, z, width, height], k) => {
    const bottom = point(x, y - height, z, 0, -1, 0);
    let previous: number[] = [];
    const { sides, latitudes } = RINGS[detail];
    for (const latitude of latitudes) {
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
          point(
            x + width * nx * scallop,
            y + height * (ny + 0.13 * Math.sin(4 * a + k) * Math.cos(latitude)),
            z + width * nz * scallop,
            nx,
            ny + 0.12 * Math.cos(5 * a + k),
            nz,
          ),
        );
        if (
          sprigs &&
          detail === 'near' &&
          Math.abs(latitude) < 0.85 &&
          (i + k) % 4 === 0 &&
          nx * x + nz * z > 0.18
        ) {
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
    mesh.cap(previous, point(x, y + height, z, 0, 1, 0), true);
  });
}

/** How far foliage normals bend towards the whole crown's (see foliage). */
const NORMAL_TRANSFER = 0.6;

// Each fork carries its own bank of foliage. Lower limbs spread further on one side.
const BROADLEAF: readonly Lump[] = [
  [-0.65, 0.43, 0.17, 0.85, 0.54],
  [0.64, 0.6, 0.18, 0.97, 0.68],
  [0.12, 0.55, -0.68, 0.91, 0.66],
  [-0.09, 0.75, 0.68, 0.81, 0.59],
  [-0.42, 1.13, -0.13, 0.91, 0.73],
  [0.41, 1.34, -0.06, 0.77, 0.69],
];

function broadleafCrown(distant: boolean): THREE.BufferGeometry {
  const mesh = new TreeMesh();
  foliage(mesh, BROADLEAF, distant ? 'far' : 'near', [0, 0.85, 0], NORMAL_TRANSFER, true);
  return mesh.geometry();
}

/**
 * A great old tree's crown, in tree heights (y) and crown radii (x, z): a low, wide ring of
 * lumps over the spreading limbs, a smaller ring above, two on top. Flattened banks of leaves
 * with sky between them, the way a camphor tree stands over a field.
 */
const GREAT: readonly Lump[] = [
  ...Array.from({ length: 7 }, (_, i): Lump => {
    const a = (TAU * i) / 7 + 0.3;
    const r = 0.7 + 0.09 * Math.sin(i * 2.3);
    return [
      r * Math.cos(a),
      0.55 + 0.04 * Math.sin(i * 1.7),
      r * Math.sin(a),
      0.36 + 0.04 * Math.cos(i),
      0.12,
    ];
  }),
  ...Array.from({ length: 5 }, (_, i): Lump => {
    const a = (TAU * i) / 5 + 0.9;
    return [0.4 * Math.cos(a), 0.75 + 0.03 * Math.sin(i * 2.1), 0.4 * Math.sin(a), 0.34, 0.15];
  }),
  // a rounded top: the dome of the crown
  [-0.08, 0.9, 0.06, 0.3, 0.14],
  [0.14, 0.94, -0.1, 0.24, 0.12],
];

function greatCrown(distant: boolean): THREE.BufferGeometry {
  const mesh = new TreeMesh();
  // a great tree is seen across a whole field: even far off it keeps a rounded outline
  foliage(mesh, GREAT, distant ? 'mid' : 'near', [0, 0.62, 0], NORMAL_TRANSFER, false);
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
/** A tapering limb through the given sections, capped at its end. */
function limbOf(mesh: TreeMesh, sections: readonly Section[], sides: number): void {
  {
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
  }
}

function treeWood(cedar: boolean, distant: boolean): THREE.BufferGeometry {
  const mesh = new TreeMesh();
  const limb = (sections: readonly Section[], sides: number) => limbOf(mesh, sections, sides);
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

/** A great old tree's trunk and limbs, in the same units as its crown: a thick bole flaring
 * into roots, and spreading limbs reaching up into the low ring of foliage. */
function greatWood(distant: boolean): THREE.BufferGeometry {
  const mesh = new TreeMesh();
  limbOf(
    mesh,
    [
      [0, -0.02, 0, 0.21],
      [0, 0.02, 0, 0.15],
      [0, 0.07, 0, 0.12],
      [0.01, 0.22, 0, 0.1],
      [0.02, 0.36, 0.01, 0.085],
      [0.03, 0.47, 0, 0.05],
    ],
    distant ? 7 : 14,
  );
  for (let i = 0; i < (distant ? 4 : 6); i++) {
    const a = (TAU * i) / 6 + 0.3 + 0.2 * Math.sin(i * 1.9);
    const up = 0.33 + 0.03 * Math.sin(i * 2.7);
    limbOf(
      mesh,
      [
        [0.02, up, 0, 0.055],
        [0.3 * Math.cos(a), up + 0.08, 0.3 * Math.sin(a), 0.035],
        [0.6 * Math.cos(a), up + 0.17, 0.6 * Math.sin(a), 0.016],
      ],
      distant ? 4 : 8,
    );
  }
  return mesh.geometry();
}

/**
 * A clump of bamboo, in clump heights (y) and spreads (x, z): culms rising from a tight base and
 * arching outward, slender and tapering, with feathery banks of leaves strung along their upper
 * halves. Far off, fewer culms and fewer, rounder banks.
 */
function bamboo(distant: boolean): { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const wood = new TreeMesh();
  const lumps: Lump[] = [];
  const culms = distant ? 4 : 7;
  for (let i = 0; i < culms; i++) {
    const a = (TAU * i) / culms + 0.7 * Math.sin(i * 2.9);
    const dx = Math.cos(a),
      dz = Math.sin(a);
    const base = 0.1 + 0.16 * ((i * 0.618) % 1);
    const lean = 0.35 + 0.35 * ((i * 0.382 + 0.3) % 1);
    const tall = 0.78 + 0.22 * ((i * 0.727 + 0.5) % 1);
    // out along the culm: it leans more the higher it gets, so it arches over
    const at = (t: number): [number, number, number] => {
      const out = base + lean * t * t;
      return [dx * out, tall * t, dz * out];
    };
    limbOf(
      wood,
      [0, 0.25, 0.5, 0.75, 1].map((t): Section => [...at(t), 0.02 * (1 - 0.6 * t)]),
      distant ? 3 : 6,
    );
    const banks = distant ? 2 : 5;
    for (let k = 0; k < banks; k++) {
      const t = 0.45 + (0.55 * (k + 0.5)) / banks;
      const [x, y, z] = at(t);
      // thin, flat sprays hanging off alternate sides of the culm, the top ones out past its tip
      const side = (k % 2 ? 1 : -1) * (0.14 + 0.06 * Math.sin(i + k));
      const reach = 0.1 + 0.18 * t;
      const size = distant ? 1.3 : 1.15 - 0.4 * (t - 0.45);
      lumps.push([
        x + dx * reach - dz * side,
        y - 0.025 * t,
        z + dz * reach + dx * side,
        0.3 * size,
        0.028 * size,
      ]);
    }
  }
  const leaves = new TreeMesh();
  foliage(leaves, lumps, distant ? 'far' : 'mid', [0, 0.72, 0], NORMAL_TRANSFER, false);
  return { wood: wood.geometry(), leaves: leaves.geometry() };
}

const bamboos = { near: bamboo(false), far: bamboo(true) };

const great = {
  crown: greatCrown(false),
  far: greatCrown(true),
  wood: greatWood(false),
  farWood: greatWood(true),
};
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
  // great trees are broadleaved, camphor-like, never a cedar; bamboo keeps its own green
  if (t.kind) return t.color;
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
  kind: Tree['kind'] = undefined,
): void {
  if (kind === 'bamboo') {
    const clump = distant ? bamboos.far : bamboos.near;
    g.meshSmooth(clump.wood, transform, color('green'));
    g.meshSmooth(clump.leaves, transform, palette);
    return;
  }
  if (kind === 'great') {
    // drawn whole in its own units: heights up, crown radii across
    g.meshSmooth(distant ? great.farWood : great.wood, transform, color('bark'));
    g.meshSmooth(distant ? great.far : great.crown, transform, palette);
    return;
  }
  const evergreen = palette === color('cedar');
  const tree = evergreen ? cedar : broadleaf;
  const trunkTop = evergreen ? 0.45 : 0.6;
  const wood = new THREE.Matrix4().makeScale(1, trunkTop, 1).premultiply(transform);
  const leaves = new THREE.Matrix4().makeScale(1, 0.4, 1).setPosition(0, trunkTop, 0).premultiply(transform);
  g.meshSmooth(distant ? tree.farWood : tree.wood, wood, color('bark'));
  g.meshSmooth(distant ? tree.far : tree.crown, leaves, palette);
}
