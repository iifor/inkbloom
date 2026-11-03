// The ink tide's curtain as a picture: a wall of ink columns heaving in a rolling wave, a crest
// of blobs leaning over the front, a bulge rolling along the foot, strands dripping off the
// crest, and the swept ground behind it left under a sheet of ink. Two instanced meshes,
// re-posed every frame the tide is active. Pure visuals; the tide owns where it is.
//
// Local frame: the curtain runs along +x from 0 to `length`, stands on y = 0 at z = 0, and
// advances towards -z. The swept ground is behind it, at +z.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';

const SPACING = 0.5;
/** Tallest a column stands, metres (before the wave on top). */
export const CURTAIN_HEIGHT = 13;
const DRIP_LENGTH = 4;

const hash = (i: number, k: number): number => {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export class InkCurtain {
  readonly root = new THREE.Group();
  private readonly boxes: THREE.InstancedMesh;
  private readonly blobs: THREE.InstancedMesh;
  private readonly n: number;
  private readonly drips: number;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly material = makeInkMaterial();

  constructor(private readonly length: number) {
    const ink = color('ink');
    const box = new GeometryBuilder();
    const f = { px: ink, nx: ink, pz: ink, nz: ink, py: ink, ny: ink };
    const a = {
      px: ALWAYS_COLOR,
      nx: ALWAYS_COLOR,
      pz: ALWAYS_COLOR,
      nz: ALWAYS_COLOR,
      py: ALWAYS_COLOR,
      ny: ALWAYS_COLOR,
    };
    box.box({ x: -0.5, y: -0.5, z: -0.5 }, { x: 0.5, y: 0.5, z: 0.5 }, f, a);
    const blob = new GeometryBuilder();
    blob.mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.Matrix4(), ink, ALWAYS_COLOR);

    this.n = Math.ceil(length / SPACING);
    this.drips = Math.ceil(this.n / 2);
    // columns, drips, and one sheet on the swept ground
    this.boxes = new THREE.InstancedMesh(box.build(), this.material, this.n + this.drips + 1);
    // a crest blob and a foot blob per column
    this.blobs = new THREE.InstancedMesh(blob.build(), this.material, this.n * 2);
    for (const mesh of [this.boxes, this.blobs]) {
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    this.root.visible = false;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * Pose for this frame. `front` is how far the curtain has come into the block (the length of
   * the swept sheet behind it), `t` a running time in seconds.
   */
  update(front: number, t: number): void {
    let b = 0;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const x = (i + 0.5) * SPACING;
      // the height changes smoothly along the curtain, so the top reads as one rolling wave
      // rather than a row of separate posts; a little noise keeps it from looking machined
      const base =
        CURTAIN_HEIGHT * (0.72 + 0.14 * Math.sin(i * 0.09) + 0.08 * Math.sin(i * 0.23 + 1.3)) +
        0.35 * hash(i, 1);
      // travelling waves along the curtain make it heave rather than bob in place
      const h = Math.max(2, base + 1.3 * Math.sin(t * 1.4 - i * 0.12) + 0.4 * Math.sin(t * 2.7 + i * 0.31));
      const z = 0.35 * Math.sin(i * 1.7) + 0.2 * Math.sin(t * 1.3 + i * 0.5);
      const depth = 1 + 0.4 * hash(i, 2);
      this.set(this.boxes, b++, x, h / 2, z, 0.62, h, depth);
      // crest: a lip curling out over the front; wide flat blobs overlap into one roll
      const swell = 1 + 0.2 * Math.sin(t * 2.2 - i * 0.25);
      const r = (0.8 + 0.3 * hash(i, 3)) * swell;
      this.set(this.blobs, k++, x, h - 0.35, z - depth / 2 - r * 0.45, r * 1.5, r * 0.55, r * 1.2);
      // foot: a bulge rolling along the ground ahead of the wall
      const roll = 0.75 + 0.3 * Math.sin(t * 3.1 - i * 0.45);
      this.set(this.blobs, k++, x, 0.35 * roll, z - depth / 2 - 0.3, roll * 0.9, roll * 0.55, roll * 1.1);
      // every other column drips: a strand that grows from the crest, lets go, and starts again
      if (i % 2 === 0) {
        const phase = (t * (0.45 + 0.3 * hash(i, 4)) + hash(i, 5)) % 1;
        const len = Math.max(0.05, DRIP_LENGTH * phase * phase);
        const top = h - 0.5;
        const w = 0.1 + 0.08 * hash(i, 6);
        this.set(this.boxes, this.n + i / 2, x, top - len / 2, z - depth / 2 - r * 0.8, w, len, w);
      }
    }
    // the sheet left on the ground it has already swept
    const sheet = Math.max(0.01, front);
    this.set(this.boxes, this.n + this.drips, this.length / 2, 0.04, sheet / 2, this.length, 0.08, sheet);
    this.boxes.instanceMatrix.needsUpdate = true;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  private set(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
    mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz)));
  }

  dispose(): void {
    this.boxes.geometry.dispose();
    this.blobs.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
