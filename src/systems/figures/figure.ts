// Figures built from soft parts on a skeleton: round blobs and tapered limbs hung from joints.
// Monsters and player characters both use it. Every part of every figure drawn by one
// FigureRenderer goes into two instanced meshes (blobs and limbs), so a crowd of figures is two
// draw calls. A rig is posed for one figure at a time and its part matrices copied out.
//
// The world is painted without outlines (see engine/render/renderer.ts), so parts are smooth and
// chunky: forms read by their silhouette and colour blocks. design: docs/game-design.md section 8
//
// Figures stand on y = 0 and face -z, like the rest of the game's models.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';

export type Shape = 'blob' | 'limb';

/** One drawn piece. `paint` is a slot name the figure's owner turns into a palette index. */
export interface Part {
  readonly node: THREE.Object3D;
  readonly shape: Shape;
  readonly paint: string;
}

export class RigBuilder {
  readonly parts: Part[] = [];

  joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
    const j = new THREE.Object3D();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  }

  /** An ellipsoid with radii rx, ry, rz centred at (x, y, z); returns its node. */
  blob(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    paint: string,
  ): THREE.Object3D {
    const n = new THREE.Object3D();
    n.position.set(x, y, z);
    n.scale.set(rx, ry, rz);
    parent.add(n);
    this.parts.push({ node: n, shape: 'blob', paint });
    return n;
  }

  /** A limb hanging down from a new joint; returns the joint and where its far end is. `rz`
   * flattens it front to back (a scarf, a strap). */
  limb(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    len: number,
    r: number,
    paint: string,
    rz = r,
  ): { joint: THREE.Object3D; end: number } {
    const j = this.joint(parent, x, y, z);
    const n = new THREE.Object3D();
    n.scale.set(r, len, rz);
    j.add(n);
    this.parts.push({ node: n, shape: 'limb', paint });
    return { joint: j, end: -len };
  }
}

/** Highest point of a rig's blobs in its root's space, posed as it is now. */
export function rigTop(root: THREE.Object3D, parts: readonly Part[]): number {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  let top = 0;
  for (const part of parts) {
    if (part.shape !== 'blob') continue;
    m.multiplyMatrices(inv, part.node.matrixWorld).decompose(p, q, s);
    // an upright ellipsoid's top; tilted ones are close enough for fitting
    top = Math.max(top, p.y + s.y);
  }
  return top;
}

export function unitGeometry(shape: Shape): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const ink = color('ink');
  if (shape === 'blob')
    g.meshSmooth(new THREE.SphereGeometry(1, 16, 12), new THREE.Matrix4(), ink, ALWAYS_COLOR);
  else {
    // a soft tapered stroke hanging from its joint (y 0 to -1), rounded at both ends
    const profile = [
      [0, -1],
      [0.45, -0.99],
      [0.74, -0.95],
      [0.86, -0.88],
      [0.95, -0.5],
      [1, -0.14],
      [0.86, -0.06],
      [0.55, -0.015],
      [0, 0],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    g.meshSmooth(new THREE.LatheGeometry(profile, 12), new THREE.Matrix4(), ink, ALWAYS_COLOR);
  }
  return g.build();
}

const INK = color('ink');

/** Draws any number of posed rigs as two instanced meshes. Call begin, add each figure, end. */
export class FigureRenderer {
  private readonly meshes: Record<Shape, THREE.InstancedMesh>;
  private readonly used: Record<Shape, number> = { blob: 0, limb: 0 };
  private readonly c = new THREE.Color();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly material: THREE.Material,
  ) {
    this.meshes = { blob: this.make('blob', 256), limb: this.make('limb', 256) };
  }

  private make(shape: Shape, capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(unitGeometry(shape), this.material, capacity);
    m.frustumCulled = false;
    m.count = 0;
    // instance colours carry the palette index of each part
    m.setColorAt(0, this.c.setRGB(INK, 0, 0));
    this.parent.add(m);
    return m;
  }

  /** Double a mesh's capacity, keeping what has been written this frame. */
  private grow(shape: Shape): void {
    const old = this.meshes[shape];
    const m = this.make(shape, old.instanceMatrix.count * 2);
    const n = this.used[shape];
    m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, n * 16));
    m.instanceColor!.array.set(old.instanceColor!.array.subarray(0, n * 3));
    old.geometry.dispose();
    old.removeFromParent();
    old.dispose();
    this.meshes[shape] = m;
  }

  begin(): void {
    this.used.blob = 0;
    this.used.limb = 0;
  }

  /** Copy out a posed rig. Its matrices must be up to date (updateMatrixWorld). */
  add(parts: readonly Part[], paint: (part: Part) => number): void {
    for (const part of parts) {
      const shape = part.shape;
      if (this.used[shape] >= this.meshes[shape].instanceMatrix.count) this.grow(shape);
      const m = this.meshes[shape];
      const i = this.used[shape]++;
      m.setMatrixAt(i, part.node.matrixWorld);
      m.setColorAt(i, this.c.setRGB(paint(part), 0, 0));
    }
  }

  end(): void {
    for (const shape of ['blob', 'limb'] as const) {
      const m = this.meshes[shape];
      m.count = this.used[shape];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of Object.values(this.meshes)) {
      m.geometry.dispose();
      m.removeFromParent();
      m.dispose();
    }
  }
}
